/**
 * KALUSAGAP — reusable reporting-period abstraction.
 *
 * ONE shared definition of what a reporting period IS and the date range it
 * covers, used by every maternal/FHSIS reporting surface (screen filtering,
 * chart breakdown, the "Showing:" label and the exported/printed M1 report)
 * so Monthly / Quarterly / Annual can never diverge between views.
 *
 * A period is described by a plain object:
 *
 *   { type: 'monthly' | 'quarterly' | 'annual',
 *     year:    number,
 *     month:   number | null,     // 0-11 (monthly only)
 *     quarter: 1 | 2 | 3 | 4 | null } // (quarterly only)
 *
 * (`period` is accepted as an alias of `type` so callers can keep their
 * existing state key.)
 *
 * DATE RANGES use a half-open interval [start, endExclusive):
 *   date >= start AND date < endExclusive
 * which avoids the 23:59:59 inclusive-end edge cases the spec warns about when
 * the underlying column is a timestamp.
 *
 *   Monthly  Oct 2026 → [2026-10-01, 2026-11-01)
 *   Q4 2026  → [2026-10-01, 2027-01-01)   (Oct + Nov + Dec)
 *   Annual   2026 → [2026-01-01, 2027-01-01)
 */

export const PERIOD_TYPES = ["monthly", "quarterly", "annual"];
export const QUARTERS = [1, 2, 3, 4];

/** 0-based calendar months belonging to each quarter. */
export const QUARTER_MONTHS_0 = {
  1: [0, 1, 2],
  2: [3, 4, 5],
  3: [6, 7, 8],
  4: [9, 10, 11],
};

/** Human-readable month coverage for each quarter. */
export const QUARTER_RANGE_LABEL = {
  1: "January–March",
  2: "April–June",
  3: "July–September",
  4: "October–December",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Quarter (1-4) that a 0-based month belongs to. */
export const quarterOfMonth0 = (month0) => Math.floor((Number(month0) || 0) / 3) + 1;

/** 0-based months of a quarter (defaults to Q1 for an invalid quarter). */
export const quarterMonths0 = (quarter) => QUARTER_MONTHS_0[Number(quarter)] || QUARTER_MONTHS_0[1];

/** Ordinal label for a quarter, e.g. 4 → "4th". */
export const quarterOrdinal = (quarter) => {
  const q = Number(quarter);
  return `${q}${({ 1: "st", 2: "nd", 3: "rd" }[q]) || "th"}`;
};

const typeOf = (descriptor = {}) => descriptor.type || descriptor.period || "monthly";

/**
 * Date range [start, endExclusive) for a reporting period. Returns native Date
 * objects built from LOCAL calendar components (so a record's local date is
 * compared on the same calendar the user selected, never shifted by UTC).
 */
export const periodRange = (descriptor = {}) => {
  const type = typeOf(descriptor);
  const year = Number(descriptor.year);
  if (type === "monthly") {
    const m = Number(descriptor.month) || 0;
    return { start: new Date(year, m, 1), endExclusive: new Date(year, m + 1, 1) };
  }
  if (type === "quarterly") {
    const months = quarterMonths0(descriptor.quarter);
    return { start: new Date(year, months[0], 1), endExclusive: new Date(year, months[2] + 1, 1) };
  }
  // annual
  return { start: new Date(year, 0, 1), endExclusive: new Date(year + 1, 0, 1) };
};

/** True when a date value falls inside the reporting period [start, end). */
export const inReportingPeriod = (dateValue, descriptor) => {
  if (!dateValue) return false;
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return false;
  const { start, endExclusive } = periodRange(descriptor);
  return d >= start && d < endExclusive;
};

/**
 * Human-readable period label for the "Showing:" line and list captions.
 *   monthly   → "October 2026"
 *   quarterly → "Q4 2026 · October–December"
 *   annual    → "2026 Annual"
 */
export const periodLabel = (descriptor = {}) => {
  const type = typeOf(descriptor);
  const year = descriptor.year;
  if (type === "monthly") return `${MONTH_NAMES[Number(descriptor.month) || 0]} ${year}`;
  if (type === "quarterly") {
    const q = Number(descriptor.quarter) || 1;
    return `Q${q} ${year} · ${QUARTER_RANGE_LABEL[q]}`;
  }
  return `${year} Annual`;
};

/**
 * Label for the official FHSIS form header slot ("FHSIS REPORT for the ___ of
 * Year YYYY"). Keeps the existing form wording; only the period token varies.
 *   monthly   → "October"
 *   quarterly → "4th Quarter (October–December)"
 *   annual    → "Whole Year (January–December)"
 */
export const fhsisPeriodLabel = (descriptor = {}) => {
  const type = typeOf(descriptor);
  if (type === "monthly") return MONTH_NAMES[Number(descriptor.month) || 0];
  if (type === "quarterly") {
    const q = Number(descriptor.quarter) || 1;
    return `${quarterOrdinal(q)} Quarter (${QUARTER_RANGE_LABEL[q]})`;
  }
  return "Whole Year (January–December)";
};

/**
 * Query parameters for the backend M1 period report (GET /m1/report). The
 * backend aggregates the SAME persisted records server-side (barangay-scoped),
 * so the exported/printed PDF uses the same data the screen shows.
 *   monthly   → { period, year, month }   (month is 1-12 for the API)
 *   quarterly → { period, year, quarter }
 *   annual    → { period, year }
 */
export const toReportParams = (descriptor = {}) => {
  const type = typeOf(descriptor);
  const year = Number(descriptor.year);
  if (type === "quarterly") return { period: "quarterly", year, quarter: Number(descriptor.quarter) || 1 };
  if (type === "annual") return { period: "annual", year };
  return { period: "monthly", year, month: (Number(descriptor.month) || 0) + 1 };
};

export default {
  PERIOD_TYPES,
  QUARTERS,
  QUARTER_MONTHS_0,
  QUARTER_RANGE_LABEL,
  quarterOfMonth0,
  quarterMonths0,
  quarterOrdinal,
  periodRange,
  inReportingPeriod,
  periodLabel,
  fhsisPeriodLabel,
  toReportParams,
};
