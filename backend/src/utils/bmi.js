// backend/src/utils/bmi.js
/**
 * @module utils/bmi
 * @description Server-authoritative BMI calculation, vital-sign validation, blood-pressure
 * parsing, and clinical document timestamp formatting utilities.
 *
 * Architectural layer:
 *   `route -> authenticate -> authorize -> controller -> service (uses utils/bmi) -> repository/Supabase`
 *
 * Shared across clinical consultation intake services, resident risk evaluation
 * (`utils/residentRisk.js`), and referral document generation. BMI is computed as
 * `weight (kg) / (height (m))^2` (converting centimetres to metres internally) and
 * is NEVER trusted from client payloads — it is always recomputed server-side from
 * recorded height and weight.
 */

/** Rounds a numeric value to one decimal place. */
const round1 = (value) => Math.round(value * 10) / 10;

/**
 * Computes Body Mass Index (rounded to 1 decimal place) and its WHO adult category
 * from height in centimetres and weight in kilograms.
 *
 * @param {number|string|null|undefined} heightCm - Recorded height in centimetres.
 * @param {number|string|null|undefined} weightKg - Recorded weight in kilograms.
 * @returns {Object} `{ bmi: number|null, category: string|null }` — both properties
 *   are `null` when either input is missing, non-numeric, or `<= 0`.
 */
export const computeBMI = (heightCm, weightKg) => {
  const h = Number(heightCm);
  const w = Number(weightKg);
  if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) {
    return { bmi: null, category: null };
  }
  const heightM = h / 100;
  const bmi = round1(w / (heightM * heightM));
  return { bmi, category: bmiCategory(bmi) };
};

/**
 * Classifies a computed BMI value using standard WHO adult cutoffs:
 *   - `< 18.5`  -> `'Underweight'`
 *   - `18.5–24.9` -> `'Normal'`
 *   - `25.0–29.9` -> `'Overweight'`
 *   - `>= 30.0` -> `'Obese'`
 *
 * @param {number|null|undefined} bmi - Computed numeric BMI.
 * @returns {string|null} WHO BMI category label, or `null` when `bmi` is null/non-finite.
 */
export const bmiCategory = (bmi) => {
  if (bmi === null || !Number.isFinite(bmi)) return null;
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
};

/**
 * Checks whether a recorded vital sign falls within an inclusive `[min, max]`
 * physiological range. Empty values (`null`, `undefined`, `''`) pass only when
 * `required` is explicitly set to `false`.
 *
 * @param {*} value - Raw vital-sign value to validate.
 * @param {Object} [opts={}] - Validation range and presence rules.
 * @param {number} [opts.min=0] - Minimum allowed numeric value (inclusive).
 * @param {number} [opts.max=Infinity] - Maximum allowed numeric value (inclusive).
 * @param {boolean} [opts.required=true] - Whether empty values should be rejected.
 * @returns {boolean} `true` if the value satisfies presence and range constraints.
 */
export const isPlausibleVital = (value, { min = 0, max = Infinity, required = true } = {}) => {
  if (value === null || value === undefined || value === '') return !required;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
};

/**
 * Parses a slash-delimited blood-pressure reading (e.g., `"120/80"`) into
 * numeric systolic and diastolic components.
 *
 * @param {*} value - Raw blood-pressure string or value.
 * @returns {Object|null} `{ systolic: number, diastolic: number }`, or `null` when
 *   empty or not a valid two-part finite numeric reading.
 */
export const parseBP = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parts = raw.split('/');
  if (parts.length !== 2) return null;
  const sys = Number(parts[0].trim());
  const dia = Number(parts[1].trim());
  if (!Number.isFinite(sys) || !Number.isFinite(dia)) return null;
  return { systolic: sys, diastolic: dia };
};

/**
 * Formats an ISO-8601 date-time string for printable clinical/referral document
 * headers (e.g., `"September 3, 2026, 9:30 AM"`), pinned to the `'en-PH'` locale
 * so output does not vary with the host OS locale.
 *
 * @param {string|Date|null|undefined} iso - ISO timestamp or Date-compatible input.
 * @returns {string} Formatted date-time string, `''` if empty, or raw `String(iso)` if unparseable.
 */
export const formatDateTimeForDocument = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const date = d.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const time = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
};

export default { computeBMI, bmiCategory, isPlausibleVital, parseBP, formatDateTimeForDocument };
