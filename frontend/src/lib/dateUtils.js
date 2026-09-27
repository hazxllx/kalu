// Shared date utilities for KALUSAGAP.
//
// The application works with two kinds of dates:
//   1. "date-only" application dates (report boundaries, filter ranges, the
//      current-day cut-off). These must reflect the user's LOCAL calendar day
//      (Philippine time in production) and must never shift to the previous
//      day because of a UTC conversion.
//   2. Human-readable display labels shown in the UI.
//
// The single most important rule here is that date-only values are derived
// from a Date's LOCAL components (getFullYear / getMonth / getDate), never from
// toISOString(), which returns UTC. Using toISOString().slice(0, 10) on a local
// midnight (e.g. new Date(2026, 0, 1) in UTC+8) yields the PREVIOUS day in the
// PREVIOUS year ("2025-12-31"), which was the source of the heatmap date bug.

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Format a Date into a "YYYY-MM-DD" string using its LOCAL calendar day.
 *
 * This is the correct replacement for `date.toISOString().slice(0, 10)` when
 * the intended value is a local (Philippine) calendar date. It does not shift
 * the day backwards across the UTC boundary.
 */
export function toLocalISODate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Today's local calendar date as "YYYY-MM-DD". */
export function todayISODate(now = new Date()) {
  return toLocalISODate(now);
}

/** January 1 of the given (or current) local year as "YYYY-MM-DD". */
export function startOfYearISODate(now = new Date()) {
  return `${now.getFullYear()}-01-01`;
}

/** The current local calendar year as a number. */
export function currentYear(now = new Date()) {
  return now.getFullYear();
}

/**
 * Parse a value into a Date interpreted in LOCAL time.
 *
 * A bare "YYYY-MM-DD" string is parsed from its components as local midnight so
 * that it represents the intended calendar day regardless of timezone. Any
 * other value is delegated to the Date constructor.
 */
function parseLocal(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(value);
}

/**
 * Human-readable long date, e.g. "September 27, 2026".
 * Accepts a "YYYY-MM-DD" string or a Date. Returns "" for invalid input.
 */
export function formatLongDate(value) {
  if (!value) return "";
  const d = parseLocal(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Human-readable compact date, e.g. "Sep 27, 2026".
 * Accepts a "YYYY-MM-DD" string or a Date. Returns "" for invalid input.
 */
export function formatShortDate(value) {
  if (!value) return "";
  const d = parseLocal(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Compact, readable date range, e.g. "Jan 1, 2026 – Sep 27, 2026".
 * Falls back gracefully when only one bound (or neither) is provided.
 */
export function formatDateRange(fromIso, toIso) {
  const from = fromIso ? formatShortDate(fromIso) : "";
  const to = toIso ? formatShortDate(toIso) : "";
  if (from && to) return `${from} \u2013 ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return "";
}
