import React, { useSyncExternalStore } from "react";

/**
 * Shared referral tracking store.
 *
 * Contains no demo data: every tracking record collection starts empty. This is
 * the in-session working set used until the backend endpoint persists to the
 * database; the shape pages expect is preserved.
 *
 * One dataset used by BOTH the RHU Referral Management page (create/update)
 * and the MHO Referral Tracking page (monitor, timeline, notes), so both roles
 * always see the same referral data. Every status change appends a history
 * entry that renders as the referral's progress timeline.
 *
 * Backend implementation is intentionally NOT included — see
 * docs/backend/README.md.
 */

const STORAGE_KEY = "kalusagap.referral-tracking.v2";

export const REFERRAL_STATUSES = ["Pending", "Accepted", "In Progress", "Completed", "Cancelled"];

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
const getReferrals = () => read().map((r) => ({ ...r, history: (r.history || []).map((h) => ({ ...h })) }));

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
          history: [...(r.history || []), { status, by, at: new Date().toISOString(), notes: notes || "Status updated." }],
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
          history: [...(r.history || []), { status: r.status, by, at: new Date().toISOString(), notes }],
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
