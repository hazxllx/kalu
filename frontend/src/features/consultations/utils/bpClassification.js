import {
  BP_CATEGORIES, BP_READING_BOUNDS, DEFAULT_BP_THRESHOLDS,
  classifyBloodPressure as classify, parseBloodPressure,
} from '../../../../../shared/bloodPressure.js';

export { DEFAULT_BP_THRESHOLDS, parseBloodPressure };

// Preserve the existing badge appearance; classification comes from shared logic.
const badgeClasses = {
  // Keep the legacy keys for saved historical snapshots; new classifications
  // use the five shared reference categories only.
  low: 'bg-amber-50 text-amber-800',
  normal: 'bg-green-100 text-green-800',
  elevated: 'bg-yellow-100 text-yellow-800',
  stage1: 'bg-orange-100 text-orange-800',
  stage2: 'bg-red-100 text-red-800',
  crisis: 'bg-red-900 text-white',
  emergency: 'bg-red-900 text-white',
};
export const BP_CATEGORY_META = Object.freeze(Object.fromEntries(
  Object.entries(BP_CATEGORIES).map(([code, meta]) => [code, { ...meta, badgeClassName: badgeClasses[code] }]),
));

export const formatBloodPressureInput = (value, start, end, inputType) => {
  // Only insert a separator when appending or pasting a compact reading.
  // Leave explicit separators, mid-field edits and deletion under user control.
  if (inputType?.startsWith('delete') || start !== value.length || end !== start) return null;
  const digits = value.trim();
  if (!/^\d{4,6}$/.test(digits)) return null;
  const split = digits.length === 4 && Number(digits.slice(0, 3)) > BP_READING_BOUNDS.max ? 2 : 3;
  const formatted = `${digits.slice(0, split)}/${digits.slice(split)}`;
  return { value: formatted, caret: formatted.length };
};

export const classifyBloodPressure = (value, context = {}) => {
  const result = classify(value, context);
  return result ? { ...result, badgeClassName: badgeClasses[result.code] } : null;
};

export const bloodPressureBadgeClassName = (classification) =>
  classification?.badgeClassName || badgeClasses[classification?.code] || 'bg-brand-light text-brand-blue';

export default { classifyBloodPressure, parseBloodPressure, DEFAULT_BP_THRESHOLDS, BP_CATEGORY_META };
