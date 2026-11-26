// frontend/src/lib/riskLevel.js
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
  const key = String(value ?? '').trim().toLowerCase().replace(/\s+risk$/, '');
  return ALIASES[key] || null;
};

// Critical remains a distinct legacy category; it shares the high-risk tone.
export const RISK_PRESENTATION = Object.freeze({
  Low: { color: '#047857', tone: 'green', badge: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-700', text: 'text-emerald-700' },
  Moderate: { color: '#b45309', tone: 'amber', badge: 'bg-amber-50 text-amber-700', bar: 'bg-amber-700', text: 'text-amber-700' },
  High: { color: '#be123c', tone: 'red', badge: 'bg-rose-50 text-rose-700', bar: 'bg-rose-700', text: 'text-rose-700' },
  Critical: { color: '#be123c', tone: 'red', badge: 'bg-rose-50 text-rose-700', bar: 'bg-rose-700', text: 'text-rose-700' },
  Unassessed: { color: '#64748b', tone: 'slate', badge: 'bg-slate-100 text-slate-600', bar: 'bg-slate-500', text: 'text-slate-600' },
});

export const normalizeRiskDistribution = (distribution = []) => {
  const counts = new Map();
  for (const row of distribution) {
    const name = canonicalRiskLevel(row.name) || RISK_LEVELS.UNASSESSED;
    const value = Number(row.value);
    if (!Number.isFinite(value) || value < 0) continue;
    counts.set(name, (counts.get(name) || 0) + value);
  }
  return [...counts].map(([name, value]) => ({ name, value }));
};

export default { RISK_LEVELS, canonicalRiskLevel };
