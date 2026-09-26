/**
 * M1 / Maternal analytics — pure, deterministic helpers.
 *
 * These functions summarize the barangay-scoped `maternal_records` rows that the
 * page already loads from Supabase (via `maternalApi.list()`), so the queries
 * stay in the service layer and the components only render. No values are
 * fabricated: every number is derived from the supplied records.
 *
 * Participation is keyed on the record's first-recorded date (`recordedAt`,
 * i.e. maternal_records.created_at) because the schema has no per-visit table.
 * `prenatalVisits` is the recorded visit count on the record.
 */

export const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Standard prenatal visit target used to flag incomplete monitoring. */
const PRENATAL_TARGET = 8;

const dateOf = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** True when `recordedAt` falls in the given year (and month, when provided). */
const inPeriod = (record, year, month /* 0-11 or null */) => {
  const d = dateOf(record.recordedAt);
  if (!d) return false;
  if (d.getFullYear() !== year) return false;
  if (month != null && d.getMonth() !== month) return false;
  return true;
};

/**
 * Filter records to the selected reporting period.
 *   period = 'monthly' → year + month
 *   period = 'annual'  → year
 */
export const filterByPeriod = (records, { period, year, month }) => {
  if (!Array.isArray(records)) return [];
  const m = period === "monthly" ? month : null;
  return records.filter((r) => inPeriod(r, year, m));
};

/** Distinct calendar years present in the records, newest first (always incl. current year). */
export const availableYears = (records) => {
  const years = new Set([new Date().getFullYear()]);
  (records || []).forEach((r) => {
    const d = dateOf(r.recordedAt);
    if (d) years.add(d.getFullYear());
  });
  return [...years].sort((a, b) => b - a);
};

const lower = (v) => String(v ?? "").trim().toLowerCase();

/**
 * Summary metrics for a set of period-scoped records. Only metrics supported by
 * `maternal_records` are produced.
 */
export const summarize = (periodRecords) => {
  const rows = Array.isArray(periodRecords) ? periodRecords : [];
  const total = rows.length;
  const active = rows.filter((r) => lower(r.status) === "active").length;
  const completed = rows.filter((r) => ["delivered", "transferred"].includes(lower(r.status))).length;
  const prenatalVisits = rows.reduce((sum, r) => sum + (Number(r.prenatalVisits) || 0), 0);
  // "Follow-ups due": still-active cases whose prenatal schedule is incomplete.
  const followUpsDue = rows.filter(
    (r) => lower(r.status) === "active" && (Number(r.prenatalVisits) || 0) < PRENATAL_TARGET,
  ).length;
  return { total, active, completed, prenatalVisits, followUpsDue };
};

/**
 * 12-month participation breakdown for a year: number of records first recorded
 * in each month. Used for the "M1 participation by month" chart and the annual
 * monthly table.
 */
export const monthlyBreakdown = (records, year) => {
  const counts = new Array(12).fill(0);
  (records || []).forEach((r) => {
    const d = dateOf(r.recordedAt);
    if (d && d.getFullYear() === year) counts[d.getMonth()] += 1;
  });
  return counts.map((count, i) => ({ month: MONTH_SHORT[i], label: MONTH_LABELS[i], count }));
};

/** A short, human follow-up status for a participant row. */
export const followUpStatus = (record) => {
  const status = lower(record.status);
  if (status === "delivered") return "Completed";
  if (status === "transferred") return "Transferred";
  if (status === "inactive") return "Inactive";
  const visits = Number(record.prenatalVisits) || 0;
  return visits < PRENATAL_TARGET ? "Follow-up due" : "On track";
};

export default { filterByPeriod, availableYears, summarize, monthlyBreakdown, followUpStatus, MONTH_LABELS, MONTH_SHORT };
