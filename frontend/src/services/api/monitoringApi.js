import { residentsApi } from './residentsApi';
import { householdsApi } from './householdsApi';
import { referralsApi } from './referralsApi';
import { followUpsApi, maternalApi, immunizationsApi } from './operationalApi';
import { fetchEarlyWarningData } from './earlyWarningApi';

/**
 * Community monitoring aggregation service.
 *
 * KALUSAGAP does NOT use maps or geographic coordinates for community
 * monitoring. Instead, this service composes a barangay HEALTH summary from the
 * existing, already barangay-scoped backend endpoints:
 *
 *   - GET /analytics/early-warning  (resident count, consultations/referrals
 *     this month, risk distribution from recorded vitals, top condition)
 *   - GET /residents                (verified directory count)
 *   - GET /households               (household risk levels)
 *   - GET /operational/followups    (active / pending / overdue follow-ups)
 *   - GET /operational/maternal     (M1 / maternal cases)
 *   - GET /operational/immunizations(immunization records)
 *   - GET /referrals                (referral coordination records)
 *
 * Every one of those endpoints resolves the barangay scope from the
 * authenticated session on the SERVER (see backend `resolveBarangayScope` and
 * the per-service scope filters) and Supabase RLS re-checks the same scope at
 * the database level. This module NEVER sends a barangay id from the client and
 * cannot widen scope — a Health Supervisor assigned to San Isidro only ever
 * receives San Isidro figures. No values are fabricated: a metric that has no
 * records simply reads 0.
 */

/** Normalize the various success envelopes to a plain array of rows. */
const rowsOf = (res) => {
  if (Array.isArray(res)) return res;
  if (!res || typeof res !== 'object') return [];
  return res.rows || res.records || res.data || [];
};

/** A resolved fetch that never rejects — a failed source contributes an empty set. */
const safe = (promise, fallback) => promise.then((v) => v).catch(() => fallback);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const lower = (v) => String(v ?? '').trim().toLowerCase();

const ACTIVE_FOLLOWUP = new Set(['scheduled', 'today', 'upcoming', 'ongoing']);
const PENDING_FOLLOWUP = new Set(['scheduled', 'upcoming']);
const OPEN_REFERRAL = new Set(['pending', 'accepted', 'in progress']);

const todayIso = () => new Date().toISOString().slice(0, 10);

/** A follow-up is overdue when it was scheduled before today and is still open, or explicitly Missed. */
const isOverdueFollowUp = (row, today) => {
  const status = lower(row.status);
  if (status === 'missed') return true;
  if (!ACTIVE_FOLLOWUP.has(status)) return false;
  const date = String(row.scheduled_date || row.scheduledDate || '').slice(0, 10);
  return Boolean(date) && date < today;
};

/**
 * Compose the barangay health overview for the signed-in Health Supervisor.
 *
 * The `assignedBarangay` is only used to LABEL the result — it does not filter
 * any query (the server does that from the session). Returns a normalized shape
 * with a `sources` map so the UI can render a precise empty/partial state when
 * an individual source was unavailable.
 */
export const getBarangayHealthOverview = async (assignedBarangay = null) => {
  const [earlyWarning, verified, households, followUps, maternal, immunizations, referrals] =
    await Promise.all([
      safe(fetchEarlyWarningData(), null),
      safe(residentsApi.list({ verified: true, limit: 100 }), null),
      safe(householdsApi.list({ limit: 200 }), null),
      safe(followUpsApi.list(), null),
      safe(maternalApi.list(), null),
      safe(immunizationsApi.list(), null),
      safe(referralsApi.list(), null),
    ]);

  const ew = earlyWarning || {};
  const ewSummary = ew.summary || {};
  const riskDistribution = Array.isArray(ew.riskDistribution) ? ew.riskDistribution : [];
  const findRisk = (name) => num(riskDistribution.find((r) => r.name === name)?.value);

  const householdRows = rowsOf(households);
  const householdRisk = { High: 0, Moderate: 0, Low: 0 };
  householdRows.forEach((h) => {
    const level = h.riskLevel || h.risk_level || 'Low';
    if (level in householdRisk) householdRisk[level] += 1;
  });

  const followUpRows = rowsOf(followUps);
  const today = todayIso();
  const activeFollowUps = followUpRows.filter((r) => ACTIVE_FOLLOWUP.has(lower(r.status))).length;
  const pendingFollowUps = followUpRows.filter((r) => PENDING_FOLLOWUP.has(lower(r.status))).length;
  const overdueFollowUps = followUpRows.filter((r) => isOverdueFollowUp(r, today)).length;
  const upcomingFollowUps = followUpRows.filter((r) => {
    const status = lower(r.status);
    if (!PENDING_FOLLOWUP.has(status)) return false;
    const date = String(r.scheduled_date || r.scheduledDate || '').slice(0, 10);
    return Boolean(date) && date >= today;
  }).length;

  const maternalRows = rowsOf(maternal);
  const activeMaternal = maternalRows.filter((r) => lower(r.status) === 'active').length;

  const referralRows = rowsOf(referrals);
  const pendingReferrals = referralRows.filter((r) => OPEN_REFERRAL.has(lower(r.status))).length;

  const totalResidents = num(ewSummary.residents);
  const highRisk = ewSummary.highRiskResidents != null ? num(ewSummary.highRiskResidents) : findRisk('High Risk');
  const moderateRisk = findRisk('Moderate Risk');
  const lowRisk = findRisk('Low Risk');
  const assessedResidents = highRisk + moderateRisk + lowRisk;

  return {
    assignedBarangay: assignedBarangay || ew.scope?.barangay || null,
    metrics: {
      totalResidents,
      verifiedResidents: rowsOf(verified).length,
      totalHouseholds: householdRows.length,
      householdRisk,
      residentRisk: { high: highRisk, moderate: moderateRisk, low: lowRisk, assessed: assessedResidents },
      consultationsThisMonth: num(ewSummary.consultationsThisMonth),
      referralsThisMonth: num(ewSummary.referralsThisMonth),
      activeFollowUps,
      pendingFollowUps,
      overdueFollowUps,
      upcomingFollowUps,
      pendingReferrals,
      totalReferrals: referralRows.length,
      maternalCases: maternalRows.length,
      activeMaternalCases: activeMaternal,
      immunizationRecords: rowsOf(immunizations).length,
      topCondition: ewSummary.topCondition || null,
      topConditionCases: num(ewSummary.topConditionCases),
    },
    diseaseDistribution: Array.isArray(ew.diseaseDistribution) ? ew.diseaseDistribution : [],
    consultationTrends: Array.isArray(ew.consultationTrends) ? ew.consultationTrends : [],
    // Which sources answered, so the page can distinguish "no records" from
    // "this source could not be reached".
    sources: {
      earlyWarning: earlyWarning != null,
      residents: verified != null,
      households: households != null,
      followUps: followUps != null,
      maternal: maternal != null,
      immunizations: immunizations != null,
      referrals: referrals != null,
    },
  };
};

export default { getBarangayHealthOverview };
