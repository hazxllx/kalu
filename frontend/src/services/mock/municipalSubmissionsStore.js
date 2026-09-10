import React, { useSyncExternalStore } from "react";

/**
 * MHO Municipal Submission Monitoring store (frontend demo).
 *
 * Centralizes TCL + M1 submissions from all barangays in the MHO's authorized
 * municipality. Mirrors the existing mock-store architecture (sessionStorage +
 * useSyncExternalStore). Each record carries submission info (reference,
 * barangay, period, submitter, dates), review status, review notes, and an
 * audit trail of review actions.
 */

export const SUBMISSION_TYPES = { TCL: "TCL", M1: "M1" };

export const SUBMISSION_STATUSES = [
  "Submitted",
  "Pending Review",
  "Under Review",
  "Reviewed",
  "Returned",
  "Needs Correction",
];

export const REVIEW_STATUSES = [
  "Pending Review",
  "Reviewed",
  "Returned",
  "Needs Correction",
];

export const BARANGAYS = ["San Isidro", "San Antonio", "Old San Roque"];

const STORAGE_KEY = "kalusagap.municipal-submissions.v1";

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Build a submission row with a default audit trail entry. */
const row = (f) => {
  const r = {
    id: f.id,
    type: f.type,
    reference: f.reference,
    barangay: f.barangay,
    period: f.period,
    submittedBy: f.submittedBy,
    submittedAt: f.submittedAt,
    status: f.status || "Pending Review",
    reviewStatus: f.reviewStatus || "Pending Review",
    reviewedBy: "",
    reviewedAt: "",
    reviewNotes: "",
    lastUpdated: f.lastUpdated || todayIso(),
    totals: f.totals || {},
    entries: f.entries || 0,
    audit: [
      { action: "Submitted", by: f.submittedBy, at: f.submittedAt, notes: "Submission received from the barangay." },
    ],
  };
  return r;
};

const SEED = [
  row({
    id: "TCL-2026-001", type: SUBMISSION_TYPES.TCL, reference: "TCL-2026-001", barangay: "San Isidro",
    period: "September 2026", submittedBy: "Maria Cruz", submittedAt: "2026-09-10T09:15:00.000Z", status: "Pending Review", reviewStatus: "Pending Review",
    totals: { targetClients: 24, active: 18, monitoring: 5, inactive: 1 }, entries: 24,
  }),
  row({
    id: "TCL-2026-002", type: SUBMISSION_TYPES.TCL, reference: "TCL-2026-002", barangay: "San Antonio",
    period: "September 2026", submittedBy: "Lourdes Ramos", submittedAt: "2026-09-09T14:30:00.000Z", status: "Under Review", reviewStatus: "Pending Review",
    totals: { targetClients: 19, active: 15, monitoring: 3, inactive: 1 }, entries: 19,
  }),
  row({
    id: "TCL-2026-003", type: SUBMISSION_TYPES.TCL, reference: "TCL-2026-003", barangay: "San Antonio",
    period: "August 2026", submittedBy: "Lourdes Ramos", submittedAt: "2026-08-12T10:00:00.000Z", status: "Reviewed", reviewStatus: "Reviewed",
    reviewedBy: "Dr. Carmen Bautista", reviewedAt: "2026-08-15T08:00:00.000Z", reviewNotes: "Accepted. Figures match the master list.",
    totals: { targetClients: 18, active: 14, monitoring: 3, inactive: 1 }, entries: 18,
  }),
  row({
    id: "TCL-2026-004", type: SUBMISSION_TYPES.TCL, reference: "TCL-2026-004", barangay: "Old San Roque",
    period: "September 2026", submittedBy: "Grace Aquino", submittedAt: "2026-09-08T16:20:00.000Z", status: "Needs Correction", reviewStatus: "Needs Correction",
    reviewedBy: "Dr. Carmen Bautista", reviewedAt: "2026-09-11T09:00:00.000Z", reviewNotes: "Please verify the reported total for the September reporting period.",
    totals: { targetClients: 21, active: 16, monitoring: 4, inactive: 1 }, entries: 21,
  }),
  row({
    id: "M1-2026-001", type: SUBMISSION_TYPES.M1, reference: "M1-2026-001", barangay: "San Isidro",
    period: "September 2026", submittedBy: "Maria Santos", submittedAt: "2026-09-10T08:45:00.000Z", status: "Pending Review", reviewStatus: "Pending Review",
    totals: { prenatalClients: 12, newClients: 3, returning: 9, highRisk: 2 }, entries: 12,
  }),
  row({
    id: "M1-2026-002", type: SUBMISSION_TYPES.M1, reference: "M1-2026-002", barangay: "San Antonio",
    period: "September 2026", submittedBy: "Rosa Bautista", submittedAt: "2026-09-08T13:10:00.000Z", status: "Pending Review", reviewStatus: "Pending Review",
    totals: { prenatalClients: 9, newClients: 2, returning: 7, highRisk: 1 }, entries: 9,
  }),
  row({
    id: "M1-2026-003", type: SUBMISSION_TYPES.M1, reference: "M1-2026-003", barangay: "Old San Roque",
    period: "September 2026", submittedBy: "Ana Villanueva", submittedAt: "2026-09-07T15:40:00.000Z", status: "Returned", reviewStatus: "Returned",
    reviewedBy: "Dr. Carmen Bautista", reviewedAt: "2026-09-10T11:00:00.000Z", reviewNotes: "One prenatal client record is incomplete (missing EDD).",
    totals: { prenatalClients: 8, newClients: 1, returning: 7, highRisk: 2 }, entries: 8,
  }),
  row({
    id: "M1-2026-004", type: SUBMISSION_TYPES.M1, reference: "M1-2026-004", barangay: "San Isidro",
    period: "August 2026", submittedBy: "Maria Santos", submittedAt: "2026-08-10T09:00:00.000Z", status: "Reviewed", reviewStatus: "Reviewed",
    reviewedBy: "Dr. Carmen Bautista", reviewedAt: "2026-08-13T10:30:00.000Z", reviewNotes: "Accepted.",
    totals: { prenatalClients: 11, newClients: 4, returning: 7, highRisk: 1 }, entries: 11,
  }),
];

const cloneSeed = () => SEED.map((s) => ({ ...s, totals: { ...s.totals }, audit: s.audit.map((a) => ({ ...a })) }));

let cache = null;
const read = () => {
  if (cache) return cache;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cache = parsed;
        return cache;
      }
    }
  } catch {
    /* ignore */
  }
  cache = cloneSeed();
  return cache;
};
const persist = () => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache || []));
  } catch {
    /* ignore */
  }
};
const listeners = new Set();
const emit = () => {
  persist();
  listeners.forEach((cb) => cb());
};
const subscribe = (cb) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getSnapshot = () => read();
const getSubmissions = () => read().map((s) => ({ ...s, totals: { ...s.totals }, audit: s.audit.map((a) => ({ ...a })) }));

const updateRecord = (id, patch) => {
  cache = read().map((s) => (s.id === id ? { ...s, ...patch } : s));
  emit();
};

/**
 * Review action: Approved/Reviewed, Returned, or Needs Correction.
 * Records reviewer, date/time, notes, and appends an audit-trail entry.
 */
const reviewSubmission = (id, { decision, notes, reviewer }) => {
  const rec = read().find((s) => s.id === id);
  if (!rec) return null;

  let status = rec.status;
  let reviewStatus = rec.reviewStatus;
  if (decision === "reviewed") {
    status = "Reviewed";
    reviewStatus = "Reviewed";
  } else if (decision === "returned") {
    status = "Returned";
    reviewStatus = "Returned";
  } else if (decision === "needs-correction") {
    status = "Needs Correction";
    reviewStatus = "Needs Correction";
  } else if (decision === "under-review") {
    status = "Under Review";
    reviewStatus = "Pending Review";
  }

  const auditEntry = {
    action: decision === "reviewed" ? "Reviewed" : decision === "returned" ? "Returned" : decision === "needs-correction" ? "Correction Requested" : "Under Review",
    by: reviewer || "MHO",
    at: new Date().toISOString(),
    notes: notes || "",
  };

  updateRecord(id, {
    status,
    reviewStatus,
    reviewedBy: reviewer || rec.reviewedBy,
    reviewedAt: new Date().toISOString(),
    reviewNotes: notes !== undefined ? notes : rec.reviewNotes,
    lastUpdated: todayIso(),
    audit: [...(rec.audit || []), auditEntry],
  });
  return getSubmissions().find((s) => s.id === id);
};

export const useMunicipalSubmissions = () => useSyncExternalStore(subscribe, getSnapshot);

export const municipalSubmissionsStore = {
  getSubmissions,
  getSnapshot,
  subscribe,
  reviewSubmission,
  types: SUBMISSION_TYPES,
  statuses: SUBMISSION_STATUSES,
  reviewStatuses: REVIEW_STATUSES,
  barangays: BARANGAYS,
};

export default municipalSubmissionsStore;
