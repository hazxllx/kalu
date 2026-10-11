/**
 * Canonical risk-level vocabulary for household/resident risk.
 *
 * The resident and household risk engines emit "Low" / "Moderate" / "High".
 * The prototype triage engine (lib/riskRules.js) emits "Medium" as a legacy
 * alias of "Moderate". Rather than scattering `=== "Moderate" || === "Medium"`
 * comparisons across the map, legends, and reports, normalize once at the
 * presentation boundary with `canonicalRiskLevel`.
 *
 * This does NOT merge or redefine categories: "Medium" and "Moderate" already
 * denote the same tier. Persisted values keep working because the normalizer is
 * case-insensitive and accepts both spellings; unknown values return null so a
 * caller can treat them as "no data" instead of silently mislabelling them Low.
 */

export const RISK_LEVELS = Object.freeze({
  LOW: 'Low',
  MODERATE: 'Moderate',
  HIGH: 'High',
  CRITICAL: 'Critical',
  UNASSESSED: 'Unassessed',
});

const ALIASES = {
  low: 'Low',
  moderate: 'Moderate',
  medium: 'Moderate', // legacy alias
  high: 'High',
  critical: 'Critical',
  unassessed: 'Unassessed',
};

/**
 * Normalize a risk-level string to the canonical vocabulary.
 * @param {unknown} value
 * @returns {('Low'|'Moderate'|'High'|'Critical'|'Unassessed'|null)} null for empty/unknown.
 */
export const canonicalRiskLevel = (value) => {
  const key = String(value ?? '').trim().toLowerCase();
  return ALIASES[key] || null;
};

export default { RISK_LEVELS, canonicalRiskLevel };
