import React, { useSyncExternalStore } from "react";

/**
 * Treatment Consultation session store (frontend demo).
 *
 * Mirrors the existing mock-store architecture (residentStore / householdStore):
 * seeded from the shared mock dataset and remembers consultations created (or
 * updated) during the current browser session. Consultation rows keep a
 * snapshot of the selected resident so the record list can display who was
 * consulted and the record stays valid even if the resident list changes.
 *
 * The real backend endpoint is `consultationsApi`; this store only powers the
 * demo experience until the API is wired.
 */

const STORAGE_KEY = "kalusagap.consultations.session.v1";

const SEED_RESIDENTS = {
  "Maria Santos": { id: "R-2001", name: "Maria Santos", age: 28, sex: "Female", barangay: "San Isidro", program: "Maternal Care", bloodType: "O+", contact: "0918 234 5678" },
  "Ana Villanueva": { id: "RES-0001", name: "Ana Villanueva", age: 32, sex: "Female", barangay: "San Isidro", program: "Maternal Care", bloodType: "B+", contact: "0917 123 4567" },
  "Elena Garcia": { id: "R-2102", name: "Elena Garcia", age: 25, sex: "Female", barangay: "San Isidro", program: "Maternal Care", bloodType: "A+", contact: "0919 345 6789" },
  "Rosa Dimagiba": { id: "R-2101", name: "Rosa Dimagiba", age: 34, sex: "Female", barangay: "San Isidro", program: "Hypertension", bloodType: "A+", contact: "0917 555 0111" },
};

const initialsOf = (name) =>
  String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** Seeded consultations (full structured rows, shown on first load). */
const SEED = [
  {
    id: "CON-2026-0001",
    consultationDate: "2026-08-28",
    consultationTime: "09:15",
    chiefComplaint: "Routine prenatal check-up",
    resident: SEED_RESIDENTS["Maria Santos"],
    bloodPressure: "118/76",
    temperature: "36.7",
    pulseRate: "74",
    respiratoryRate: "18",
    height: "158",
    weight: "62",
    oxygenSaturation: "98",
    findings: "Mother in good condition. No vaginal bleeding. Normal fetal movement reported.",
    diagnosis: "Normal Prenatal Progress",
    treatmentGiven: "Routine prenatal assessment completed. Prenatal vitamins continued.",
    medicationPrescribed: "Ferrous Sulfate, Folic Acid",
    adviceGiven: "Continue daily prenatal vitamins. Increase water intake. Return immediately if bleeding occurs.",
    followUpRequired: "Yes",
    nextVisitDate: "2026-09-11",
    referralRequired: "No",
    remarks: "Pregnancy progressing normally. Continue routine prenatal monitoring.",
    provider: "Maria Dela Cruz",
    providerRole: "Health Supervisor",
    createdAt: "2026-08-28T09:15:00.000Z",
  },
  {
    id: "CON-2026-0002",
    consultationDate: "2026-08-25",
    consultationTime: "14:00",
    chiefComplaint: "BP re-check",
    resident: SEED_RESIDENTS["Rosa Dimagiba"],
    bloodPressure: "145/92",
    temperature: "36.5",
    pulseRate: "82",
    respiratoryRate: "18",
    height: "155",
    weight: "58",
    oxygenSaturation: "98",
    findings: "Blood pressure elevated above target on two readings.",
    diagnosis: "Uncontrolled Hypertension",
    treatmentGiven: "Counseled on medication adherence and lifestyle measures.",
    medicationPrescribed: "Amlodipine 5mg (continue)",
    adviceGiven: "Take medication daily at the same time. Reduce salty food. Return in 2 weeks.",
    followUpRequired: "Yes",
    nextVisitDate: "2026-09-08",
    referralRequired: "No",
    remarks: "Monitor BP at home; bring log on next visit.",
    provider: "Maria Dela Cruz",
    providerRole: "Health Supervisor",
    createdAt: "2026-08-25T14:00:00.000Z",
  },
];

const cloneSeed = () => SEED.map((r) => ({ ...r, resident: { ...r.resident } }));

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
  cache = cloneSeed();
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
const getConsultations = () => read().map((c) => ({ ...c, resident: { ...c.resident } }));

const nextId = () => {
  const list = read();
  const year = new Date().getFullYear();
  const max = list.reduce((acc, c) => {
    const m = String(c.id || "").match(/CON-(\d{4})-(\d+)/);
    return m && Number(m[1]) === year ? Math.max(acc, parseInt(m[2], 10)) : acc;
  }, 0);
  return `CON-${year}-${String(max + 1).padStart(4, "0")}`;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Create a treatment consultation record. */
const addConsultation = (payload) => {
  const list = read();
  const record = {
    id: nextId(),
    consultationDate: payload.consultationDate || todayIso(),
    consultationTime: payload.consultationTime || "",
    chiefComplaint: String(payload.chiefComplaint || "").trim(),
    resident: payload.resident ? { ...payload.resident } : null,
    bloodPressure: String(payload.bloodPressure || "").trim(),
    temperature: String(payload.temperature || "").trim(),
    pulseRate: String(payload.pulseRate || "").trim(),
    respiratoryRate: String(payload.respiratoryRate || "").trim(),
    height: String(payload.height || "").trim(),
    weight: String(payload.weight || "").trim(),
    oxygenSaturation: String(payload.oxygenSaturation || "").trim(),
    findings: String(payload.findings || "").trim(),
    diagnosis: String(payload.diagnosis || "").trim(),
    treatmentGiven: String(payload.treatmentGiven || "").trim(),
    medicationPrescribed: String(payload.medicationPrescribed || "").trim(),
    adviceGiven: String(payload.adviceGiven || "").trim(),
    followUpRequired: payload.followUpRequired || "No",
    nextVisitDate: payload.nextVisitDate || "",
    referralRequired: payload.referralRequired || "No",
    remarks: String(payload.remarks || "").trim(),
    provider: payload.provider || "",
    providerRole: payload.providerRole || "",
    createdAt: payload.createdAt || new Date().toISOString(),
  };
  cache = [record, ...list];
  emit();
  return record;
};

/** Update an existing consultation (by id). */
const updateConsultation = (id, payload) => {
  const list = read();
  cache = list.map((c) => {
    if (c.id !== id) return c;
    return {
      ...c,
      ...payload,
      id,
      resident: payload.resident ? { ...payload.resident } : c.resident,
      updatedAt: new Date().toISOString(),
    };
  });
  emit();
};

const getById = (id) => {
  const found = read().find((c) => c.id === id);
  return found ? { ...found, resident: found.resident ? { ...found.resident } : null } : null;
};

export const useConsultations = () => useSyncExternalStore(subscribe, getSnapshot);

export const consultationStore = {
  getConsultations,
  getSnapshot,
  subscribe,
  addConsultation,
  updateConsultation,
  getById,
  nextId,
  initialsOf,
};

export { initialsOf };
export default consultationStore;
