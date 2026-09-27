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
export const CONDITION_NAMES = Object.freeze(CONDITION_RULES.map((r) => r.name));

/** Completed / resolved visit statuses vs. still-active ones. */
const COMPLETED_STATUSES = new Set(['completed']);

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sameBarangay = (resident, barangay) =>
  String(resident?.barangay ?? '').trim().toLowerCase() === String(barangay).trim().toLowerCase();

const classifyCondition = (text) => {
  const haystack = String(text || '').toLowerCase();
  const rule = CONDITION_RULES.find((r) => r.keywords.some((k) => haystack.includes(k)));
  return rule ? rule.name : 'Others';
};

/** Conservative risk heuristic from the latest recorded vitals. */
const systolicOf = (vitals) => {
  const match = /(\d{2,3})\s*\/\s*\d{2,3}/.exec(String(vitals?.bp || ''));
  return match ? parseInt(match[1], 10) : null;
};

const riskFromVitals = (vitals) => {
  const systolic = systolicOf(vitals);
  const o2 = Number(vitals?.o2sat);
  if ((systolic && systolic >= 140) || (Number.isFinite(o2) && o2 < 95)) return 'High';
  if (systolic && systolic >= 130) return 'Moderate';
  return 'Low';
};

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
  const [visitPage, referralPage, allResidents] = await Promise.all([
    repository.listVisits({ limit: 5000 }),
    repository.listReferrals({ limit: 5000 }),
    repository.searchResidents({ q: '', limit: 5000 }),
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
    const name = classifyCondition(v.chiefComplaint);
    conditionCounts[name] = (conditionCounts[name] || 0) + 1;
  });
  const diseaseDistribution = Object.entries(conditionCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const topCondition = diseaseDistribution[0] || { name: 'No consultations recorded', value: 0 };

  // Risk per resident from their most recent visit's vitals.
  const latestVisitByResident = new Map();
  scopedVisits.forEach((v) => {
    const current = latestVisitByResident.get(v.residentId);
    if (!current || String(v.visitDate || v.createdAt) > String(current.visitDate || current.createdAt)) {
      latestVisitByResident.set(v.residentId, v);
    }
  });
  const riskCounts = { Low: 0, Moderate: 0, High: 0 };
  latestVisitByResident.forEach((visit) => {
    riskCounts[riskFromVitals(visit.vitals)] += 1;
  });
  const riskDistribution = [
    { name: 'Low Risk', value: riskCounts.Low },
    { name: 'Moderate Risk', value: riskCounts.Moderate },
    { name: 'High Risk', value: riskCounts.High },
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
 *   - `condition`: one of CONDITION_NAMES (or 'All'/null) — restricts the case
 *     counts to visits whose chief complaint classifies to that condition.
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

export const getCommunityMap = async ({
  barangay = null,
  municipalityId = null,
  condition = null,
  from = null,
  to = null,
} = {}) => {
  const now = new Date();
  const [barangays, visitPage, allResidents, municipality] = await Promise.all([
    repository.listBarangays({ municipalityId }),
    repository.listVisits({ limit: 5000 }),
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
  ]);
  const visits = visitPage.rows;

  const wantCondition = condition && condition !== 'All' ? String(condition) : null;
  const fromTs = from ? new Date(from).getTime() : null;
  const toTs = to ? new Date(`${String(to).slice(0, 10)}T23:59:59`).getTime() : null;

  // A barangay-scoped supervisor only ever sees their own barangay.
  const scopedBarangays = barangay
    ? barangays.filter((b) => String(b.name).trim().toLowerCase() === String(barangay).trim().toLowerCase())
    : barangays;

  const latestVisitByResident = new Map();
  visits.forEach((v) => {
    const current = latestVisitByResident.get(v.residentId);
    if (!current || String(v.visitDate || v.createdAt) > String(current.visitDate || current.createdAt)) {
      latestVisitByResident.set(v.residentId, v);
    }
  });

  const rows = scopedBarangays.map((b) => {
    const residents = allResidents.filter((r) => sameBarangay(r, b.name));
    const residentIds = new Set(residents.map((r) => r.id));

    // Matching visits: this barangay's residents, within the date range and (if
    // requested) classified to the selected condition.
    const matching = visits.filter((v) => {
      if (!residentIds.has(v.residentId)) return false;
      if (!inDateRange(v.visitDate || v.createdAt, fromTs, toTs)) return false;
      if (wantCondition && classifyCondition(v.chiefComplaint) !== wantCondition) return false;
      return true;
    });

    let activeCases = 0;
    let completedCases = 0;
    let newCases = 0;
    matching.forEach((v) => {
      if (COMPLETED_STATUSES.has(String(v.status || '').toLowerCase())) completedCases += 1;
      else activeCases += 1;
      if (isSameMonth(v.visitDate || v.createdAt, now)) newCases += 1;
    });

    let highRiskResidents = 0;
    residents.forEach((r) => {
      const v = latestVisitByResident.get(r.id);
      if (v && riskFromVitals(v.vitals) === 'High') highRiskResidents += 1;
    });

    const hasCoordinates = b.latitude != null && b.longitude != null;
    return {
      id: b.id,
      name: b.name,
      latitude: hasCoordinates ? Number(b.latitude) : null,
      longitude: hasCoordinates ? Number(b.longitude) : null,
      hasCoordinates,
      residents: residents.length,
      highRiskResidents,
      caseCount: matching.length,
      newCases,
      activeCases,
      completedCases,
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

  const center =
    municipality && municipality.latitude != null && municipality.longitude != null
      ? { latitude: Number(municipality.latitude), longitude: Number(municipality.longitude) }
      : null;

  return {
    scope: barangay ? 'barangay' : 'municipality',
    condition: wantCondition || 'All',
    reportingPeriod: { from: from || null, to: to || null },
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
  year = new Date().getFullYear(),
} = {}) => {
  const [barangays, visitPage, allResidents] = await Promise.all([
    repository.listBarangays({ municipalityId }),
    repository.listVisits({ limit: 5000 }),
    repository.searchResidents({ q: '', limit: 5000 }),
  ]);
  const visits = visitPage.rows;
  const wantCondition = condition && condition !== 'All' ? String(condition) : null;

  const scopedBarangays = barangay
    ? barangays.filter((b) => String(b.name).trim().toLowerCase() === String(barangay).trim().toLowerCase())
    : barangays;
  const scopeNames = new Set(scopedBarangays.map((b) => String(b.name).trim().toLowerCase()));

  const residentInScope = new Set(
    allResidents.filter((r) => scopeNames.has(String(r.barangay ?? '').trim().toLowerCase())).map((r) => r.id),
  );

  const monthly = MONTH_LABELS.map((label, index) => {
    const count = visits.filter((v) => {
      if (!residentInScope.has(v.residentId)) return false;
      const d = new Date(v.visitDate || v.createdAt);
      if (Number.isNaN(d.getTime())) return false;
      if (d.getFullYear() !== Number(year) || d.getMonth() !== index) return false;
      if (wantCondition && classifyCondition(v.chiefComplaint) !== wantCondition) return false;
      return true;
    }).length;
    return { month: label, cases: count };
  });

  return {
    scope: barangay ? 'barangay' : 'municipality',
    barangay: barangay || null,
    condition: wantCondition || 'All',
    year: Number(year),
    monthly,
  };
};

/** The condition list that populates the disease filter dropdown. */
export const getConditionOptions = async () => ({ conditions: CONDITION_NAMES });

export default { getEarlyWarning, getCommunityMap, getCommunityMapTrends, getConditionOptions };
