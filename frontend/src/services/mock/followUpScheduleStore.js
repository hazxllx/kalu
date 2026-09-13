import React, { useSyncExternalStore } from "react";

/**
 * Follow-up Schedule Calendar store (frontend demo).
 *
 * Mirrors the existing mock-store architecture (sessionStorage +
 * useSyncExternalStore). Each schedule is linked to a resident (name + ID) and
 * carries the full follow-up detail rendered by the calendar:
 *
 *   { id, residentName, residentId, date (YYYY-MM-DD), time, location,
 *     provider, instructions, status }
 *
 * Statuses: Scheduled · Pending · Completed · Missed · Cancelled.
 * Seed dates are generated relative to today so the calendar always has
 * demonstrable events in the current month/week.
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

// v2: seed extended with additional resident schedules shared by both the
// Health Supervisor and Resident calendars.
// v3: schedules now carry the resident's confirmation response
// (confirmationStatus / rejectionReason / respondedAt), shared by the Health
// Supervisor and Resident calendars.
const STORAGE_KEY = "kalusagap.followup-schedule.v3";

const pad = (n) => String(n).padStart(2, "0");
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Date offset from today, as a YYYY-MM-DD key. */
const dayFromToday = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toKey(d);
};

/** Full ISO timestamp offset from now (used for the resident's response time). */
const isoFromToday = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString();
};

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

const buildSeed = () => [
  // Resident demo account (Maria Santos) — one awaiting confirmation (test
  // Confirm), one awaiting (test Reject), one confirmed, one rejected.
  schedule({
    id: "FS-0001", residentName: "Maria Santos", residentId: "R-1024", date: dayFromToday(0), time: "09:00",
    location: "San Isidro Barangay Health Station", provider: "Maria Dela Cruz",
    instructions: "Prenatal check-up; record BP and fundal height.", status: "Scheduled",
  }),
  schedule({
    id: "FS-0002", residentName: "Rosa Dimagiba", residentId: "R-2101", date: dayFromToday(0), time: "10:30",
    location: "Residence (Home Visit)", provider: "Maria Cruz",
    instructions: "BP re-check and medication adherence counselling.", status: "Pending",
  }),
  schedule({
    id: "FS-0003", residentName: "Andres Banaag", residentId: "R-2102", date: dayFromToday(1), time: "08:30",
    location: "RHU Pili", provider: "Ana Villanueva",
    instructions: "Diabetes follow-up; fasting blood sugar review.", status: "Scheduled",
    confirmationStatus: "Confirmed", respondedAt: isoFromToday(-1),
  }),
  schedule({
    id: "FS-0004", residentName: "Elena Garcia", residentId: "R-2103", date: dayFromToday(2), time: "14:00",
    location: "San Isidro Barangay Health Station", provider: "Maria Dela Cruz",
    instructions: "Prenatal assessment for second trimester.", status: "Scheduled",
    confirmationStatus: "Confirmed", respondedAt: isoFromToday(-2),
  }),
  schedule({
    id: "FS-0005", residentName: "Marites Ramos", residentId: "R-2104", date: dayFromToday(3), time: "11:00",
    location: "Residence (Home Visit)", provider: "Lourdes Ramos",
    instructions: "TB DOTS continuation; check pill count.", status: "Scheduled",
  }),
  schedule({
    id: "FS-0006", residentName: "Juan Dela Cruz", residentId: "R-1025", date: dayFromToday(4), time: "09:30",
    location: "San Isidro Barangay Health Station", provider: "Grace Aquino",
    instructions: "Hypertension maintenance review.", status: "Scheduled",
  }),
  schedule({
    id: "FS-0007", residentName: "Conchita Ramos", residentId: "R-2106", date: dayFromToday(5), time: "13:30",
    location: "Residence (Home Visit)", provider: "Maria Cruz",
    instructions: "Senior care visit; BP and meds review.", status: "Scheduled",
  }),
  schedule({
    id: "FS-0008", residentName: "Kris Marquez", residentId: "R-2105", date: dayFromToday(-1), time: "15:00",
    location: "San Isidro Day Care Center", provider: "Lourdes Ramos",
    instructions: "Family planning counselling follow-up.", status: "Completed",
    confirmationStatus: "Confirmed", respondedAt: isoFromToday(-3),
  }),
  schedule({
    id: "FS-0009", residentName: "Pedro Reyes", residentId: "R-1027", date: dayFromToday(-2), time: "10:00",
    location: "San Isidro Barangay Health Station", provider: "Grace Aquino",
    instructions: "Immunization catch-up next dose.", status: "Missed",
  }),
  schedule({
    id: "FS-0010", residentName: "Rosa Bautista", residentId: "R-1026", date: dayFromToday(7), time: "09:00",
    location: "Residence (Home Visit)", provider: "Maria Dela Cruz",
    instructions: "Senior citizen wellness visit.", status: "Cancelled",
  }),
  schedule({
    id: "FS-0011", residentName: "Maria Santos", residentId: "R-1024", date: dayFromToday(9), time: "14:30",
    location: "RHU Pili", provider: "Ana Villanueva",
    instructions: "Prenatal laboratory results review.", status: "Scheduled",
  }),
  schedule({
    id: "FS-0012", residentName: "Marites Ramos", residentId: "R-2104", date: dayFromToday(12), time: "11:30",
    location: "Residence (Home Visit)", provider: "Lourdes Ramos",
    instructions: "Sputum re-check; assess treatment response.", status: "Pending",
  }),
  // Additional schedules for the verified-resident demo account (Maria Santos)
  // so the Resident calendar demonstrates Completed / Pending history alongside
  // the scheduled visits. Shared with the Health Supervisor calendar.
  schedule({
    id: "FS-0013", residentName: "Maria Santos", residentId: "R-1024", date: dayFromToday(-6), time: "09:30",
    location: "San Isidro Barangay Health Station", provider: "Maria Dela Cruz",
    instructions: "Prenatal vitamins dispensing and BP monitoring.", status: "Completed",
    confirmationStatus: "Confirmed", respondedAt: isoFromToday(-8),
  }),
  schedule({
    id: "FS-0014", residentName: "Maria Santos", residentId: "R-1024", date: dayFromToday(4), time: "10:00",
    location: "San Isidro Barangay Health Station", provider: "Maria Dela Cruz",
    instructions: "Weight and BP monitoring; bring maternal health booklet.", status: "Pending",
    confirmationStatus: "Rejected",
    rejectionReason: "I have another appointment on the scheduled date.",
    respondedAt: isoFromToday(-1),
  }),
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
  cache = buildSeed();
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
