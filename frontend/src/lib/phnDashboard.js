import { CHECKUP_STATUS } from "./phnWorkflowMap.js";

/**
 * Pure selectors + mappers for the Public Health Nurse dashboard.
 *
 * The dashboard previously rendered its referral / follow-up / health-service
 * figures from empty browser-only stores (`@/services/local/*`) and compared a
 * backend ISO timestamp against a long-form local date, so most metrics were a
 * permanent zero. These helpers derive the four priority indicators and the
 * work-queue sections from the REAL API rows, using the same status vocabulary
 * and the same Philippine calendar day the backend uses for follow-up dues.
 *
 * Kept dependency-free (aside from the UI pipeline statuses) so it can be unit
 * tested directly under `node --test`.
 */

/** Backend + follow-up calendar use the Philippine calendar day. */
export const PHN_TZ = "Asia/Manila";

const pad2 = (n) => String(n).padStart(2, "0");
const lc = (value) => String(value ?? "").trim().toLowerCase();

/** Current application calendar day (YYYY-MM-DD) in Philippine time. */
export const manilaDateKey = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-PH", {
    timeZone: PHN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

/** Long, weekday-prefixed date label, e.g. "Tuesday, October 6, 2026". */
export const formatManilaLongDate = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PHN_TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
};

/** True when an ISO timestamp falls on the given Philippine calendar day. */
export const isManilaToday = (value, today = manilaDateKey()) =>
  Boolean(value) && manilaDateKey(value) === today;

/* ------------------------------- Follow-ups ------------------------------ */

// A follow-up in one of these states is final and no longer needs attention.
export const CLOSED_FOLLOWUP_STATUSES = Object.freeze([
  "completed",
  "cancelled",
  "rejected",
  "missed",
]);

const CLOSED_FOLLOWUP = new Set(CLOSED_FOLLOWUP_STATUSES);

/** A follow-up still awaiting action (not Completed/Cancelled/Rejected/Missed). */
export const isOpenFollowUp = (row) => !CLOSED_FOLLOWUP.has(lc(row?.status));

const followUpDate = (row) =>
  String(row?.scheduled_date || row?.scheduledDate || row?.dueDate || "").slice(0, 10);

const isDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Overdue: scheduled before today and still open (or explicitly flagged). */
export const followUpIsOverdue = (row, today = manilaDateKey()) => {
  if (!row || !isOpenFollowUp(row)) return false;
  if (row.is_overdue === true) return true;
  const date = followUpDate(row);
  return isDateOnly(date) && Boolean(today) && date < today;
};

/** Due today: scheduled for the current Philippine calendar day and open. */
export const followUpIsDueToday = (row, today = manilaDateKey()) => {
  if (!row || !isOpenFollowUp(row)) return false;
  if (row.is_due_today === true) return true;
  const date = followUpDate(row);
  return isDateOnly(date) && Boolean(today) && date === today;
};

/** A follow-up needs attention when it is overdue or due today. */
export const followUpNeedsAttention = (row, today = manilaDateKey()) =>
  followUpIsOverdue(row, today) || followUpIsDueToday(row, today);

/** Status a follow-up row should display (Overdue/Today are derived). */
export const followUpDisplayStatus = (row, today = manilaDateKey()) => {
  if (!isOpenFollowUp(row)) return row?.status || "Closed";
  if (followUpIsOverdue(row, today)) return "Overdue";
  if (followUpIsDueToday(row, today)) return "Today";
  return row?.status || "Scheduled";
};

/** Sort key so overdue items come first, then due today, then the rest. */
export const followUpAttentionRank = (row, today = manilaDateKey()) => {
  if (followUpIsOverdue(row, today)) return 0;
  if (followUpIsDueToday(row, today)) return 1;
  return 2;
};

/* ------------------------------- Referrals ------------------------------- */

// Referrals that still require PHN processing. Completed/Cancelled are final.
export const OPEN_REFERRAL_STATUSES = Object.freeze(["pending", "accepted", "in progress"]);

export const isPendingReferral = (row) => OPEN_REFERRAL_STATUSES.includes(lc(row?.status));

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export const referralPriorityRank = (row) =>
  PRIORITY_RANK[lc(row?.priority)] ?? PRIORITY_RANK.medium;

/* --------------------------------- People -------------------------------- */

/** Full name from either a snake_case resident embed or a camelCase record. */
export const personName = (person = {}) =>
  [
    person.first_name ?? person.firstName,
    person.middle_name ?? person.middleName,
    person.last_name ?? person.lastName,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim() || person.name || "Unnamed patient";

/** The authoritative risk level for a resident row (backend-attached). */
export const residentRiskLevel = (row) => row?.riskLevel ?? row?.risk_level ?? null;

export const isHighRiskResident = (row) => lc(residentRiskLevel(row)) === "high";

/* --------------------------------- Mappers ------------------------------- */

export const mapFollowUpRow = (row = {}) => ({
  id: row.id,
  residentName: row.resident ? personName(row.resident) : row.residentName || "Resident",
  barangay: row.resident?.barangay || row.barangay || "",
  purpose: row.purpose || row.reason || "Follow-up",
  scheduledDate: followUpDate(row),
  scheduledTime: row.scheduled_time
    ? String(row.scheduled_time).slice(0, 5)
    : row.scheduledTime || "",
  status: followUpDisplayStatus(row),
  priority: row.priority || "",
  isOverdue: followUpIsOverdue(row),
  isDueToday: followUpIsDueToday(row),
});

export const mapReferralRow = (row = {}) => ({
  id: row.id,
  residentName: row.resident ? personName(row.resident) : row.residentName || "Resident",
  barangay: row.resident?.barangay || row.barangay || "",
  reason: row.reason || "",
  destinationFacility: row.destination_facility || row.destinationFacility || "",
  priority: row.priority || "Medium",
  status: row.status || "Pending",
  referralDate: String(row.referral_date || row.referralDate || "").slice(0, 10),
});

export const mapHighRiskResident = (row = {}) => ({
  id: row.id,
  name: personName(row),
  barangay: row.barangay || "",
  riskLevel: residentRiskLevel(row) || "High",
  riskScore: row.riskScore ?? row.risk_score ?? null,
});

/* --------------------------------- Counts -------------------------------- */

/**
 * Check-up pipeline counts from the persistent PHN queue. `completedToday`
 * compares the completion timestamp on the Philippine calendar day (the old
 * dashboard compared an ISO timestamp to a "Month D, YYYY" label, so it never
 * matched).
 */
export const queueCounts = (patients = [], today = manilaDateKey()) => {
  const counts = { waiting: 0, inCheckup: 0, completedToday: 0 };
  for (const patient of patients) {
    if (patient?.status === CHECKUP_STATUS.WAITING) counts.waiting += 1;
    else if (patient?.status === CHECKUP_STATUS.IN_CHECKUP) counts.inCheckup += 1;
    else if (patient?.status === CHECKUP_STATUS.COMPLETED) {
      if (isManilaToday(patient?.checkup?.completedAt, today)) counts.completedToday += 1;
    }
  }
  return counts;
};

/** Count rows the pure predicates accept; a non-array input counts as none. */
export const countBy = (rows, predicate) =>
  (Array.isArray(rows) ? rows : []).reduce((n, row) => n + (predicate(row) ? 1 : 0), 0);

export const countFollowUpsDue = (rows, today = manilaDateKey()) =>
  countBy(rows, (row) => followUpNeedsAttention(row, today));

export const countPendingReferrals = (rows) => countBy(rows, isPendingReferral);

export const countHighRisk = (rows) => countBy(rows, isHighRiskResident);

/* ------------------------------- Presentation ---------------------------- */

const RISK_LABEL = { high: 0, medium: 1, moderate: 1, low: 2 };
const patientRiskLevel = (patient = {}) =>
  lc(patient?.checkup?.riskLevel || patient?.riskLevel || "");

export const patientRiskRank = (patient) =>
  RISK_LABEL[patientRiskLevel(patient)] ?? RISK_LABEL.low;

/** Order the waiting queue so higher risk is seen first (stable otherwise). */
export const sortQueueByRisk = (patients = []) =>
  patients
    .map((patient, index) => ({ patient, index }))
    .sort((a, b) => {
      const diff = patientRiskRank(a.patient) - patientRiskRank(b.patient);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ patient }) => patient);

export default {
  manilaDateKey,
  formatManilaLongDate,
  isManilaToday,
  isOpenFollowUp,
  followUpIsOverdue,
  followUpIsDueToday,
  followUpNeedsAttention,
  followUpDisplayStatus,
  isPendingReferral,
  isHighRiskResident,
  personName,
  queueCounts,
  countFollowUpsDue,
  countPendingReferrals,
  countHighRisk,
  mapFollowUpRow,
  mapReferralRow,
  mapHighRiskResident,
  sortQueueByRisk,
};
