import React, { useSyncExternalStore } from "react";

/**
 * Municipality registration applications (frontend demo).
 *
 * Mirrors the existing mock-store architecture: applications created during the
 * current session persist in `sessionStorage` and are listed in the System
 * Administrator's municipality application review screen.
 *
 * Municipality applicants do NOT gain municipality-level access. The application
 * moves through a review workflow (pending → under review → approved / rejected
 * / requires additional documents) and only an authorized administrator can
 * approve it.
 */

export const MUNICIPALITY_STATUSES = [
  "Pending Verification",
  "Under Review",
  "Approved",
  "Rejected",
  "Requires Additional Documents",
];

/** Configured legal-document requirements (admin-editable later). */
export const MUNICIPALITY_DOC_REQUIREMENTS = [
  { key: "lgu_id", label: "Proof of Government / LGU identity or registration", required: true },
  { key: "authorization", label: "Official authorization document", required: true },
  { key: "authorization_letter", label: "Authorization letter or designation document", required: false },
  { key: "rep_id", label: "Valid government-issued ID of the authorized representative", required: true },
  { key: "other", label: "Other legal / supporting documents", required: false },
];

export const ACCEPTED_DOC_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
export const MAX_DOC_SIZE = 10 * 1024 * 1024;

const STORAGE_KEY = "kalusagap.municipalities.session.v1";

const SEED = [
  {
    id: "MUN-2026-0001",
    status: "Pending Verification",
    submittedAt: "2026-08-14T09:00:00.000Z",
    municipalityName: "Pili",
    province: "Camarines Sur",
    region: "Region V (Bicol)",
    address: "Municipal Hall, Pili Municipal Government Complex, Pili, Camarines Sur",
    contact: "(054) 123-4567",
    email: "lgupili@example.gov.ph",
    representative: "Josefa Ramirez",
    position: "Municipal Administrator",
    repEmail: "admin.pili@example.gov.ph",
    repContact: "0917 000 1234",
    documents: {},
    notes: "",
  },
];

const cloneSeed = () => SEED.map((a) => ({ ...a, documents: { ...a.documents } }));

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
const getApplications = () => read().map((a) => ({ ...a, documents: { ...a.documents } }));

const nextId = () => {
  const year = new Date().getFullYear();
  const max = read().reduce((acc, a) => {
    const m = String(a.id || "").match(/MUN-(\d{4})-(\d+)/);
    return m && Number(m[1]) === year ? Math.max(acc, parseInt(m[2], 10)) : acc;
  }, 0);
  return `MUN-${year}-${String(max + 1).padStart(4, "0")}`;
};

/** Submit a municipality application (always starts as Pending Verification). */
const addApplication = (payload) => {
  const app = {
    id: nextId(),
    status: "Pending Verification",
    submittedAt: new Date().toISOString(),
    municipalityName: String(payload.municipalityName || "").trim(),
    province: String(payload.province || "").trim(),
    region: String(payload.region || "").trim(),
    address: String(payload.address || "").trim(),
    contact: String(payload.contact || "").trim(),
    email: String(payload.email || "").trim(),
    representative: String(payload.representative || "").trim(),
    position: String(payload.position || "").trim(),
    repEmail: String(payload.repEmail || "").trim(),
    repContact: String(payload.repContact || "").trim(),
    documents: { ...(payload.documents || {}) },
    notes: "",
  };
  cache = [app, ...read()];
  emit();
  return app;
};

/** Admin review actions. */
const setStatus = (id, status, notes = "") => {
  cache = read().map((a) =>
    a.id === id
      ? { ...a, status, notes: notes || a.notes || "", reviewedAt: new Date().toISOString() }
      : a
  );
  emit();
};

export const useMunicipalityApplications = () => useSyncExternalStore(subscribe, getSnapshot);

export const municipalityStore = {
  getApplications,
  getSnapshot,
  subscribe,
  addApplication,
  setStatus,
  nextId,
};

export default municipalityStore;
