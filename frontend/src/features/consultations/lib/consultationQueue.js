/**
 * Pure, UI-free helpers for the RHU Consultation queue.
 *
 * Extracted from RhuConsultation.jsx so the "active vs already-handled"
 * partitioning and the search/status filtering can be unit-tested with
 * `node --test` without a browser or a React renderer. They contain no React,
 * no network and no DOM access.
 *
 * IMPORTANT workflow rule (mirrors the backend status model): completing triage
 * moves a referral to the consultation queue as WAITING — it does NOT mark the
 * consultation complete. A patient only leaves the ACTIVE consultation queue
 * once the consultation itself reaches a terminal status. These helpers decide
 * queue membership from the PERSISTED status only; they never delete a record
 * or mutate a status to make the UI look clean.
 *
 * The default active-status set mirrors CHECKUP_STATUS.WAITING / IN_CHECKUP from
 * `@/lib/phnWorkflowMap`. The page passes the enum values in explicitly so there
 * is a single source of truth at the call site; the literal default here only
 * exists so the helpers remain importable by the alias-free node test runner.
 */

/** Pipeline statuses that keep a patient in the ACTIVE consultation queue. */
export const ACTIVE_CONSULT_STATUSES = Object.freeze(["Waiting for PHN", "In Check-up"]);

/**
 * Whether a patient is still awaiting / undergoing consultation (i.e. belongs in
 * the active queue) for a given active-status set.
 *
 * @param {{status?: string}} patient
 * @param {ReadonlyArray<string>} [activeStatuses]
 * @returns {boolean}
 */
export function isActiveConsult(patient, activeStatuses = ACTIVE_CONSULT_STATUSES) {
  return activeStatuses.includes(patient?.status);
}

/**
 * Split the queue into the ACTIVE encounters (awaiting / in consultation) and
 * the already-HANDLED ones (terminal status, e.g. completed). Input is never
 * mutated and the relative order within each group is preserved.
 *
 * @param {Array<{status?: string}>} patients
 * @param {ReadonlyArray<string>} [activeStatuses]
 * @returns {{active: Array<object>, handled: Array<object>}}
 */
export function partitionConsultationQueue(patients, activeStatuses = ACTIVE_CONSULT_STATUSES) {
  const list = Array.isArray(patients) ? patients : [];
  const active = [];
  const handled = [];
  for (const p of list) {
    if (isActiveConsult(p, activeStatuses)) active.push(p);
    else handled.push(p);
  }
  return { active, handled };
}

/**
 * Filter a patient list by a free-text patient-name search and an exact status
 * ("All" disables the status filter). Tolerant of malformed input.
 *
 * @param {Array<{patient?: string, status?: string}>} patients
 * @param {{search?: string, status?: string}} [opts]
 * @returns {Array<object>}
 */
export function filterConsultationPatients(patients, { search = "", status = "All" } = {}) {
  const list = Array.isArray(patients) ? patients : [];
  const q = String(search || "").trim().toLowerCase();
  return list.filter((p) => {
    const matchesSearch = q === "" || String(p?.patient || "").toLowerCase().includes(q);
    const matchesStatus = status === "All" || p?.status === status;
    return matchesSearch && matchesStatus;
  });
}

/**
 * Case-insensitive match of a check-up row against a free-text query that may
 * be a patient name, a patient/visit ID, or the recorded reason for visit.
 * An empty query matches everything. Tolerant of malformed input.
 *
 * @param {{patient?: string, id?: string, residentId?: string, reason?: string, triage?: {chiefComplaint?: string}}} patient
 * @param {string} [query]
 * @returns {boolean}
 */
export function matchesCheckupSearch(patient, query) {
  const q = String(query || "").trim().toLowerCase();
  if (q === "") return true;
  const fields = [
    patient?.patient,
    patient?.id,
    patient?.residentId,
    patient?.reason,
    patient?.triage?.chiefComplaint,
  ];
  return fields.some((f) => String(f ?? "").toLowerCase().includes(q));
}

/**
 * True when the row's scheduled visit date falls on the same calendar day as
 * `now` (defaults to the current date). Reads `visitDate` first, then the
 * triage date. Tolerant of missing or unparseable dates (returns false).
 *
 * @param {{visitDate?: string, triage?: {date?: string}}} patient
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isScheduledToday(patient, now = new Date()) {
  const raw = patient?.visitDate || patient?.triage?.date || "";
  if (!raw) return false;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default {
  ACTIVE_CONSULT_STATUSES,
  isActiveConsult,
  partitionConsultationQueue,
  filterConsultationPatients,
  matchesCheckupSearch,
  isScheduledToday,
};
