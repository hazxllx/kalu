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
 * Attach the freshly-computed risk fields to a set of resident rows. Never
 * throws: on any failure the residents are returned unchanged (risk null) so a
 * directory listing is never broken by the risk computation.
 */
export const attachRiskToResidents = async (residents = [], { repo = repository, config = null } = {}) => {
  if (!Array.isArray(residents) || !residents.length) return residents || [];
  try {
    const cfg = config || (await getRiskConfig({ repo }));
    const { rows: visits } = await repo.listVisits({ limit: 5000 });
    const latest = latestVisitMap(visits || []);
    return residents.map((r) => ({ ...r, ...assessFromVisit(latest.get(r.id), cfg) }));
  } catch {
    return residents.map((r) => ({
      ...r, riskScore: r.riskScore ?? null, riskLevel: r.riskLevel ?? null, riskFactors: r.riskFactors ?? [], riskAssessedAt: r.riskAssessedAt ?? null,
    }));
  }
};

/** Assess one resident by id (used by the Resident Detail breakdown). */
export const assessResidentById = async ({ id, repo = repository, config = null } = {}) => {
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
export const getRiskSummary = async ({ barangay = null, municipalityId = null, repo = repository } = {}) => {
  const cfg = await getRiskConfig({ repo });
  const [{ rows: visits }, allResidents] = await Promise.all([
    repo.listVisits({ limit: 5000 }),
    repo.searchResidents({ q: '', limit: 5000 }),
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

export const getHighRiskResidents = async ({ barangay = null, municipalityId = null, repo = repository } = {}) => {
  const cfg = await getRiskConfig({ repo });
  const [{ rows: visits }, allResidents] = await Promise.all([
    repo.listVisits({ limit: 5000 }),
    repo.searchResidents({ q: '', limit: 5000 }),
  ]);
  const residents = scopeResidents(allResidents || [], { barangay, municipalityId });
  const residentIds = new Set(residents.map((r) => r.id));
  const latest = latestVisitMap((visits || []).filter((v) => residentIds.has(v.residentId)));
  return residents
    .map((r) => ({ resident: r, ...assessFromVisit(latest.get(r.id), cfg) }))
    .filter((row) => row.riskLevel === 'High');
};

/**
 * Recalculate + persist risk for every resident (optionally scoped). Called
 * after an administrator changes the configuration so the new classification
 * propagates to the stored resident records. Returns the number updated.
 */
export const recalculateAll = async ({ barangay = null, municipalityId = null, repo = repository } = {}) => {
  const cfg = await getRiskConfig({ repo });
  const [{ rows: visits }, allResidents] = await Promise.all([
    repo.listVisits({ limit: 5000 }),
    repo.searchResidents({ q: '', limit: 5000 }),
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
