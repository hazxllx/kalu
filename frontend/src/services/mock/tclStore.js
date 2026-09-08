import React, { useSyncExternalStore } from "react";

import { residents as SEED_RESIDENTS } from "@/services/mock/mockData";
import { systemUsers } from "@/services/mock/mockData";

/**
 * Target Client List (TCL) session store (frontend demo).
 *
 * Mirrors the existing mock-store architecture (residentStore / consultationStore):
 * seeded with sample TCL records and remembers additions, schedules and status
 * changes during the current browser session (kept in `sessionStorage`). Each
 * TCL record keeps a snapshot of the resident it belongs to (residentId is the
 * source of truth) so the list stays connected to the resident data model.
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
export const ACTIVE_BHWS = systemUsers
  .filter((u) => u.role === "BHW" && u.status === "Active")
  .map((u) => u.name);

const residentByName = (name) =>
  SEED_RESIDENTS.find(
    (r) => r.name.toLowerCase() === String(name || "").trim().toLowerCase()
  ) || null;

/** Seed records keyed off the canonical resident list (name + program). */
const SEED = [
  { residentName: "Maria Santos", program: "Pregnant Women", bhw: "Maria Cruz", status: "Active", priority: "High", lastVisit: "2026-08-20", nextVisit: "2026-09-03", nextVisitTime: "", notes: "Prenatal check every 2 weeks." },
  { residentName: "Elena Garcia", program: "Pregnant Women", bhw: "Maria Cruz", status: "Active", priority: "Low", lastVisit: "2026-08-18", nextVisit: "2026-09-01", nextVisitTime: "09:00", notes: "" },
  { residentName: "Conchita Ramos", program: "Senior Citizens", bhw: "Lourdes Ramos", status: "Active", priority: "Medium", lastVisit: "2026-08-12", nextVisit: "2026-09-09", nextVisitTime: "08:30", notes: "BP and maintenance meds review." },
  { residentName: "Andres Banaag", program: "Diabetes", bhw: "Maria Cruz", status: "Monitoring", priority: "High", lastVisit: "2026-08-15", nextVisit: "2026-08-29", nextVisitTime: "", notes: "FBS trending up; monitor closely." },
  { residentName: "Rosa Dimagiba", program: "Diabetes", bhw: "Lourdes Ramos", status: "Active", priority: "Medium", lastVisit: "2026-08-10", nextVisit: "2026-09-07", nextVisitTime: "10:00", notes: "" },
  { residentName: "Kris Marquez", program: "Family Planning", bhw: "Lourdes Ramos", status: "Active", priority: "Low", lastVisit: "2026-08-06", nextVisit: "2026-09-06", nextVisitTime: "13:00", notes: "" },
  { residentName: "Marites Ramos", program: "TB Patients", bhw: "Maria Cruz", status: "Active", priority: "High", lastVisit: "2026-08-11", nextVisit: "2026-08-25", nextVisitTime: "", notes: "DOTS continuation." },
  // Keep the original sample rows available to other scopes (non-San Isidro
  // residents); the page only shows records for the Health Supervisor's own
  // assigned barangay.
  { residentName: "Ana Villanueva", program: "Pregnant Women", bhw: "Maria Cruz", status: "Active", priority: "High", lastVisit: "2026-06-28", nextVisit: "2026-07-12", nextVisitTime: "", notes: "" },
  { residentName: "Carlos Mendoza", program: "Diabetes", bhw: "Maria Cruz", status: "Active", priority: "High", lastVisit: "2026-06-15", nextVisit: "2026-07-15", nextVisitTime: "", notes: "" },
  { residentName: "Miguel Torres", program: "Family Planning", bhw: "Lourdes Ramos", status: "Active", priority: "Low", lastVisit: "2026-06-10", nextVisit: "2026-08-10", nextVisitTime: "", notes: "" },
  { residentName: "Liza Gonzales", program: "TB Patients", bhw: "Maria Cruz", status: "Monitoring", priority: "High", lastVisit: "2026-06-05", nextVisit: "2026-07-05", nextVisitTime: "", notes: "" },
];

const STORAGE_KEY = "kalusagap.tcls.session.v1";

const buildSeed = () =>
  SEED.map((s) => {
    const resident = residentByName(s.residentName) || {
      id: `RES-${s.residentName.split(" ")[0]}`,
      name: s.residentName,
      barangay: "",
    };
    return {
      id: `TCL-${resident.id || resident.name}`,
      residentId: resident.id,
      resident: { ...resident },
      program: s.program,
      bhw: s.bhw,
      status: s.status,
      priority: s.priority,
      lastVisit: s.lastVisit || "",
      nextVisit: s.nextVisit || "",
      nextVisitTime: s.nextVisitTime || "",
      notes: s.notes || "",
      createdAt: "2026-08-01T08:00:00.000Z",
    };
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
    /* fall through to seed */
  }
  cache = buildSeed();
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
const getTcls = () => read().map((t) => ({ ...t, resident: { ...t.resident } }));

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
  return found ? { ...found, resident: { ...found.resident } } : null;
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
