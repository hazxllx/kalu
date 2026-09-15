import React, { useSyncExternalStore } from "react";

/**
 * Shared referral tracking store (frontend demo).
 *
 * One dataset used by BOTH the RHU Referral Management page (create/update)
 * and the MHO Referral Tracking page (monitor, timeline, notes), so both roles
 * always see the same referral data. Every status change appends a history
 * entry that renders as the referral's progress timeline.
 *
 * Backend implementation is intentionally NOT included — see
 * docs/backend/README.md.
 */

const STORAGE_KEY = "kalusagap.referral-tracking.v1";

export const REFERRAL_STATUSES = ["Pending", "Accepted", "In Progress", "Completed", "Cancelled"];

const isoFromToday = (offsetDays, hours = 9) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hours, 0, 0, 0);
  return d.toISOString();
};

/** Build a referral with its initial history entry. */
const referral = (f) => ({
  id: f.id,
  reference: f.id,
  resident: f.resident,
  barangay: f.barangay,
  referringPersonnel: f.referringPersonnel,
  receivingFacility: f.receivingFacility,
  reason: f.reason,
  priority: f.priority || "Medium",
  date: f.date,
  status: f.status || "Pending",
  notes: f.notes || "",
  assignedPersonnel: f.assignedPersonnel || "",
  history: f.history || [
    { status: f.status || "Pending", by: f.referringPersonnel, at: f.date, notes: "Referral created." },
  ],
});

const SEED = [
  referral({ id: "REF-2026-0001", resident: "Maria Santos", barangay: "San Isidro", referringPersonnel: "Maria Dela Cruz", receivingFacility: "RHU Pili", reason: "Prenatal risk — elevated BP", priority: "High", date: isoFromToday(-2, 8), status: "Accepted", notes: "For immediate prenatal review.", assignedPersonnel: "Dr. Maria L. Santos", history: [
    { status: "Pending", by: "Maria Dela Cruz", at: isoFromToday(-2, 8), notes: "Referral created." },
    { status: "Accepted", by: "RHU Pili", at: isoFromToday(-1, 10), notes: "Receiving facility accepted the referral." },
  ] }),
  referral({ id: "REF-2026-0002", resident: "Andres Banaag", barangay: "San Isidro", referringPersonnel: "Maria Dela Cruz", receivingFacility: "RHU Pili", reason: "Uncontrolled diabetes — medication review", priority: "High", date: isoFromToday(-3, 14), status: "In Progress", notes: "Endocrinology consult scheduled.", assignedPersonnel: "Dr. J. Reyes", history: [
    { status: "Pending", by: "Maria Dela Cruz", at: isoFromToday(-3, 14), notes: "Referral created." },
    { status: "Accepted", by: "RHU Pili", at: isoFromToday(-2, 9), notes: "Records received." },
    { status: "In Progress", by: "Dr. J. Reyes", at: isoFromToday(-1, 13), notes: "Patient under evaluation." },
  ] }),
  referral({ id: "REF-2026-0003", resident: "Rosa Dimagiba", barangay: "San Isidro", referringPersonnel: "Maria Cruz", receivingFacility: "RHU Pili", reason: "Hypertension follow-up", priority: "Medium", date: isoFromToday(-1, 11), status: "Pending", notes: "" }),
  referral({ id: "REF-2026-0004", resident: "Carlos Mendoza", barangay: "San Antonio", referringPersonnel: "Lourdes Ramos", receivingFacility: "RHU Pili", reason: "Diabetes maintenance review", priority: "Medium", date: isoFromToday(-6, 10), status: "Completed", notes: "Medication refilled; monitoring continued.", assignedPersonnel: "PHN Ana Villanueva", history: [
    { status: "Pending", by: "Lourdes Ramos", at: isoFromToday(-6, 10), notes: "Referral created." },
    { status: "Accepted", by: "RHU Pili", at: isoFromToday(-5, 9), notes: "Accepted." },
    { status: "In Progress", by: "PHN Ana Villanueva", at: isoFromToday(-4, 15), notes: "Consultation conducted." },
    { status: "Completed", by: "PHN Ana Villanueva", at: isoFromToday(-3, 11), notes: "Care plan completed." },
  ] }),
  referral({ id: "REF-2026-0005", resident: "Liza Gonzales", barangay: "Old San Roque", referringPersonnel: "Grace Aquino", receivingFacility: "RHU Pili", reason: "TB DOTS follow-up", priority: "High", date: isoFromToday(-8, 13), status: "Cancelled", notes: "Resident relocated; referral re-issued later.", history: [
    { status: "Pending", by: "Grace Aquino", at: isoFromToday(-8, 13), notes: "Referral created." },
    { status: "Cancelled", by: "RHU Pili", at: isoFromToday(-7, 9), notes: "Resident relocated." },
  ] }),
  referral({ id: "REF-2026-0006", resident: "Juan Dela Cruz", barangay: "San Isidro", referringPersonnel: "Maria Dela Cruz", receivingFacility: "RHU Pili", reason: "Hypertension maintenance", priority: "Low", date: isoFromToday(0, 9), status: "Pending", notes: "" }),
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
  cache = SEED.map((r) => ({ ...r, history: r.history.map((h) => ({ ...h })) }));
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
const getReferrals = () => read().map((r) => ({ ...r, history: r.history.map((h) => ({ ...h })) }));

/**
 * Update a referral's status. Appends a timeline entry recording who updated
 * it, when, and an optional note.
 */
const updateStatus = (id, status, { by = "RHU", notes = "" } = {}) => {
  cache = read().map((r) =>
    r.id === id
      ? {
          ...r,
          status,
          notes: notes || r.notes,
          history: [...r.history, { status, by, at: new Date().toISOString(), notes: notes || "Status updated." }],
        }
      : r
  );
  emit();
  return read().find((r) => r.id === id) || null;
};

/** Add a tracking note without changing the status. */
const addNote = (id, notes, { by = "RHU" } = {}) => {
  cache = read().map((r) =>
    r.id === id
      ? {
          ...r,
          notes,
          history: [...r.history, { status: r.status, by, at: new Date().toISOString(), notes }],
        }
      : r
  );
  emit();
};

export const useReferralTracking = () => useSyncExternalStore(subscribe, getSnapshot);

export const referralTrackingStore = {
  getReferrals,
  getSnapshot,
  subscribe,
  updateStatus,
  addNote,
  statuses: REFERRAL_STATUSES,
};

export default referralTrackingStore;
