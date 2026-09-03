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
  { name: 'Hypertension', keywords: ['hypertension', 'blood pressure', 'elevated blood'] },
  { name: 'Diabetes', keywords: ['diabetes', 'blood sugar', 'glucose', 'hba1c'] },
  { name: 'Respiratory', keywords: ['respiratory', 'asthma', 'cough', 'pneumonia', 'tuberculosis', 'tb'] },
  { name: 'Maternal', keywords: ['prenatal', 'pregnan', 'postnatal', 'postpartum'] },
  { name: 'Anemia', keywords: ['anemia', 'anaemia', 'pallor', 'cbc'] },
  { name: 'Gastrointestinal', keywords: ['epigastric', 'abdominal', 'diarrhea', 'vomiting', 'heartburn'] },
];

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

export const getEarlyWarning = async ({ barangay = null } = {}) => {
  const now = new Date();

  // --- load the source records, then filter to the caller's barangay -------
  const [visitPage, referralPage, allResidents] = await Promise.all([
    repository.listVisits({ limit: 5000 }),
    repository.listReferrals({ limit: 5000 }),
    repository.searchResidents({ q: '', limit: 5000 }),
  ]);
  const visits = visitPage.rows;
  const referrals = referralPage.rows;

  const scopedResidents = barangay ? allResidents.filter((r) => sameBarangay(r, barangay)) : allResidents;
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

export default { getEarlyWarning };
