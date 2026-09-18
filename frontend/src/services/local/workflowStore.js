import { useSyncExternalStore } from "react";
import { consultationLocationFor } from "@/lib/consultationLocations";

/**
 * Shared front-end "patient workflow" store (local in-session state only).
 *
 * There is NO demo data: every collection starts empty. This module is the
 * canonical in-memory working set for the RHU Personnel/Triage → PHN check-up
 * hand-off during the current app session, used until the corresponding backend
 * endpoints persist the records to the database. It preserves the exact
 * collection shapes the feature pages already expect.
 *
 * Collections:
 *   - patients      — triaged patients in the RHU → PHN check-up pipeline.
 *                     Status: "Waiting for PHN" | "In Check-up" |
 *                     "Consultation Completed". Each row carries the
 *                     read-only triage snapshot and (once completed) the PHN
 *                     check-up record.
 *   - referrals     — referral coordination list (shared with PHN dashboard).
 *   - followUps     — follow-up monitoring list.
 *   - services      — health-services / monitoring list.
 *   - notifications — per-role notification feeds (same shape/UI as the
 *                     existing notification feeds).
 */

export const CHECKUP_STATUS = Object.freeze({
  WAITING: "Waiting for PHN",
  IN_CHECKUP: "In Check-up",
  COMPLETED: "Consultation Completed",
});

// v3: no demo data. Bumped so any previously persisted demo snapshot is ignored
// and replaced by the empty working set on first load.
const STORAGE_KEY = "kalusagap.workflow.v3";

/** Per-role notification feeds the UI expects (each starts empty). */
const NOTIFICATION_ROLES = [
  "resident",
  "resident-limited",
  "bhw",
  "midwife",
  "rhu",
  "phn",
  "mho",
  "admin",
  "rhu_personnel",
];

const emptyNotifications = () =>
  NOTIFICATION_ROLES.reduce((acc, role) => {
    acc[role] = [];
    return acc;
  }, {});

/** Build a pristine, empty store snapshot. */
export const buildInitialSnapshot = () => ({
  patients: [],
  referrals: [],
  followUps: [],
  services: [],
  notifications: emptyNotifications(),
});

const isSnapshot = (value) =>
  Boolean(
    value &&
      Array.isArray(value.patients) &&
      Array.isArray(value.referrals) &&
      Array.isArray(value.followUps) &&
      Array.isArray(value.services) &&
      value.notifications &&
      typeof value.notifications === "object"
  );

const loadPersisted = () => {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

let snapshot = loadPersisted() || buildInitialSnapshot();

// First startup writes the empty snapshot so the working set is stable across
// refreshes and any stale persisted key is replaced.
if (typeof window !== "undefined" && snapshot) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* storage may be unavailable */
  }
}

const persist = () => {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    }
  } catch {
    /* storage may be unavailable */
  }
};

const listeners = new Set();

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getState = () => snapshot;

const commit = (next) => {
  snapshot = next;
  persist();
  listeners.forEach((listener) => listener());
};

/** React hook that re-renders whenever the shared workflow store changes. */
export const useWorkflowStore = () => useSyncExternalStore(subscribe, getState);

/** Reset the workflow store back to the empty working set (dev helper). */
export const resetWorkflowStore = () => commit(buildInitialSnapshot());

const nextId = (list, prefix = "") =>
  list.reduce((max, row) => {
    const n = parseInt(String(row.id).replace(/\D/g, ""), 10);
    return Number.isNaN(n) ? max : Math.max(max, n);
  }, 0) + 1;

const todayLong = () =>
  new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

/* ----------------------------- Patients ---------------------------------- */

/** Record a completed RHU triage and place the patient in the PHN queue. */
export const sendToPhnQueue = (patient) => {
  const list = getState().patients;
  const row = {
    id: nextId(list),
    residentId: patient.residentId || null,
    patient: patient.patient,
    age: patient.age,
    sex: patient.sex,
    barangay: patient.barangay || null,
    residenceBarangay: patient.residenceBarangay || patient.barangay || null,
    consultationLocation: patient.consultationLocation || consultationLocationFor(patient),
    reason: patient.reason,
    status: CHECKUP_STATUS.WAITING,
    visitDate: patient.visitDate || todayLong(),
    queuedAt: patient.queuedAt,
    triage: {
      date: patient.triageDate || todayLong(),
      chiefComplaint: patient.chiefComplaint || patient.reason,
      temperature: patient.temperature || null,
      bloodPressure: patient.bloodPressure || null,
      pulseRate: patient.pulseRate || null,
      respiratoryRate: patient.respiratoryRate || null,
      oxygenSaturation: patient.oxygenSaturation || null,
      weight: patient.weight || null,
      heightCm: patient.heightCm || null,
      bmi: patient.bmi || null,
      bloodSugar: patient.bloodSugar || null,
      notes: patient.notes || "",
      personnel: patient.personnel || "RHU Personnel",
    },
    checkup: undefined,
    source: "triage",
  };
  const next = { ...snapshot, patients: [row, ...list] };
  const notification = buildTriageNotification(row);
  next.notifications = {
    ...next.notifications,
    phn: [notification, ...(next.notifications.phn || [])],
  };
  commit(next);
  return row;
};

const buildTriageNotification = (patient) => ({
  id: nextId(getState().notifications.phn || [], "NTF-"),
  icon: "Activity",
  title: "Patient Ready for Check-up",
  desc: `${patient.patient} has completed triage and is waiting for PHN consultation.`,
  time: "Just now",
  category: "reminder",
  read: false,
  barangay: patient.barangay || null,
});

/** Patch a patient row (used for status transitions). */
export const patchPatient = (id, patch) => {
  const patients = getState().patients.map((p) => (p.id === id ? { ...p, ...patch } : p));
  commit({ ...snapshot, patients });
};

/** Start the PHN consultation for a waiting patient. */
export const startPatientCheckup = (id, personnel) => {
  const patients = getState().patients.map((p) =>
    p.id === id && p.status === CHECKUP_STATUS.WAITING
      ? { ...p, status: CHECKUP_STATUS.IN_CHECKUP, startedBy: personnel || "PHN", startedAt: todayLong() }
      : p
  );
  commit({ ...snapshot, patients });
};

/** Complete the PHN consultation and attach the recorded check-up. */
export const completePatientCheckup = (id, checkup, personnel) => {
  const patients = getState().patients.map((p) =>
    p.id === id
      ? {
          ...p,
          status: CHECKUP_STATUS.COMPLETED,
          checkup: {
            ...checkup,
            outcome: checkup.outcome || "No Further Action",
            completedBy: personnel || p.startedBy || "PHN",
            completedAt: todayLong(),
          },
        }
      : p
  );
  commit({ ...snapshot, patients });
};

/** Record the outcome the PHN chose after completing a check-up. */
export const setCheckupOutcome = (id, outcome) => {
  const patients = getState().patients.map((p) =>
    p.id === id && p.checkup
      ? { ...p, checkup: { ...p.checkup, outcome } }
      : p
  );
  commit({ ...snapshot, patients });
};

/* ----------------------------- Referrals --------------------------------- */

export const addReferral = (referral) => {
  commit({ ...snapshot, referrals: [referral, ...getState().referrals] });
};

export const patchReferral = (id, patch) => {
  const referrals = getState().referrals.map((r) => (r.id === id ? { ...r, ...patch } : r));
  commit({ ...snapshot, referrals });
};

export const replaceReferrals = (referrals) => commit({ ...snapshot, referrals });

export const removeReferral = (id) => {
  const referrals = getState().referrals.filter((r) => r.id !== id);
  commit({ ...snapshot, referrals });
};

/* ----------------------------- Follow-ups -------------------------------- */

export const addFollowUp = (followUp) => {
  commit({ ...snapshot, followUps: [followUp, ...getState().followUps] });
};

export const patchFollowUp = (id, patch) => {
  const followUps = getState().followUps.map((f) => (f.id === id ? { ...f, ...patch } : f));
  commit({ ...snapshot, followUps });
};

export const replaceFollowUps = (followUps) => commit({ ...snapshot, followUps });

export const removeFollowUp = (id) => {
  const followUps = getState().followUps.filter((f) => f.id !== id);
  commit({ ...snapshot, followUps });
};

/* -------------------------- Health services ------------------------------ */

export const addService = (service) => {
  commit({ ...snapshot, services: [service, ...getState().services] });
};

export const patchService = (id, patch) => {
  const services = getState().services.map((s) => (s.id === id ? { ...s, ...patch } : s));
  commit({ ...snapshot, services });
};

export const replaceServices = (services) => commit({ ...snapshot, services });

export const removeService = (id) => {
  const services = getState().services.filter((s) => s.id !== id);
  commit({ ...snapshot, services });
};

/* --------------------------- Notifications ------------------------------- */

export const addNotification = (role, notification) => {
  const roleList = getState().notifications[role] || [];
  const next = {
    ...snapshot,
    notifications: { ...snapshot.notifications, [role]: [notification, ...roleList] },
  };
  commit(next);
};

export const patchNotification = (role, id, patch) => {
  const roleList = (getState().notifications[role] || []).map((n) =>
    n.id === id ? { ...n, ...patch } : n
  );
  const next = {
    ...snapshot,
    notifications: { ...snapshot.notifications, [role]: roleList },
  };
  commit(next);
};

export const replaceRoleNotifications = (role, list) => {
  const next = {
    ...snapshot,
    notifications: { ...snapshot.notifications, [role]: list },
  };
  commit(next);
};

export const markNotificationRead = (role, id) => patchNotification(role, id, { read: true });

export const markRoleNotificationsRead = (role) => {
  const roleList = (getState().notifications[role] || []).map((n) => ({ ...n, read: true }));
  commit({ ...snapshot, notifications: { ...snapshot.notifications, [role]: roleList } });
};

export const clearRoleNotifications = (role) => {
  commit({ ...snapshot, notifications: { ...snapshot.notifications, [role]: [] } });
};

export const workflowHelpers = { nextId, todayLong };

export default { CHECKUP_STATUS, getState, subscribe, useWorkflowStore };
