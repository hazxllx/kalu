import React, { useSyncExternalStore } from "react";

/**
 * Staff registration requests store (frontend demo).
 *
 * Admin-side queue of staff account requests with a review workflow:
 *   Pending → Approved | Rejected | Requires Additional Documents
 * Backend implementation is intentionally NOT included — see
 * docs/backend/README.md.
 */

const STORAGE_KEY = "kalusagap.staff-requests.v1";

export const REQUEST_STATUSES = ["Pending", "Approved", "Rejected", "Requires Additional Documents"];

const isoFromToday = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
};

const request = (f) => ({
  id: f.id,
  name: f.name,
  email: f.email,
  contact: f.contact,
  position: f.position,
  barangay: f.barangay || "",
  documents: f.documents || [],
  status: f.status || "Pending",
  notes: f.notes || "",
  submittedAt: f.submittedAt,
  reviewedBy: f.reviewedBy || "",
  reviewedAt: f.reviewedAt || "",
  // Health Personnel registration detail (all optional; the seeded demo rows
  // leave these blank, while submitted applications populate them).
  firstName: f.firstName || "",
  middleName: f.middleName || "",
  lastName: f.lastName || "",
  suffix: f.suffix || "",
  dob: f.dob || "",
  sex: f.sex || "",
  civilStatus: f.civilStatus || "",
  username: f.username || "",
  roleId: f.roleId || "",
  role: f.role || f.position || "",
  licenseNumber: f.licenseNumber || "",
  licenseExpiry: f.licenseExpiry || "",
  municipality: f.municipality || "",
  facility: f.facility || "",
  department: f.department || "",
  employmentStatus: f.employmentStatus || "",
  yearsOfService: f.yearsOfService || "",
});

const SEED = [
  request({ id: "SR-2026-001", name: "Ana Villanueva", email: "ana.villanueva@example.gov.ph", contact: "0917 555 0101", position: "Public Health Nurse", barangay: "", documents: ["PRC License", "Appointment Order"], status: "Pending", submittedAt: isoFromToday(-3) }),
  request({ id: "SR-2026-002", name: "Roberto Lim", email: "roberto.lim@example.gov.ph", contact: "0917 555 0102", position: "RHU Personnel", barangay: "", documents: ["PRC License"], status: "Pending", submittedAt: isoFromToday(-2) }),
  request({ id: "SR-2026-003", name: "Elena Garcia", email: "elena.garcia@example.gov.ph", contact: "0917 555 0103", position: "Barangay Health Worker", barangay: "San Antonio", documents: ["Barangay Endorsement", "Valid ID"], status: "Requires Additional Documents", notes: "Please upload your training certificate.", submittedAt: isoFromToday(-5), reviewedBy: "Jose Ramirez", reviewedAt: isoFromToday(-4) }),
  request({ id: "SR-2026-004", name: "Carla Torres", email: "carla.torres@example.gov.ph", contact: "0917 555 0104", position: "Public Health Nurse", barangay: "", documents: ["PRC License", "Service Record"], status: "Approved", notes: "Credentials verified.", submittedAt: isoFromToday(-8), reviewedBy: "Jose Ramirez", reviewedAt: isoFromToday(-7) }),
  request({ id: "SR-2026-005", name: "Domingo Salazar", email: "domingo.salazar@example.gov.ph", contact: "0917 555 0105", position: "Barangay Health Worker", barangay: "Old San Roque", documents: ["Valid ID"], status: "Rejected", notes: "Incomplete credentials — endorsement letter missing.", submittedAt: isoFromToday(-10), reviewedBy: "Jose Ramirez", reviewedAt: isoFromToday(-9) }),
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
  cache = SEED.map((r) => ({ ...r }));
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
const getRequests = () => read().map((r) => ({ ...r }));

/** Sequential request id for the current year (SR-YYYY-NNN), matching seeds. */
const nextId = () => {
  const year = new Date().getFullYear();
  const max = read().reduce((acc, r) => {
    const m = String(r.id || "").match(/SR-(\d{4})-(\d+)/);
    return m && Number(m[1]) === year ? Math.max(acc, parseInt(m[2], 10)) : acc;
  }, 0);
  return `SR-${year}-${String(max + 1).padStart(3, "0")}`;
};

/**
 * Submit a staff / health-personnel application. Always starts as `Pending`
 * (the applicant never gains access before admin approval) and returns the
 * created record including its generated application id.
 */
const addRequest = (payload) => {
  const record = request({
    ...payload,
    id: nextId(),
    status: "Pending",
    submittedAt: new Date().toISOString(),
    documents: (payload.documents || []).filter(Boolean),
  });
  cache = [record, ...read()];
  emit();
  return record;
};

/** Duplicate-account guard: is this official email already on a request? */
const hasEmail = (email) => {
  const value = String(email || "").trim().toLowerCase();
  return value ? read().some((r) => String(r.email || "").trim().toLowerCase() === value) : false;
};

/** Duplicate-license guard: is this professional license already registered? */
const hasLicense = (licenseNumber) => {
  const value = String(licenseNumber || "").trim().toLowerCase();
  return value ? read().some((r) => String(r.licenseNumber || "").trim().toLowerCase() === value) : false;
};

/**
 * Review a request. `status` must be one of REQUEST_STATUSES; `notes` is the
 * rejection reason / additional-documents note and is required when rejecting
 * or requesting documents.
 */
const setStatus = (id, status, { notes = "", by = "Admin" } = {}) => {
  cache = read().map((r) =>
    r.id === id
      ? { ...r, status, notes: notes || r.notes, reviewedBy: by, reviewedAt: new Date().toISOString() }
      : r
  );
  emit();
  return read().find((r) => r.id === id) || null;
};

export const useStaffRequests = () => useSyncExternalStore(subscribe, getSnapshot);

export const staffRequestStore = {
  getRequests,
  getSnapshot,
  subscribe,
  addRequest,
  hasEmail,
  hasLicense,
  setStatus,
  statuses: REQUEST_STATUSES,
};

export default staffRequestStore;
