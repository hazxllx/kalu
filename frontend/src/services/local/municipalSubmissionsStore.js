import React, { useSyncExternalStore } from "react";

import { BARANGAYS } from "@/lib/barangays";

/**
 * MHO Municipal Submission Monitoring store.
 *
 * Contains no demo data: every submission record collection starts empty. This
 * is the in-session working set used until the backend endpoint persists to the
 * database; the shape pages expect is preserved.
 *
 * Centralizes TCL + M1 submissions from all barangays in the MHO's authorized
 * municipality (sessionStorage + useSyncExternalStore). Each record carries
 * submission info (reference, barangay, period, submitter, dates), review
 * status, review notes, and an audit trail of review actions.
 *
 * The submission type / status / review-status and barangay lists are UI
 * configuration, not records.
 */

export { BARANGAYS };

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

const STORAGE_KEY = "kalusagap.municipal-submissions.v2";

const todayIso = () => new Date().toISOString().slice(0, 10);

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
  cache = [];
  persist();
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
const getSubmissions = () =>
  read().map((s) => ({ ...s, totals: { ...(s.totals || {}) }, audit: (s.audit || []).map((a) => ({ ...a })) }));

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
