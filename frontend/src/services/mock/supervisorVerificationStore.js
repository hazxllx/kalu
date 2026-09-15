import React, { useSyncExternalStore } from "react";

/**
 * Health Supervisor account verification store (frontend demo).
 *
 * Admin-side workflow, kept SEPARATE from resident verification:
 *   Pending Verification → PHN Endorsed → Verified
 *                       → Rejected | Requires Correction
 * The PHN endorsement is a verification note recorded against the account.
 * Backend implementation is intentionally NOT included — see
 * docs/backend/README.md.
 */

const STORAGE_KEY = "kalusagap.supervisor-verifications.v1";

export const SUPERVISOR_STATUSES = [
  "Pending Verification",
  "PHN Endorsed",
  "Verified",
  "Rejected",
  "Requires Correction",
];

const isoFromToday = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
};

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

const SEED = [
  account({ id: "SV-2026-001", name: "Lourdes Ramos", email: "lourdes.ramos@example.gov.ph", contact: "0917 555 0201", assignedBarangay: "San Antonio", documents: ["PRC License", "Barangay Endorsement"], documentStatus: "Complete", status: "Pending Verification", submittedAt: isoFromToday(-2) }),
  account({ id: "SV-2026-002", name: "Grace Aquino", email: "grace.aquino@example.gov.ph", contact: "0917 555 0202", assignedBarangay: "San Isidro", documents: ["PRC License"], documentStatus: "Incomplete", status: "Pending Verification", submittedAt: isoFromToday(-4) }),
  account({ id: "SV-2026-003", name: "Marites Ramos", email: "marites.ramos@example.gov.ph", contact: "0917 555 0203", assignedBarangay: "San Isidro", documents: ["PRC License", "Barangay Endorsement", "Training Certificate"], documentStatus: "Complete", status: "PHN Endorsed", phnNote: "Endorsed by PHN Ana Villanueva — documents verified on-site.", submittedAt: isoFromToday(-6), reviewedAt: isoFromToday(-1) }),
  account({ id: "SV-2026-004", name: "Celia Domingo", email: "celia.domingo@example.gov.ph", contact: "0917 555 0204", assignedBarangay: "Old San Roque", documents: ["PRC License", "Barangay Endorsement"], documentStatus: "Complete", status: "Verified", reason: "", submittedAt: isoFromToday(-12), reviewedBy: "Jose Ramirez", reviewedAt: isoFromToday(-9) }),
];

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
  cache = SEED.map((a) => ({ ...a }));
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
