import React, { useSyncExternalStore } from "react";

/**
 * Target Client List (TCL) session store.
 *
 * Contains no demo data: every TCL record collection starts empty (and no
 * fabricated active-BHW list is derived from demo users). This is the
 * in-session working set used until the backend endpoint persists to the
 * database; the shape pages expect is preserved. Each TCL record keeps a
 * snapshot of the resident it belongs to (residentId is the source of truth)
 * so the list stays connected to the resident data model.
 *
 * A resident can only be enrolled once per program; the same resident may
 * appear in different programs.
 */

export const TCL_PROGRAMS = [
  "Pregnant Women",
  "Senior Citizens",
  "Diabetes",
  "Family Planning",
  "TB Patients",
];

export const TCL_STATUSES = ["Active", "Monitoring", "Inactive"];

export const TCL_PRIORITIES = ["High", "Medium", "Low"];

/** Active BHW accounts that can be assigned as a target-client handler. */
export const ACTIVE_BHWS = [];

const STORAGE_KEY = "kalusagap.tcls.session.v2";

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
    /* fall through to empty working set */
  }
  cache = [];
  persist();
  return cache;
};

const persist = () => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache || []));
  } catch {
    /* storage may be unavailable */
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
const getTcls = () => read().map((t) => ({ ...t, resident: { ...(t.resident || {}) } }));

const hasEnrollment = (residentId, program) =>
  read().some((t) => t.residentId === residentId && t.program === program);

/**
 * Add a target client. Returns { ok, error?, record? }.
 * The resident is an EXISTING resident record — only a TCL enrollment row is
 * created (linked by residentId). Prevents duplicate enrollment of the same
 * resident in the same program; the resident may still be enrolled in other
 * applicable programs.
 */
const addTcl = (payload) => {
  const resident = payload.resident;
  if (!resident || !resident.id) return { ok: false, error: "Please select a resident." };
  if (!payload.program) return { ok: false, error: "Please select a program." };
  if (hasEnrollment(resident.id, payload.program)) {
    return {
      ok: false,
      error: "This resident is already enrolled in this program.",
    };
  }
  const list = read();
  const record = {
    id: `TCL-${resident.id}-${Date.now().toString(36)}`,
    residentId: resident.id,
    resident: { ...resident },
    program: payload.program,
    bhw: payload.bhw || "",
    status: payload.status || "Active",
    priority: payload.priority || "Medium",
    lastVisit: payload.lastVisit || "",
    nextVisit: payload.nextVisit || "",
    nextVisitTime: payload.nextVisitTime || "",
    notes: String(payload.notes || "").trim(),
    createdAt: new Date().toISOString(),
  };
  cache = [record, ...list];
  emit();
  return { ok: true, record };
};

/** Schedule (or reschedule) the next visit and optionally record the last visit. */
const scheduleVisit = (id, { nextVisit, nextVisitTime, lastVisit, notes }) => {
  const list = read();
  cache = list.map((t) =>
    t.id === id
      ? {
          ...t,
          nextVisit: nextVisit || t.nextVisit,
          nextVisitTime: nextVisitTime || "",
          lastVisit: lastVisit || t.lastVisit,
          notes: notes !== undefined ? notes : t.notes,
          scheduledAt: new Date().toISOString(),
        }
      : t
  );
  emit();
};

/** Change a TCL's status (Active / Monitoring / Inactive). */
const updateStatus = (id, status) => {
  const list = read();
  cache = list.map((t) => (t.id === id ? { ...t, status } : t));
  emit();
};

const getById = (id) => {
  const found = read().find((t) => t.id === id);
  return found ? { ...found, resident: { ...(found.resident || {}) } } : null;
};

export const useTcls = () => useSyncExternalStore(subscribe, getSnapshot);

export const tclStore = {
  getTcls,
  getSnapshot,
  subscribe,
  addTcl,
  scheduleVisit,
  updateStatus,
  getById,
  hasEnrollment,
  programs: TCL_PROGRAMS,
};

export default tclStore;
