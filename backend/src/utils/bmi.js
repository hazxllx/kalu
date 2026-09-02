/**
 * BMI + vital-sign helpers shared by intake services and referral generation.
 *
 * BMI = weight (kg) / (height (m))^2. Height is captured in centimetres and
 * converted to metres internally. The value is NEVER accepted from the client:
 * it is always recomputed server-side from the stored height/weight.
 */

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * @param {number|string|null|undefined} heightCm  height in centimetres
 * @param {number|string|null|undefined} weightKg  weight in kilograms
 * @returns {{ bmi: number|null, category: string|null }}
 *          nulls when either input is missing/not a positive number
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
 * WHO adult BMI classification for a computed BMI value.
 * @param {number|null} bmi
 */
export const bmiCategory = (bmi) => {
  if (bmi === null || !Number.isFinite(bmi)) return null;
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
};

/**
 * Validates that a recorded vital sign is a plausible positive number.
 * @param {*} value
 * @param {{ min?: number, max?: number, required?: boolean }} opts
 */
export const isPlausibleVital = (value, { min = 0, max = Infinity, required = true } = {}) => {
  if (value === null || value === undefined || value === '') return !required;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
};

/**
 * Parses a blood-pressure string ("120/80") into systolic/diastolic numbers.
 * Returns nulls when the shape is not a valid two-part BP.
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
 * Formats an ISO date-time string for document headers, e.g.
 * "September 3, 2026, 9:30 AM". Locale-independent.
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
