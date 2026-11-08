import { fetchEarlyWarningData } from './earlyWarningApi';

/**
 * The existing monitoring view-model now comes from one aggregate-only RPC
 * response. No resident/household/clinical row lists or capped browser-side
 * counts are loaded. PostgreSQL resolves actor scope and the Manila calendar.
 * A missing source or aggregate block is unavailable, not a successful zero.
 */

const count = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Monitoring aggregate data is unavailable.');
  return value;
};

/** Pure payload adapter; assignedBarangay labels only and never changes scope. */
export const buildBarangayHealthOverview = (ew, assignedBarangay = null) => {
  if (!ew?.summary || !ew.monitoring || !Array.isArray(ew.riskDistribution) ||
      !Array.isArray(ew.diseaseDistribution) || !Array.isArray(ew.consultationTrends)) {
    throw new Error('Monitoring aggregate data is unavailable.');
  }
  const summary = ew.summary;
  const monitoring = ew.monitoring;
  const highRisk = count(summary.highRiskResidents);
  const moderateRisk = count(ew.riskDistribution.find((row) => row.name === 'Moderate Risk')?.value);
  const lowRisk = count(ew.riskDistribution.find((row) => row.name === 'Low Risk')?.value);
  const assessedResidents = highRisk + moderateRisk + lowRisk;

  return {
    assignedBarangay: assignedBarangay || ew.scope?.barangay || null,
    metrics: {
      totalResidents: count(summary.residents),
      verifiedResidents: count(monitoring.verifiedResidents),
      totalHouseholds: count(monitoring.totalHouseholds),
      householdRisk: {
        High: count(monitoring.householdRisk?.High),
        Moderate: count(monitoring.householdRisk?.Moderate),
        Low: count(monitoring.householdRisk?.Low),
      },
      residentRisk: { high: highRisk, moderate: moderateRisk, low: lowRisk, assessed: assessedResidents },
      consultationsThisMonth: count(summary.consultationsThisMonth),
      referralsThisMonth: count(summary.referralsThisMonth),
      activeFollowUps: count(monitoring.activeFollowUps),
      pendingFollowUps: count(monitoring.pendingFollowUps),
      overdueFollowUps: count(monitoring.overdueFollowUps),
      upcomingFollowUps: count(monitoring.upcomingFollowUps),
      pendingReferrals: count(monitoring.pendingReferrals),
      totalReferrals: count(monitoring.totalReferrals),
      maternalCases: count(monitoring.maternalCases),
      activeMaternalCases: count(monitoring.activeMaternalCases),
      immunizationRecords: count(monitoring.immunizationRecords),
      topCondition: summary.topCondition || null,
      topConditionCases: count(summary.topConditionCases),
    },
    diseaseDistribution: ew.diseaseDistribution,
    consultationTrends: ew.consultationTrends,
    ...(ew.activity ? { activity: ew.activity } : {}),
    // The RPC fails as a whole if any required source cannot be read.
    sources: {
      earlyWarning: true,
      residents: true,
      households: true,
      followUps: true,
      maternal: true,
      immunizations: true,
      referrals: true,
    },
  };
};

export const getBarangayHealthOverview = async (assignedBarangay = null, {
  load = fetchEarlyWarningData, from = null, to = null, year = null,
} = {}) => buildBarangayHealthOverview(await (
  from || to || year != null ? load(undefined, { from, to, year }) : load()
), assignedBarangay);

export default { getBarangayHealthOverview };
