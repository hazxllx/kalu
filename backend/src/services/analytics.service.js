/**
 * Early Warning analytics service.
 *
 * Computes the Early Warning module payload from the resident / visit /
 * referral records. Barangay scoping is applied HERE, at the data-access
 * layer: a barangay-scoped caller (Health Supervisor assigned to one
 * barangay) receives ONLY their barangay's numbers. The scope always comes
 * from the authenticated session via `resolveBarangayScope` — a caller cannot
 * influence it with filters, URLs or record ids.
 *
 * Condition and risk classification use documented, conservative heuristics
 * over the recorded chief complaints and vitals until the verified FHSIS
 * coding schema is connected.
 */
import repository from '../repositories/index.js';
import { assessVitals, hasAssessableVitals } from '../utils/residentRisk.js';
import { DEFAULT_RISK_CONFIG } from '../config/riskConfig.js';
import { getRiskConfig } from './riskConfig.service.js';

const CONDITION_RULES = [
  { name: 'Tuberculosis', keywords: ['tuberculosis', 'tb', 'ptb', 'koch'] },
  { name: 'Dengue', keywords: ['dengue', 'hemorrhagic fever'] },
  { name: 'Malaria', keywords: ['malaria', 'plasmodium'] },
  { name: 'Hypertension', keywords: ['hypertension', 'blood pressure', 'elevated blood'] },
  { name: 'Diabetes', keywords: ['diabetes', 'blood sugar', 'glucose', 'hba1c'] },
  { name: 'Respiratory', keywords: ['respiratory', 'asthma', 'cough', 'pneumonia', 'ili', 'influenza'] },
  { name: 'Maternal', keywords: ['prenatal', 'pregnan', 'postnatal', 'postpartum'] },
  { name: 'Anemia', keywords: ['anemia', 'anaemia', 'pallor', 'cbc'] },
  { name: 'Gastrointestinal', keywords: ['epigastric', 'abdominal', 'diarrhea', 'vomiting', 'heartburn'] },
];

/** Names of the health conditions the map/filters recognise. */
export const CONDITION_NAMES = Object.freeze([...CONDITION_RULES.map((r) => r.name), 'Others']);

/** Completed / resolved visit statuses vs. still-active ones. */
const COMPLETED_STATUSES = new Set(['completed']);
export const COMMUNITY_MAP_STATUSES = Object.freeze([
  'draft',
  'submitted',
  'received',
  'in_review',
  'referred',
  'completed',
]);
export const COMMUNITY_MAP_RISK_LEVELS = Object.freeze(['High', 'Moderate', 'Low', 'Unassessed']);

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sameBarangay = (resident, barangay) =>
  String(resident?.barangay ?? '').trim().toLowerCase() === String(barangay).trim().toLowerCase();

const residentInBarangay = (resident, barangayRow, municipalityId) => {
  const expectedMunicipality = municipalityId || barangayRow.municipality_id || barangayRow.municipalityId;
  if (resident?.barangayId && barangayRow.id) return resident.barangayId === barangayRow.id;
  if (!sameBarangay(resident, barangayRow.name)) return false;
  return !expectedMunicipality || resident?.municipalityId === expectedMunicipality;
};

const isTbProgram = (program) => /\btb\b|tuberculosis/i.test(String(program || ''));

const classifyCondition = (text) => {
  const haystack = String(text || '').toLowerCase();
  const rule = CONDITION_RULES.find((r) => r.keywords.some((k) => haystack.includes(k)));
  return rule ? rule.name : 'Others';
};

/**
 * Determine the single headline "Top Condition" from a disease distribution.
 *
 * The generic "Others" catch-all is never surfaced as the headline — only a
 * real recorded condition qualifies. Ties are broken deterministically by name
 * (alphabetical) so the card is stable. When there is no recorded condition the
 * card shows "No recorded condition" / 0 cases.
 */
export const topConditionFrom = (distribution = []) => {
  const named = distribution.filter((d) => d && d.name && d.name !== 'Others' && Number(d.value) > 0);
  if (!named.length) return { name: 'No recorded condition', value: 0 };
  const max = Math.max(...named.map((d) => Number(d.value)));
  const [top] = named
    .filter((d) => Number(d.value) === max)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { name: top.name, value: Number(top.value) };
};

/** Conservative risk heuristic from the latest recorded vitals. */
/**
 * Resident risk level from recorded vitals. Delegates to the SINGLE
 * authoritative, rule-based risk engine (`utils/residentRisk`), so Early
 * Warning, the Community Map and the resident dashboard classify risk exactly
 * the same way as the Resident Directory and Resident Detail. The configuration
 * defaults to the documented defaults (which reproduce the project's original
 * behavior); callers pass the active DB configuration to honour administrator
 * changes.
 */
export const riskFromVitals = (vitals, config = DEFAULT_RISK_CONFIG) =>
  hasAssessableVitals(vitals) ? assessVitals(vitals, config).level : null;

const isSameMonth = (isoDate, reference) => {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === reference.getFullYear() && d.getMonth() === reference.getMonth();
};

const lastTwelveMonths = (reference) => {
  const months = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(reference.getFullYear(), reference.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTH_LABELS[d.getMonth()] });
  }
  return months;
};

export const getEarlyWarning = async ({ barangay = null, municipalityId = null } = {}) => {
  const now = new Date();

  // --- load the source records, then filter to the caller's scope ----------
  const [visitPage, referralPage, allResidents, riskConfig] = await Promise.all([
    repository.listVisits({ limit: 5000 }),
    repository.listReferrals({ limit: 5000 }),
    repository.searchResidents({ q: '', limit: 5000 }),
    getRiskConfig({ repo: repository }),
  ]);
  const visits = visitPage.rows;
  const referrals = referralPage.rows;

  // Geographic scope is enforced HERE from the authenticated session:
  //   - barangay scope (Health Supervisor's session barangay, or an MHO drilling
  //     into one barangay): match the barangay, and if the resident carries a
  //     municipality it must equal the caller's — so a same-named barangay in
  //     another municipality can never leak,
  //   - municipality-wide (MHO): strictly the caller's municipality,
  //   - neither supplied: unscoped (no analytics role reaches this).
  // A client-supplied barangay/municipality id never reaches this function; the
  // barangay string, when present, is still constrained by municipalityId.
  const scopedResidents = allResidents.filter((r) => {
    if (barangay) {
      if (!sameBarangay(r, barangay)) return false;
      if (municipalityId && r.municipalityId && r.municipalityId !== municipalityId) return false;
      return true;
    }
    if (municipalityId) return r.municipalityId === municipalityId;
    return true;
  });
  const residentIds = new Set(scopedResidents.map((r) => r.id));
  const scopedVisits = visits.filter((v) => residentIds.has(v.residentId));
  const scopedReferrals = referrals.filter((r) => residentIds.has(r.residentId));

  // --- summary --------------------------------------------------------------
  const consultationsThisMonth = scopedVisits.filter((v) => isSameMonth(v.visitDate || v.createdAt, now)).length;
  const referralsThisMonth = scopedReferrals.filter((r) => isSameMonth(r.createdAt, now)).length;

  const conditionCounts = {};
  scopedVisits.forEach((v) => {
    // Classify from the chief complaint AND the recorded findings/diagnosis so
    // the headline reflects the actual recorded condition, not just the complaint.
    const name = classifyCondition(`${v.chiefComplaint || ''} ${v.findings || ''}`);
    conditionCounts[name] = (conditionCounts[name] || 0) + 1;
  });
  const diseaseDistribution = Object.entries(conditionCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  // The Top Condition card shows the most frequent REAL condition (never the
  // "Others" catch-all), deterministic on ties, "No recorded condition" when empty.
  const topCondition = topConditionFrom(diseaseDistribution);

  // Risk per resident from their most recent visit's vitals.
  const latestVisitByResident = new Map();
  scopedVisits.forEach((v) => {
    const current = latestVisitByResident.get(v.residentId);
    if (!current || String(v.visitDate || v.createdAt) > String(current.visitDate || current.createdAt)) {
      latestVisitByResident.set(v.residentId, v);
    }
  });
  const riskCounts = { Low: 0, Moderate: 0, High: 0, Unassessed: 0 };
  latestVisitByResident.forEach((visit) => {
    // A visit without assessable vitals is UNASSESSED — never silently counted
    // as Low (consistent with the resident directory/detail/dashboard, which
    // report null for the same resident).
    const level = riskFromVitals(visit.vitals, riskConfig);
    riskCounts[level || 'Unassessed'] += 1;
  });
  const riskDistribution = [
    { name: 'Low Risk', value: riskCounts.Low },
    { name: 'Moderate Risk', value: riskCounts.Moderate },
    { name: 'High Risk', value: riskCounts.High },
    { name: 'Unassessed', value: riskCounts.Unassessed },
  ];

  // --- 12-month consultation & referral trend -------------------------------
  const months = lastTwelveMonths(now);
  const consultationTrends = months.map(({ key, label }) => {
    const monthVisits = scopedVisits.filter((v) => {
      const d = new Date(v.visitDate || v.createdAt);
      return !Number.isNaN(d.getTime()) && `${d.getFullYear()}-${d.getMonth()}` === key;
    });
    const monthReferrals = scopedReferrals.filter((r) => {
      const d = new Date(r.createdAt);
      return !Number.isNaN(d.getTime()) && `${d.getFullYear()}-${d.getMonth()}` === key;
    });
    return { month: label, consultations: monthVisits.length, referrals: monthReferrals.length };
  });

  const status = riskCounts.High > 0 ? 'Needs Attention' : riskCounts.Moderate > 0 ? 'Stable' : 'Healthy';

  return {
    scope: { barangay },
    summary: {
      consultationsThisMonth,
      referralsThisMonth,
      topCondition: topCondition.name,
      topConditionCases: topCondition.value,
      highRiskResidents: riskCounts.High,
      residents: scopedResidents.length,
    },
    status,
    consultationTrends,
    diseaseDistribution,
    riskDistribution,
    barangayOverview: {
      name: barangay || 'Municipality of Pili',
      residents: scopedResidents.length,
      consultations: consultationsThisMonth,
      status,
    },
  };
};

/**
 * Community Health Overview map data. Barangays are scoped to the caller:
 *   - a barangay-assigned Health Supervisor gets ONLY their barangay,
 *   - a municipality-wide caller (MHO / PHN) gets every barangay in their
 *     municipality.
 * Scope always comes from the authenticated session (barangay / municipalityId),
 * never a client id. Per-barangay resident and high-risk counts are real DB
 * figures (high-risk reuses the same latest-visit-vitals heuristic as Early
 * Warning). Coordinates are whatever is verified in `barangays`; a barangay with
 * no verified coordinate is returned with null lat/lng and is simply not plotted.
 *
 * Optional filters (all applied HERE, server-side, over real records):
 *   - `condition`: one of CONDITION_NAMES (or 'All'/null) — restricts cases to
 *     visits whose chief complaint classifies to that condition.
 *   - `status`: one of the persisted consultation workflow statuses.
 *   - `riskLevel`: a classification from recorded vitals, or Unassessed when
 *     the visit contains no assessable vital measurement.
 *   - `from` / `to`: ISO date strings bounding `visitDate` (inclusive). When
 *     omitted, all recorded visits are considered.
 *
 * Per-barangay case metrics (all derived from the scoped, filtered visits):
 *   - caseCount       : matching visits in range
 *   - newCases        : matching visits recorded in the current calendar month
 *   - activeCases     : matching visits whose status is not completed
 *   - completedCases  : matching visits whose status is completed
 *   - intensity       : caseCount relative to the busiest barangay (0..1), used
 *                       only to shade the heatmap; 0 when there is no data.
 */
const inDateRange = (isoDate, fromTs, toTs) => {
  if (fromTs === null && toTs === null) return true;
  const t = new Date(isoDate).getTime();
  if (Number.isNaN(t)) return false;
  if (fromTs !== null && t < fromTs) return false;
  if (toTs !== null && t > toTs) return false;
  return true;
};

export const communityMapRecordRisk = (visit, config = DEFAULT_RISK_CONFIG) =>
  riskFromVitals(visit?.vitals, config) || 'Unassessed';

export const matchesCommunityMapRecord = (
  visit,
  { condition = null, status = null, riskLevel = null, fromTs = null, toTs = null } = {},
  config = DEFAULT_RISK_CONFIG,
) => {
  if (!inDateRange(visit?.visitDate || visit?.createdAt, fromTs, toTs)) return false;
  if (condition && condition !== 'All' && classifyCondition(visit?.chiefComplaint) !== condition) return false;
  if (status && String(visit?.status || '').toLowerCase() !== status) return false;
  if (riskLevel && communityMapRecordRisk(visit, config) !== riskLevel) return false;
  return true;
};

export const getCommunityMap = async ({
  barangay = null,
  municipalityId = null,
  condition = null,
  status = null,
  riskLevel = null,
  from = null,
  to = null,
} = {}) => {
  const now = new Date();
  const [barangays, visitPage, tclPage, allResidents, municipality, riskConfig] = await Promise.all([
    repository.listBarangays({ municipalityId }),
    repository.listVisits({ limit: 5000 }),
    repository.listTclEntries({ limit: 5000 }),
    repository.searchResidents({ q: '', limit: 5000 }),
    // Best-effort: the centre point is a nicety for framing the map. If the
    // municipalities.latitude/longitude columns are not present yet (migration
    // not applied) or the lookup fails, fall back to null and let the client
    // frame the view from the plotted barangays.
    (async () => {
      if (typeof repository.getMunicipality !== 'function' || !municipalityId) return null;
      try {
        return await repository.getMunicipality(municipalityId);
      } catch {
        return null;
      }
    })(),
    getRiskConfig({ repo: repository }),
  ]);
  const visits = visitPage.rows;
  const tclEntries = tclPage.rows || [];

  const wantCondition = condition && condition !== 'All' ? String(condition) : null;
  const fromTs = from ? new Date(from).getTime() : null;
  const toTs = to ? new Date(`${String(to).slice(0, 10)}T23:59:59.999`).getTime() : null;

  // A barangay-scoped supervisor only ever sees their own barangay.
  const scopedBarangays = barangay
    ? barangays.filter((b) => String(b.name).trim().toLowerCase() === String(barangay).trim().toLowerCase())
    : barangays;

  const latestVisitByResident = new Map();
  let latestUpdatedTs = null;
  let latestUpdatedAt = null;
  visits.forEach((v) => {
    const current = latestVisitByResident.get(v.residentId);
    if (!current || String(v.visitDate || v.createdAt) > String(current.visitDate || current.createdAt)) {
      latestVisitByResident.set(v.residentId, v);
    }
  });

  const rows = scopedBarangays.map((b) => {
    const residents = allResidents.filter((r) => residentInBarangay(r, b, municipalityId));
    const residentIds = new Set(residents.map((r) => r.id));

    // Matching visits: this barangay's residents, within the date range and (if
    // requested) classified to the selected condition.
    const matching = visits.filter((v) => {
      if (!residentIds.has(v.residentId)) return false;
      const matches = matchesCommunityMapRecord(
        v,
        { condition: wantCondition, status, riskLevel, fromTs, toTs },
        riskConfig,
      );
      if (matches) {
        const updatedAt = v.updatedAt || v.createdAt || v.visitDate;
        const updatedTs = updatedAt ? new Date(updatedAt).getTime() : Number.NaN;
        if (!Number.isNaN(updatedTs) && (latestUpdatedTs === null || updatedTs > latestUpdatedTs)) {
          latestUpdatedTs = updatedTs;
          latestUpdatedAt = updatedAt;
        }
      }
      return matches;
    });

    const countsTuberculosis = !status && !riskLevel && (!wantCondition || wantCondition === 'Tuberculosis');
    const activeTbRows = countsTuberculosis
      ? tclEntries
        .filter((row) => residentIds.has(row.residentId) && isTbProgram(row.program) && String(row.status).toLowerCase() === 'active')
        .filter((row) => inDateRange(row.createdAt || row.lastVisit, fromTs, toTs))
      : [];
    const activeTbResidentIds = new Set(activeTbRows.map((row) => row.residentId));

    let activeCases = 0;
    let completedCases = 0;
    let newCases = 0;
    const activeVisitResidentIds = new Set();
    // Per-barangay condition distribution + most-recent record date, derived
    // from exactly the same classified visit records as the case counts and
    // Health Trends (classifyCondition) — never a second data source.
    const conditionCounts = new Map();
    const riskCounts = new Map(COMMUNITY_MAP_RISK_LEVELS.map((level) => [level, 0]));
    const statusCounts = new Map(COMMUNITY_MAP_STATUSES.map((value) => [value, 0]));
    let lastRecordedTs = null;
    let lastRecorded = null;
    const noteRecordDate = (value) => {
      const t = new Date(value).getTime();
      if (Number.isNaN(t)) return;
      if (lastRecordedTs === null || t > lastRecordedTs) {
        lastRecordedTs = t;
        lastRecorded = typeof value === 'string' ? value.slice(0, 10) : new Date(t).toISOString().slice(0, 10);
      }
    };
    matching.forEach((v) => {
      const normalizedStatus = String(v.status || '').toLowerCase();
      const normalizedRisk = communityMapRecordRisk(v, riskConfig);
      riskCounts.set(normalizedRisk, (riskCounts.get(normalizedRisk) || 0) + 1);
      if (statusCounts.has(normalizedStatus)) statusCounts.set(normalizedStatus, statusCounts.get(normalizedStatus) + 1);
      if (COMPLETED_STATUSES.has(normalizedStatus)) completedCases += 1;
      else {
        activeCases += 1;
        activeVisitResidentIds.add(v.residentId);
      }
      if (isSameMonth(v.visitDate || v.createdAt, now)) newCases += 1;
      const name = classifyCondition(v.chiefComplaint);
      conditionCounts.set(name, (conditionCounts.get(name) || 0) + 1);
      noteRecordDate(v.visitDate || v.createdAt);
    });
    const additionalActiveTbCases = [...activeTbResidentIds].filter((id) => !activeVisitResidentIds.has(id));
    activeCases += additionalActiveTbCases.length;
    const caseCount = matching.length + additionalActiveTbCases.length;
    newCases += new Set(activeTbRows
      .filter((row) => additionalActiveTbCases.includes(row.residentId) && isSameMonth(row.createdAt || row.lastVisit, now))
      .map((row) => row.residentId)).size;
    // Active TB program enrollments that are not already a visit contribute a
    // Tuberculosis case to the distribution (same rule as the case count).
    if (additionalActiveTbCases.length) {
      conditionCounts.set('Tuberculosis', (conditionCounts.get('Tuberculosis') || 0) + additionalActiveTbCases.length);
      activeTbRows
        .filter((row) => additionalActiveTbCases.includes(row.residentId))
        .forEach((row) => noteRecordDate(row.createdAt || row.lastVisit));
    }
    const conditions = [...conditionCounts.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name)));
    const topCondition = topConditionFrom(conditions);

    let highRiskResidents = 0;
    residents.forEach((r) => {
      const v = latestVisitByResident.get(r.id);
      if (v && riskFromVitals(v.vitals, riskConfig) === 'High') highRiskResidents += 1;
    });

    const latitude = Number(b.latitude);
    const longitude = Number(b.longitude);
    const hasCoordinates =
      b.latitude != null &&
      b.longitude != null &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180;
    return {
      id: b.id,
      name: b.name,
      latitude: hasCoordinates ? latitude : null,
      longitude: hasCoordinates ? longitude : null,
      hasCoordinates,
      residents: residents.length,
      highRiskResidents,
      caseCount,
      newCases,
      activeCases,
      completedCases,
      // Real per-barangay condition breakdown + headline condition + most
      // recent recorded date, for the Barangay Details card. All DB-derived.
      conditions,
      topCondition,
      riskCounts: Object.fromEntries(riskCounts),
      statusCounts: Object.fromEntries(statusCounts),
      lastRecorded,
      intensity: 0, // filled in below relative to the busiest barangay
    };
  });

  const maxCases = rows.reduce((m, r) => Math.max(m, r.caseCount), 0);
  rows.forEach((r) => {
    r.intensity = maxCases > 0 ? Number((r.caseCount / maxCases).toFixed(3)) : 0;
  });

  const summary = {
    totalCases: rows.reduce((s, r) => s + r.caseCount, 0),
    affectedBarangays: rows.filter((r) => r.caseCount > 0).length,
    newCases: rows.reduce((s, r) => s + r.newCases, 0),
    activeCases: rows.reduce((s, r) => s + r.activeCases, 0),
    completedCases: rows.reduce((s, r) => s + r.completedCases, 0),
  };

  const centerLatitude = Number(municipality?.latitude);
  const centerLongitude = Number(municipality?.longitude);
  const center =
    municipality?.latitude != null &&
    municipality?.longitude != null &&
    Number.isFinite(centerLatitude) &&
    Number.isFinite(centerLongitude) &&
    centerLatitude >= -90 &&
    centerLatitude <= 90 &&
    centerLongitude >= -180 &&
    centerLongitude <= 180
      ? { latitude: centerLatitude, longitude: centerLongitude }
      : null;

  return {
    scope: barangay ? 'barangay' : 'municipality',
    condition: wantCondition || 'All',
    status: status || 'All',
    riskLevel: riskLevel || 'All',
    reportingPeriod: { from: from || null, to: to || null },
    latestUpdatedAt,
    center,
    summary,
    barangays: rows,
  };
};

/**
 * Monthly health trend for the map's selected condition, scoped exactly like
 * `getCommunityMap`. Returns 12 months (Jan..Dec) of matching-visit counts for
 * the requested calendar year. When `barangay` is provided the trend is for
 * that single barangay; otherwise it aggregates the caller's whole scope.
 */
export const getCommunityMapTrends = async ({
  barangay = null,
  municipalityId = null,
  condition = null,
  status = null,
  riskLevel = null,
  from = null,
  to = null,
  year = new Date().getFullYear(),
} = {}) => {
  const [barangays, visitPage, tclPage, allResidents, riskConfig] = await Promise.all([
    repository.listBarangays({ municipalityId }),
    repository.listVisits({ limit: 5000 }),
    repository.listTclEntries({ limit: 5000 }),
    repository.searchResidents({ q: '', limit: 5000 }),
    getRiskConfig({ repo: repository }),
  ]);
  const visits = visitPage.rows;
  const tclEntries = tclPage.rows || [];
  const wantCondition = condition && condition !== 'All' ? String(condition) : null;
  const fromTs = from ? new Date(from).getTime() : null;
  const toTs = to ? new Date(`${String(to).slice(0, 10)}T23:59:59.999`).getTime() : null;

  const scopedBarangays = barangay
    ? barangays.filter((b) => String(b.name).trim().toLowerCase() === String(barangay).trim().toLowerCase())
    : barangays;

  const residentInScope = new Set(allResidents.filter((resident) =>
    scopedBarangays.some((barangayRow) => residentInBarangay(resident, barangayRow, municipalityId)),
  ).map((r) => r.id));

  const monthly = MONTH_LABELS.map((label, index) => {
    const monthVisits = visits.filter((v) => {
      if (!residentInScope.has(v.residentId)) return false;
      const d = new Date(v.visitDate || v.createdAt);
      if (Number.isNaN(d.getTime())) return false;
      if (d.getFullYear() !== Number(year) || d.getMonth() !== index) return false;
      return matchesCommunityMapRecord(
        v,
        { condition: wantCondition, status, riskLevel, fromTs, toTs },
        riskConfig,
      );
    });
    const visitResidents = new Set(monthVisits.map((visit) => visit.residentId));
    const activeTbResidents = new Set(
      (!status && !riskLevel && (!wantCondition || wantCondition === 'Tuberculosis') ? tclEntries : [])
        .filter((row) => residentInScope.has(row.residentId) && isTbProgram(row.program) && String(row.status).toLowerCase() === 'active')
        .filter((row) => {
          const d = new Date(row.createdAt || row.lastVisit);
          return !Number.isNaN(d.getTime()) &&
            d.getFullYear() === Number(year) &&
            d.getMonth() === index &&
            inDateRange(row.createdAt || row.lastVisit, fromTs, toTs);
        })
        .map((row) => row.residentId),
    );
    const count = monthVisits.length + [...activeTbResidents].filter((id) => !visitResidents.has(id)).length;
    return { month: label, cases: count };
  });

  return {
    scope: barangay ? 'barangay' : 'municipality',
    barangay: barangay || null,
    condition: wantCondition || 'All',
    status: status || 'All',
    riskLevel: riskLevel || 'All',
    reportingPeriod: { from: from || null, to: to || null },
    year: Number(year),
    monthly,
  };
};

/** The condition list that populates the disease filter dropdown. */
export const getConditionOptions = async () => ({ conditions: CONDITION_NAMES });

/**
 * Privacy-preserving household totals aggregated at the barangay reference
 * point. Household GPS coordinates and row identifiers are deliberately never
 * returned; only valid stored barangay reference coordinates may be mapped.
 */
export const getHouseholdMap = async ({ barangay = null, municipalityId = null } = {}) => {
  const [households, visitPage, tclPage, barangays] = await Promise.all([
    repository.listHouseholdsForMap({ barangay, municipalityId }),
    repository.listVisits({ limit: 5000 }),
    repository.listTclEntries({ limit: 5000 }),
    repository.listBarangays({ municipalityId }),
  ]);
  const visits = visitPage.rows || [];
  const tclEntries = tclPage.rows || [];

  // Resident ids with an active (non-completed) visit.
  const activeVisitResidentIds = new Set(
    visits
      .filter((v) => !COMPLETED_STATUSES.has(String(v.status || '').toLowerCase()))
      .map((v) => v.residentId),
  );
  // Resident ids with an active TB program entry.
  const activeTbResidentIds = new Set(
    tclEntries
      .filter((row) => isTbProgram(row.program) && String(row.status).toLowerCase() === 'active')
      .map((row) => row.residentId),
  );

  const householdTotals = new Map();
  households.forEach((hh) => {
    const activeResidentIds = hh.residentIds.filter(
      (id) => activeVisitResidentIds.has(id) || activeTbResidentIds.has(id),
    );
    const key = hh.barangayId || String(hh.barangay || '').trim().toLowerCase();
    const total = householdTotals.get(key) || {
      barangayId: hh.barangayId || null,
      barangay: hh.barangay || '',
      householdCount: 0,
      memberCount: 0,
      activeHouseholds: 0,
    };
    total.householdCount += 1;
    total.memberCount += Number(hh.memberCount) || 0;
    if (activeResidentIds.length) total.activeHouseholds += 1;
    householdTotals.set(key, total);
  });

  const locations = [];
  let unplottedBarangays = 0;
  for (const [key, total] of householdTotals) {
    const row = barangays.find((item) =>
      (total.barangayId && String(item.id) === String(total.barangayId)) ||
      (!total.barangayId && String(item.name).trim().toLowerCase() === String(total.barangay).trim().toLowerCase()),
    );
    const latitude = Number(row?.latitude);
    const longitude = Number(row?.longitude);
    const hasCoordinates =
      row?.latitude != null &&
      row?.longitude != null &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180;
    if (!hasCoordinates) {
      unplottedBarangays += 1;
      continue;
    }
    locations.push({
      barangay: row.name,
      householdCount: total.householdCount,
      memberCount: total.memberCount,
      activeHouseholds: total.activeHouseholds,
      hasCoordinates: true,
      latitude,
      longitude,
    });
  }

  return {
    scope: barangay ? 'barangay' : 'municipality',
    summary: {
      households: households.length,
      plotted: locations.length,
      unplotted: unplottedBarangays,
      activeCaseHouseholds: [...householdTotals.values()].reduce((sum, row) => sum + row.activeHouseholds, 0),
    },
    locations,
  };
};

export default { getEarlyWarning, getCommunityMap, getCommunityMapTrends, getConditionOptions, getHouseholdMap };
