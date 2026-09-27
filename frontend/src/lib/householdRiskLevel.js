/**
 * Household risk-level presentation mapping — the SINGLE source of truth for
 * turning the server-computed `households.risk_level` (High / Moderate / Low,
 * see backend/src/utils/householdRisk.js) into UI labels, tones and grouped
 * counts. Keeping it here means pages never duplicate the status conversion and
 * never invent a second risk algorithm.
 */

export const HOUSEHOLD_RISK_LEVELS = ["High", "Moderate", "Low"];

export const HOUSEHOLD_RISK_META = {
  High: {
    label: "High Risk",
    chip: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    dot: "bg-brand-danger",
  },
  Moderate: {
    label: "Moderate Risk",
    chip: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400",
    dot: "bg-brand-accent",
  },
  Low: {
    label: "Low Risk",
    chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    dot: "bg-brand-green",
  },
};

const RISK_RANK = { High: 3, Moderate: 2, Low: 1 };

/** Normalize any server value to one of the three known levels (defaults Low). */
export const normalizeHouseholdRiskLevel = (value) =>
  value === "High" || value === "Moderate" ? value : "Low";

/** Sort weight (highest risk first). */
export const householdRiskRank = (value) => RISK_RANK[normalizeHouseholdRiskLevel(value)];

/**
 * Count households per normalized risk level. Returns { High, Moderate, Low }
 * with zeroed buckets so the count cards always reflect the real records — a
 * failed/empty request is represented as zero counts, never fabricated data.
 */
export const countByRiskLevel = (households = []) => {
  const counts = { High: 0, Moderate: 0, Low: 0 };
  for (const h of households) {
    counts[normalizeHouseholdRiskLevel(h?.riskLevel)] += 1;
  }
  return counts;
};

export default {
  HOUSEHOLD_RISK_LEVELS,
  HOUSEHOLD_RISK_META,
  normalizeHouseholdRiskLevel,
  householdRiskRank,
  countByRiskLevel,
};
