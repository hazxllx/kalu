import React, { useSyncExternalStore } from "react";

/**
 * Follow-up Schedule Calendar store (local in-session state only).
 *
 * There is NO demo data: the schedule list starts empty. This module keeps the
 * schedules created (or updated) during the current browser session until the
 * corresponding backend endpoint persists them to the database. Each schedule
 * is linked to a resident (name + ID) and carries the full follow-up detail
 * rendered by the calendar:
 *
 *   { id, residentName, residentId, date (YYYY-MM-DD), time, location,
 *     provider, instructions, status }
 *
 * Statuses: Scheduled · Pending · Completed · Missed · Cancelled.
 */

export const SCHEDULE_STATUSES = ["Scheduled", "Pending", "Completed", "Missed", "Cancelled"];

/**
 * Resident response to a schedule — kept SEPARATE from the follow-up status:
 *   { status: "Scheduled", confirmationStatus: "Rejected", rejectionReason: "..." }
 */
export const CONFIRMATION_STATUSES = ["Awaiting Confirmation", "Confirmed", "Rejected"];

export const PROVIDERS = [
  "Maria Dela Cruz",
  "Maria Cruz",
  "Lourdes Ramos",
  "Grace Aquino",
  "Ana Villanueva",
];

export const LOCATIONS = [
  "San Isidro Barangay Health Station",
  "Residence (Home Visit)",
  "RHU Pili",
  "Purok 1 Covered Court",
  "San Isidro Day Care Center",
];

// v4: no demo data. Bumped so any previously persisted demo schedules are
// ignored and replaced by the empty working set on first load.
const STORAGE_KEY = "kalusagap.followup-schedule.v4";

const schedule = (f) => ({
  id: f.id,
  residentName: f.residentName,
  residentId: f.residentId,
  date: f.date,
  time: f.time || "09:00",
  location: f.location,
  provider: f.provider,
  instructions: f.instructions || "",
  status: f.status || "Scheduled",
  // Resident confirmation (owned by the Resident; never edited by the HS form).
  confirmationStatus: f.confirmationStatus || "Awaiting Confirmation",
  rejectionReason: f.rejectionReason || "",
  respondedAt: f.respondedAt || "",
  createdAt: f.createdAt || new Date().toISOString(),
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

// Immediately write the empty working set so stale persisted keys are replaced.
persist();

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

const nextId = () => {
  const max = read().reduce((acc, s) => {
    const m = String(s.id || "").match(/FS-(\d+)/);
    return m ? Math.max(acc, parseInt(m[1], 10)) : acc;
  }, 0);
  return `FS-${String(max + 1).padStart(4, "0")}`;
};

/** Create a schedule. Returns the created record. */
const addSchedule = (payload) => {
  const record = schedule({ ...payload, id: nextId() });
  cache = [record, ...read()];
  emit();
  return record;
};

/** Update an existing schedule (by id). */
const updateSchedule = (id, payload) => {
  cache = read().map((s) => (s.id === id ? { ...s, ...payload, id } : s));
  emit();
};

/** Soft-cancel: keeps the record, marks the status Cancelled. */
const cancelSchedule = (id) => {
  cache = read().map((s) => (s.id === id ? { ...s, status: "Cancelled" } : s));
  emit();
};

/** Remove a schedule from the calendar entirely. */
const deleteSchedule = (id) => {
  cache = read().filter((s) => s.id !== id);
  emit();
};

/**
 * Resident confirms they will attend. Only the confirmation fields change —
 * the follow-up status, date, time, location, provider, and instructions
 * stay exactly as the Health Supervisor scheduled them.
 */
const confirmSchedule = (id) => {
  cache = read().map((s) =>
    s.id === id
      ? {
          ...s,
          confirmationStatus: "Confirmed",
          rejectionReason: "",
          respondedAt: new Date().toISOString(),
        }
      : s
  );
  emit();
  return read().find((s) => s.id === id) || null;
};

/** Resident rejects the schedule; a reason is required and stored. */
const rejectSchedule = (id, reason) => {
  cache = read().map((s) =>
    s.id === id
      ? {
          ...s,
          confirmationStatus: "Rejected",
          rejectionReason: String(reason || "").trim(),
          respondedAt: new Date().toISOString(),
        }
      : s
  );
  emit();
  return read().find((s) => s.id === id) || null;
};

export const useFollowUpSchedules = () => useSyncExternalStore(subscribe, getSnapshot);

export const followUpScheduleStore = {
  getSnapshot,
  subscribe,
  addSchedule,
  updateSchedule,
  cancelSchedule,
  deleteSchedule,
  confirmSchedule,
  rejectSchedule,
  statuses: SCHEDULE_STATUSES,
  confirmationStatuses: CONFIRMATION_STATUSES,
  providers: PROVIDERS,
  locations: LOCATIONS,
};

export default followUpScheduleStore;
