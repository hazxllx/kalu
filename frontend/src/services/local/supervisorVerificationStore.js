import React, { useSyncExternalStore } from "react";

/**
 * Health Supervisor account verification store (local work set).
 *
 * No demo data: the verification queue starts empty. Verifications recorded
 * here are the in-session working set used until the backend endpoint persists
 * to the database. The shape pages expect is preserved from the previous store.
 *
 * Admin-side workflow, kept SEPARATE from resident verification:
 *   Pending Verification → PHN Endorsed → Verified
 *                       → Rejected | Requires Correction
 * The PHN endorsement is a verification note recorded against the account.
 * Backend implementation is intentionally NOT included — see
 * docs/backend/README.md.
 */

const STORAGE_KEY = "kalusagap.supervisor-verifications.v2";
const LEGACY_STORAGE_KEYS = ["kalusagap.supervisor-verifications.v1"];

export const SUPERVISOR_STATUSES = [
  "Pending Verification",
  "PHN Endorsed",
  "Verified",
  "Rejected",
  "Requires Correction",
];

const account = (f) => ({
  id: f.id,
  name: f.name,
  email: f.email,
  contact: f.contact,
  assignedBarangay: f.assignedBarangay,
  documents: f.documents || [],
  documentStatus: f.documentStatus || "Pending",
  status: f.status || "Pending Verification",
  phnNote: f.phnNote || "",
  reason: f.reason || "",
  submittedAt: f.submittedAt,
  reviewedBy: f.reviewedBy || "",
  reviewedAt: f.reviewedAt || "",
});

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
const getAccounts = () => read().map((a) => ({ ...a }));

/** Record a PHN endorsement / verification note against an account. */
const endorse = (id, note, { by = "PHN" } = {}) => {
  cache = read().map((a) =>
    a.id === id ? { ...a, status: "PHN Endorsed", phnNote: note, reviewedBy: by, reviewedAt: new Date().toISOString() } : a
  );
  emit();
};

/**
 * Admin decision: Verified / Rejected / Requires Correction.
 * A reason is required when rejecting or requiring correction.
 */
const setStatus = (id, status, { reason = "", by = "Admin" } = {}) => {
  cache = read().map((a) =>
    a.id === id ? { ...a, status, reason: reason || a.reason, reviewedBy: by, reviewedAt: new Date().toISOString() } : a
  );
  emit();
  return read().find((a) => a.id === id) || null;
};

export const useSupervisorVerifications = () => useSyncExternalStore(subscribe, getSnapshot);

export const supervisorVerificationStore = {
  getAccounts,
  getSnapshot,
  subscribe,
  endorse,
  setStatus,
  statuses: SUPERVISOR_STATUSES,
};

export default supervisorVerificationStore;

// Purge any previously persisted entries, then persist the empty snapshot so
// the session starts with no fabricated records.
try {
  LEGACY_STORAGE_KEYS.forEach((key) => window.sessionStorage.removeItem(key));
} catch {
  /* ignore */
}
read();
persist();
