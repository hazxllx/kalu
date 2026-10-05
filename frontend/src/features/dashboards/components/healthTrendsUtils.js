// Health trend derivation for the Health Supervisor dashboard.
//
// KALUSAGAP classifies each recorded consultation to a condition on the SERVER
// (`classifyCondition` in backend/src/services/analytics.service.js). The
// community-map analytics endpoint returns the per-barangay condition
// breakdown for the authenticated scope and the requested reporting period.
// These helpers only aggregate that already-authorized, already-classified
// data — they never invent a diagnosis, a case count, or a reporting period.

// The generic "Others" catch-all is not a named health condition, so it is
// never surfaced as a health trend.
const IGNORED_CONDITIONS = new Set(["Others", ""]);

/**
 * Sum the per-barangay condition breakdown into one ranked list.
 * @param {Array<{conditions?: Array<{name: string, value: number}>}>} barangays
 * @returns {Array<{name: string, value: number}>} most-recorded condition first
 */
export function aggregateConditionCounts(barangays = []) {
  const totals = new Map();

  (Array.isArray(barangays) ? barangays : []).forEach((barangay) => {
    const conditions = Array.isArray(barangay?.conditions) ? barangay.conditions : [];
    conditions.forEach((condition) => {
      const name = String(condition?.name || "").trim();
      if (!name || IGNORED_CONDITIONS.has(name)) return;
      const value = Number(condition?.value || 0);
      if (!Number.isFinite(value) || value <= 0) return;
      totals.set(name, (totals.get(name) || 0) + value);
    });
  });

  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

/**
 * Trend direction for one condition between two equivalent periods.
 * Returns null when either figure is not a usable number.
 */
export function conditionTrend(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (current > previous) return "increasing";
  if (current < previous) return "decreasing";
  return "unchanged";
}

/**
 * Rank the top recorded conditions for the selected period and, when a
 * comparable previous period is supplied, attach a trend direction.
 *
 * `previousBarangays` is the current period's structural twin (same scope, the
 * immediately preceding equivalent period). Pass `null` when historical data is
 * unavailable so each entry is returned as a plain case count with no invented
 * comparison.
 */
export function buildTopHealthTrends(currentBarangays = [], previousBarangays = null, { limit = 3 } = {}) {
  const current = aggregateConditionCounts(currentBarangays);
  const previous = Array.isArray(previousBarangays) ? aggregateConditionCounts(previousBarangays) : null;
  // A comparison is only meaningful when the previous period actually recorded
  // at least one classified condition; otherwise every trend would read as a
  // misleading increase from a period with no data.
  const previousByCondition = previous && previous.length > 0
    ? new Map(previous.map((condition) => [condition.name, condition.value]))
    : null;

  return current.slice(0, limit).map((condition, index) => {
    const previousValue = previousByCondition ? previousByCondition.get(condition.name) || 0 : null;
    return {
      rank: index + 1,
      name: condition.name,
      value: condition.value,
      previousValue,
      direction: previousValue == null ? null : conditionTrend(condition.value, previousValue),
    };
  });
}

export default { aggregateConditionCounts, conditionTrend, buildTopHealthTrends };
