import React, { useSyncExternalStore } from "react";

/**
 * Treatment Consultation session store (local in-session state only).
 *
 * There is NO demo data: the consultation list starts empty. This module keeps
 * the consultations created (or updated) during the current browser session
 * until the corresponding backend endpoint (`consultationsApi`) persists them
 * to the database. Consultation rows keep a snapshot of the selected resident
 * so the record list can display who was consulted and the record stays valid
 * even if the resident list changes; the row shape matches what the pages
 * already expect.
 */

const STORAGE_KEY = "kalusagap.consultations.session.v2";

const initialsOf = (name) =>
  String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

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
  return cache;
};

const persist = () => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache || []));
  } catch {
    /* storage may be unavailable */
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
