import { useSyncExternalStore } from "react";
import { consultationLocationFor, barangayHealthCenter } from "@/lib/consultationLocations";
import {
  phnCheckupQueue,
  phnFollowUps,
  phnHealthServices,
  phnReferrals,
} from "@/services/mock/mockPhnData";
import { NOTIFICATIONS } from "@/services/mock/notificationData";

/**
 * Shared front-end "patient workflow" store (mock/local-state only).
 *
 * The RHU Personnel/Triage → PHN check-up hand-off must flow through ONE
 * patient object/state. Each feature page previously kept its own local copy
 * of mock arrays that was reset on every navigation. This module keeps the
 * canonical in-memory copies of that data for the current app session and
 * persists them to localStorage so logging out and back in (or refreshing)
 * keeps the workflow intact during a demo.
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
 *                     existing notificationData module).
 */

export const CHECKUP_STATUS = Object.freeze({
  WAITING: "Waiting for PHN",
  IN_CHECKUP: "In Check-up",
  COMPLETED: "Consultation Completed",
});

const STORAGE_KEY = "kalusagap.workflow.v1";

/** Triage snapshot reused for the demo patients already in the check-up queue. */
const SEED_TRIAGE = {
  "Rosa Dimagiba": {
    chiefComplaint: "Elevated BP with headache on re-check",
    temperature: "36.8",
    bloodPressure: "145/92",
    pulseRate: "88",
    respiratoryRate: "20",
    oxygenSaturation: "97",
    weight: null,
    notes: "Walk-in BP re-check. BP elevated on two readings taken five minutes apart.",
    personnel: "RHU Personnel A. Reyes",
  },
  "Elena Garcia": {
    chiefComplaint: "Prenatal assessment requested",
    temperature: "36.6",
    bloodPressure: "138/88",
    pulseRate: "92",
    respiratoryRate: "19",
    oxygenSaturation: "98",
    weight: "61",
    notes: "Prenatal patient referred by BHS San Isidro. No danger signs reported.",
    personnel: "RHU Personnel A. Reyes",
  },
  "Marites Ramos": {
    chiefComplaint: "Cough for 2 weeks with night sweats",
    temperature: "37.1",
    bloodPressure: "120/80",
    pulseRate: "86",
    respiratoryRate: "21",
    oxygenSaturation: "96",
    weight: "54",
    notes: "TB symptom screening requested. Sputum examination to be arranged.",
    personnel: "RHU Personnel A. Reyes",
  },
  "Dante Villar": {
    chiefComplaint: "Uncontrolled hypertension",
    temperature: "36.7",
    bloodPressure: "158/96",
    pulseRate: "94",
    respiratoryRate: "20",
    oxygenSaturation: "95",
    weight: "72",
    notes: "Referred by BHS San Antonio. BP consistently above 150/95 on medication.",
    personnel: "RHU Personnel A. Reyes",
  },
  "Sofia Reyes": {
    chiefComplaint: "Nutrition follow-up / slow weight gain",
    temperature: "36.5",
    bloodPressure: null,
    pulseRate: "98",
    respiratoryRate: "22",
    oxygenSaturation: "98",
    weight: "19",
    notes: "Growth monitoring shows weight below expected percentile for age.",
    personnel: "RHU Personnel A. Reyes",
  },
  "Andres Banaag": {
    chiefComplaint: "Diabetes medication review",
    temperature: "36.9",
    bloodPressure: "134/86",
    pulseRate: "80",
    respiratoryRate: "18",
    oxygenSaturation: "96",
    weight: "78",
    notes: "RHU-level diabetes follow-up. FBS on record 170 mg/dL.",
    personnel: "RHU Personnel A. Reyes",
  },
  "Kris Marquez": {
    chiefComplaint: "Immunization follow-up (missed dose)",
    temperature: "36.4",
    bloodPressure: null,
    pulseRate: "84",
    respiratoryRate: "19",
    oxygenSaturation: "99",
    weight: null,
    notes: "Referred by BHW Grace Aquino for catch-up immunization.",
    personnel: "RHU Personnel A. Reyes",
  },
};

const SEED_VISIT_DATE = "September 5, 2026";

const seedPatients = () =>
  phnCheckupQueue.map((q) => {
    const triage = SEED_TRIAGE[q.patient] || {
      chiefComplaint: q.reason,
      temperature: "36.6",
      bloodPressure: null,
      pulseRate: null,
      respiratoryRate: null,
      oxygenSaturation: null,
      weight: null,
      notes: q.notes || "Sent to PHN after RHU triage.",
      personnel: "RHU Personnel A. Reyes",
    };
    return {
      id: q.id,
      residentId: `RES-${String(2000 + q.id)}`,
      patient: q.patient,
      age: q.age,
      sex: q.sex,
      barangay: q.barangay || null,
      residenceBarangay: q.barangay || null,
      consultationLocation: q.consultationLocation || consultationLocationFor(q),
      reason: q.reason,
      status: CHECKUP_STATUS.WAITING,
      queuedAt: q.queuedAt,
      visitDate: SEED_VISIT_DATE,
      triage: { date: SEED_VISIT_DATE, ...triage },
      checkup: undefined,
      source: "seed",
    };
  });

const roleKeys = Object.keys(NOTIFICATIONS).filter((k) => k !== "resident-limited");

const seedNotifications = () => {
  const seeded = { resident: [], "resident-limited": [], bhw: [], midwife: [], rhu: [], phn: [], mho: [], admin: [], rhu_personnel: [] };
  Object.entries(NOTIFICATIONS).forEach(([role, items]) => {
    seeded[role] = items.map((n) => ({ ...n }));
  });
  seeded.rhu_personnel = [
    {
      id: 1,
      icon: "Activity",
      title: "Triage queue ready",
      desc: "Triage a patient to send them to the PHN for check-up.",
      time: "1 hour ago",
      category: "reminder",
      read: false,
      barangay: null,
    },
  ];
  return seeded;
};

/** Build a pristine store snapshot from the mock datasets. */
export const buildInitialSnapshot = () => ({
  patients: seedPatients(),
  referrals: phnReferrals.map((r) => ({ ...r })),
  followUps: phnFollowUps.map((f) => ({ ...f })),
  services: phnHealthServices.map((s) => ({ ...s })),
  notifications: seedNotifications(),
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

/** Corrected consultation locations for the fixed demo patients. */
const DEMO_LOCATION_FIX = {
  "Rosa Dimagiba": "San Isidro Barangay Health Center",
  "Elena Garcia": "San Isidro Barangay Health Center",
  "Marites Ramos": "San Isidro Barangay Health Center",
  "Kris Marquez": "San Isidro Barangay Health Center",
  "Dante Villar": "San Antonio Barangay Health Center",
  "Sofia Reyes": "Old San Roque Barangay Health Center",
  "Andres Banaag": "RHU",
  "Juan Dela Cruz": "RHU",
};

/** Demo patients whose residency record changed across demo versions. */
const DEMO_RESIDENCY = {
  "Rosa Dimagiba": "San Isidro",
  "Andres Banaag": "San Isidro",
  "Juan Dela Cruz": "San Antonio",
};

/** Migrate snapshots saved by earlier frontend versions so demo data stays usable. */
const migrateSnapshot = (snap) => {
  const patients = (snap.patients || []).map((p) => {
    // Residency for the fixed demo patients (Rosa/Andres now San Isidro, Juan
    // Dela Cruz now San Antonio) so residency and service location stay
    // separate instead of being collapsed to "RHU-level".
    const correctedBarangay = DEMO_RESIDENCY[p.patient];
    const barangay = correctedBarangay && !p.barangay ? correctedBarangay : p.barangay || null;
    const residence =
      p.residenceBarangay !== undefined ? p.residenceBarangay : barangay;
    const consultationLocation =
      DEMO_LOCATION_FIX[p.patient] ||
      p.consultationLocation ||
      barangayHealthCenter(barangay);
    const locationFix = DEMO_LOCATION_FIX[p.patient];
    const checkup =
      p.checkup && locationFix && p.checkup.consultationLocation
        ? { ...p.checkup, consultationLocation: locationFix }
        : p.checkup;
    const age =
      p.patient === "Juan Dela Cruz" && (p.age === undefined || p.age === null)
        ? 45
        : p.age;
    return {
      ...p,
      barangay,
      residenceBarangay: residence,
      consultationLocation,
      checkup,
      age,
    };
  });
  return { ...snap, patients };
};

const loadPersisted = () => {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isSnapshot(parsed) ? migrateSnapshot(parsed) : null;
  } catch {
    return null;
  }
};

/**
 * Keep persisted demo state in step with the current mock seed WITHOUT wiping
 * user actions (status changes, completed check-ups, newly triaged patients).
 *
 * New/changed demo patients are merged by name/id so Juan Dela Cruz appears
 * exactly once with his current fields; patient rows the user created through
 * triage are preserved and never duplicated.
 */
const reconcilePatients = (current = []) => {
  const seeds = buildInitialSnapshot().patients;
  const key = (name) => String(name || "").trim().toLowerCase();
  const byName = new Map();
  const byId = new Map();
  let maxId = 0;

  current.forEach((p) => {
    byId.set(String(p.id), p);
    const k = key(p.patient);
    if (!byName.has(k)) byName.set(k, p);
    const numericId = Number(p.id);
    if (!Number.isNaN(numericId) && numericId > maxId) maxId = numericId;
  });

  const used = new Set();
  const merged = [];

  seeds.forEach((seed) => {
    const nameKey = key(seed.patient);
    let match = byName.get(nameKey);
    // Never merge a user-triaged visit (source === "triage") into the demo row.
    if (match && match.source === "triage") match = null;
    if (!match) {
      const idCandidate = byId.get(String(seed.id));
      if (idCandidate && key(idCandidate.patient) === nameKey) match = idCandidate;
    }

    if (match) {
      used.add(match);
      merged.push({
        ...seed,
        // Preserve workflow state produced by the user on the demo patient.
        id: match.id,
        status: match.status || seed.status,
        queuedAt: seed.queuedAt,
        visitDate: match.visitDate || seed.visitDate,
        startedBy: match.startedBy,
        startedAt: match.startedAt,
        checkup: match.checkup,
        source: match.source || seed.source,
      });
      return;
    }

    // The demo id is taken by an unrelated row (e.g. a triaged patient that
    // reused the numeric id): keep that row and give the demo seed a free id.
    let id = seed.id;
    const isIdFree = (candidateId) =>
      !byId.has(String(candidateId)) && !merged.some((row) => String(row.id) === String(candidateId));
    while (!isIdFree(id)) {
      maxId += 1;
      id = maxId;
    }
    merged.push({ ...seed, id });
  });

  // Preserve every row that was not consumed by the seed merge (user-created
  // patients, earlier demo rows that no longer exist in the seed, etc.).
  current.forEach((p) => {
    if (!used.has(p)) merged.push(p);
  });

  return merged;
};

/** Merge the current demo seed into any persisted snapshot. */
const reconcileSnapshot = (snap) =>
  snap ? { ...snap, patients: reconcilePatients(snap.patients || []) } : snap;

let snapshot = reconcileSnapshot(loadPersisted() || buildInitialSnapshot());

// First startup writes the reconciled snapshot so the demo is stable across
// refreshes without requiring the user to clear localStorage.
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

/** Reset the workflow store back to the seeded mock data (dev helper). */
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
