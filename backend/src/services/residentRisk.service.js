/**
 * Resident risk service — applies the authoritative engine (`utils/residentRisk`)
 * to residents using their recorded consultation data, and exposes the
 * scope-aware aggregates the dashboards use.
 *
 * The displayed risk is ALWAYS recomputed server-side from the resident's latest
 * recorded vitals and the current configuration, so:
 *   - a client can never submit a fake risk score/level (none is read from the
 *     request),
 *   - when health data changes (a new/edited consultation) the next read
 *     reflects it,
 *   - when the Administrator changes a criterion/threshold the next read
 *     reflects it everywhere — Resident Directory, Resident Detail, Health
 *     Trends and Early Warning all agree because they share this one path.
 *
 * The computed result is also PERSISTED to the resident record
 * (`risk_score` / `risk_level` / `risk_factors` / `risk_assessed_at`) on
 * consultation writes and on administrator-triggered recalculation, so the
 * stored classification survives refresh and logout and is available for
 * efficient listing.
 */
import repository from '../repositories/index.js';
import { assessVitals, hasAssessableVitals } from '../utils/residentRisk.js';
import { getRiskConfig, setRecalcHandler } from './riskConfig.service.js';
import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';

const getSqlAssessments = async (ids, { user = null, supabase = getServiceClient() } = {}) => {
  const rows = [];
  const distinct = [...new Set(ids)];
  for (let offset = 0; offset < distinct.length; offset += 1000) {
    const { data, error } = await supabase.rpc('resident_risk_for_ids', {
      p_resident_ids: distinct.slice(offset, offset + 1000), p_actor_id: user?.id || null,
    });
    if (error?.code === '42501') throw ApiError.forbidden('Resident risk records are outside the current account scope.');
    if (error || !Array.isArray(data)) throw new ApiError(503, 'Resident risk assessment is unavailable. Deploy analytics migrations 20261106030000 and 20261106041000, then retry.').withCode('RISK_SOURCE_UNAVAILABLE');
    rows.push(...data);
  }
  return new Map(rows.map(({ residentId, ...assessment }) => [residentId, assessment]));
};

const latestVisitMap = (visits = []) => {
  const map = new Map();
  for (const v of visits) {
    const cur = map.get(v.residentId);
    const vt = String(v.visitDate || v.createdAt || '');
    if (!cur || vt > String(cur.visitDate || cur.createdAt || '')) map.set(v.residentId, v);
  }
  return map;
};

/** Assess a single resident from a (latest) visit + config. */
const assessFromVisit = (visit, config) => {
  if (!visit || !hasAssessableVitals(visit.vitals)) {
    return { riskScore: null, riskLevel: null, riskFactors: [], riskAssessedAt: null };
  }
  const { score, level, factors } = assessVitals(visit.vitals, config);
  return {
    riskScore: score,
    riskLevel: level,
    riskFactors: factors,
    riskAssessedAt: visit.visitDate || visit.createdAt || null,
  };
};

/**
 * Production uses a bounded SQL query and surfaces missing source/permission
 * failures instead of inventing unassessed data. Test/file drivers use JS.
 */
export const attachRiskToResidents = async (residents = [], { repo = repository, config = null, user = null, supabase } = {}) => {
  if (!Array.isArray(residents) || !residents.length) return residents || [];
  if (repo.driver === 'supabase') {
    const risks = await getSqlAssessments(residents.map((resident) => resident.id), { user, supabase });
    if (residents.some((resident) => !risks.has(resident.id))) throw ApiError.forbidden('The resident scope changed. Reload the directory.');
    return residents.map((resident) => ({ ...resident, ...risks.get(resident.id) }));
  }
  try {
    const cfg = config || (await getRiskConfig({ repo }));
    const { rows: visits } = await repo.listVisits({ limit: Number.MAX_SAFE_INTEGER });
    const latest = latestVisitMap(visits || []);
    return residents.map((r) => ({ ...r, ...assessFromVisit(latest.get(r.id), cfg) }));
  } catch {
    return residents.map((r) => ({
      ...r, riskScore: r.riskScore ?? null, riskLevel: r.riskLevel ?? null, riskFactors: r.riskFactors ?? [], riskAssessedAt: r.riskAssessedAt ?? null,
    }));
  }
};

/** Assess one resident by id (used by the Resident Detail breakdown). */
export const assessResidentById = async ({ id, repo = repository, config = null, user = null, supabase } = {}) => {
  if (repo.driver === 'supabase') {
    const risks = await getSqlAssessments([id], { user, supabase });
    const risk = risks.get(id);
    if (!risk) throw ApiError.notFound('Resident risk record not found in your scope.');
    return risk;
  }
  const cfg = config || (await getRiskConfig({ repo }));
  const { rows: visits } = await repo.listVisits({ residentId: id, limit: 500 });
  const latest = latestVisitMap(visits || []).get(id) || null;
  return assessFromVisit(latest, cfg);
};

/**
 * Compute and PERSIST a resident's risk from their latest recorded vitals.
 * Best-effort: a persistence failure never propagates to the caller (so a
 * clinical save is never rejected because of the risk write).
 */
export const persistResidentRisk = async ({ residentId, repo = repository, config = null } = {}) => {
  try {
    if (!residentId) return null;
    const result = await assessResidentById({ id: residentId, repo, config });
    if (typeof repo.updateResident === 'function') {
      await repo.updateResident(residentId, {
        riskScore: result.riskScore,
        riskLevel: result.riskLevel,
        riskFactors: result.riskFactors,
        riskAssessedAt: result.riskAssessedAt,
      });
    }
    return result;
  } catch {
    return null;
  }
};

const sameBarangay = (resident, barangay) =>
  String(resident?.barangay ?? '').trim().toLowerCase() === String(barangay).trim().toLowerCase();

const scopeResidents = (residents, { barangay, municipalityId }) =>
  residents.filter((r) => {
    if (barangay) {
      if (!sameBarangay(r, barangay)) return false;
      if (municipalityId && r.municipalityId && r.municipalityId !== municipalityId) return false;
      return true;
    }
    if (municipalityId) return r.municipalityId === municipalityId;
    return true;
  });

/**
 * Scope-aware risk summary over the authorized resident population. Reuses the
 * one engine so the figures agree with the Resident Directory and Health Trends.
 */
const sqlRiskSummary = async ({ user, barangay, municipalityId, limit = 0, offset = 0, supabase = getServiceClient() }) => {
  if (!user?.id || !user.municipalityId || (municipalityId && municipalityId !== user.municipalityId)) {
    throw ApiError.forbidden('An authorized municipality-scoped account is required.');
  }
  const { data, error } = await supabase.rpc('resident_risk_summary', { p_actor_id: user.id, p_barangay: barangay, p_limit: limit, p_offset: offset });
  if (error?.code === '42501') throw ApiError.forbidden('Risk records are outside the current account permissions.');
  if (error || !data?.summary || !Array.isArray(data.highRisk)) throw new ApiError(503, 'The risk summary is unavailable. Deploy analytics migrations 20261106030000 and 20261106041000, then retry.').withCode('RISK_SOURCE_UNAVAILABLE');
  return data;
};

export const getRiskSummary = async ({ barangay = null, municipalityId = null, repo = repository, user = null, supabase } = {}) => {
  if (repo.driver === 'supabase') return (await sqlRiskSummary({ user, barangay, municipalityId, supabase })).summary;
  const cfg = await getRiskConfig({ repo });
  const [{ rows: visits }, allResidents] = await Promise.all([
    repo.listVisits({ limit: Number.MAX_SAFE_INTEGER }),
    repo.searchResidents({ q: '', limit: Number.MAX_SAFE_INTEGER }),
  ]);
  const residents = scopeResidents(allResidents || [], { barangay, municipalityId });
  const residentIds = new Set(residents.map((r) => r.id));
  const latest = latestVisitMap((visits || []).filter((v) => residentIds.has(v.residentId)));

  const counts = { Low: 0, Moderate: 0, High: 0 };
  let assessed = 0;
  for (const resident of residents) {
    const { riskLevel } = assessFromVisit(latest.get(resident.id), cfg);
    if (riskLevel) { counts[riskLevel] += 1; assessed += 1; }
  }
  const highPct = assessed > 0 ? Math.round((counts.High / assessed) * 100) : 0;
  return {
    totalResidents: residents.length,
    assessed,
    high: counts.High,
    moderate: counts.Moderate,
    low: counts.Low,
    highRiskPercentage: highPct,
    distribution: [
      { name: 'Low Risk', value: counts.Low },
      { name: 'Moderate Risk', value: counts.Moderate },
      { name: 'High Risk', value: counts.High },
    ],
  };
};

export const getRiskDistribution = async (scope) => (await getRiskSummary(scope)).distribution;

export const getHighRiskResidents = async ({ barangay = null, municipalityId = null, repo = repository, user = null, supabase, limit = 100, offset = 0, includeTotal = false } = {}) => {
  if (repo.driver === 'supabase') {
    const result = await sqlRiskSummary({ user, barangay, municipalityId, limit, offset, supabase });
    if (!result.highRisk.length) return includeTotal ? { rows: [], total: result.summary.high } : [];
    const ids = result.highRisk.map((row) => row.residentId);
    const page = await repo.listResidents({ ids, municipalityId: user.municipalityId,
      barangayId: user.role === 'health_supervisor' ? user.barangayId : null, limit });
    if (page.rows.length !== ids.length) throw ApiError.forbidden('The resident scope changed. Reload the list.');
    const risks = new Map(result.highRisk.map(({ residentId, ...risk }) => [residentId, risk]));
    const rows = page.rows.map((resident) => ({ resident: { ...resident, ...risks.get(resident.id) }, ...risks.get(resident.id) }));
    return includeTotal ? { rows, total: result.summary.high } : rows;
  }
  const cfg = await getRiskConfig({ repo });
  const [{ rows: visits }, allResidents] = await Promise.all([
    repo.listVisits({ limit: Number.MAX_SAFE_INTEGER }),
    repo.searchResidents({ q: '', limit: Number.MAX_SAFE_INTEGER }),
  ]);
  const residents = scopeResidents(allResidents || [], { barangay, municipalityId });
  const residentIds = new Set(residents.map((r) => r.id));
  const latest = latestVisitMap((visits || []).filter((v) => residentIds.has(v.residentId)));
  const rows = residents
    .map((r) => ({ resident: r, ...assessFromVisit(latest.get(r.id), cfg) }))
    .filter((row) => row.riskLevel === 'High');
  return includeTotal ? { rows: rows.slice(offset, offset + limit), total: rows.length } : rows;
};

/**
 * Recalculate + persist risk for every resident (optionally scoped). Called
 * after an administrator changes the configuration so the new classification
 * propagates to the stored resident records. Returns the number updated.
 */
export const recalculateAll = async ({ barangay = null, municipalityId = null, repo = repository, supabase } = {}) => {
  if (repo.driver === 'supabase') {
    const client = supabase || getServiceClient();
    const { data, error } = await client.rpc('recalculate_resident_risk', { p_barangay: barangay, p_municipality_id: municipalityId });
    if (error || !Number.isInteger(data?.updated) || !Number.isInteger(data?.total)) {
      throw new ApiError(503, 'Risk recalculation did not complete. Check the analytics migrations and retry.');
    }
    return data;
  }
  const cfg = await getRiskConfig({ repo });
  const [{ rows: visits }, allResidents] = await Promise.all([
    repo.listVisits({ limit: Number.MAX_SAFE_INTEGER }),
    repo.searchResidents({ q: '', limit: Number.MAX_SAFE_INTEGER }),
  ]);
  const residents = scopeResidents(allResidents || [], { barangay, municipalityId });
  const latest = latestVisitMap(visits || []);
  let updated = 0;
  for (const resident of residents) {
    const result = assessFromVisit(latest.get(resident.id), cfg);
    try {
      if (typeof repo.updateResident === 'function') {
        await repo.updateResident(resident.id, {
          riskScore: result.riskScore,
          riskLevel: result.riskLevel,
          riskFactors: result.riskFactors,
          riskAssessedAt: result.riskAssessedAt,
        });
        updated += 1;
      }
    } catch { /* skip residents the driver cannot persist */ }
  }
  return { updated, total: residents.length };
};

// Wire administrator configuration changes to a full recalculation so updated
// criteria/thresholds propagate to persisted resident records.
setRecalcHandler(async () => { await recalculateAll({}); });

export default {
  attachRiskToResidents,
  assessResidentById,
  persistResidentRisk,
  getRiskSummary,
  getRiskDistribution,
  getHighRiskResidents,
  recalculateAll,
};
