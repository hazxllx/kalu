import React, { useSyncExternalStore } from "react";

/**
 * Medical Certificate store (frontend demo).
 *
 * Follows the existing mock-store architecture (sessionStorage +
 * useSyncExternalStore). Certificates are always linked to an existing patient
 * record (patientId + snapshot) and move through a review workflow:
 *
 *   Draft → For Review → Approved → Issued
 *                     ↘ Rejected / Cancelled
 *
 * - Triage / PHN prepare certificates (Draft) and submit them (For Review).
 * - Only the MHO can approve / issue / reject (status changes are audited).
 * - PHN access is limited to their RHU workflow scope (enforced by the pages).
 */

export const CERT_STATUSES = ["Draft", "For Review", "Approved", "Issued", "Rejected", "Cancelled"];

export const CERT_PURPOSES = [
  "General Medical Certificate",
  "Fitness to Work / School",
  "Sick Leave Certification",
  "Post-Consultation Clearance",
  "Travel / Camping Clearance",
];

const STORAGE_KEY = "kalusagap.med-certificates.v1";

const todayIso = () => new Date().toISOString().slice(0, 10);

const cert = (f) => ({
  id: f.id,
  reference: f.reference,
  patientId: f.patientId,
  patient: f.patient,
  age: f.age,
  sex: f.sex,
  barangay: f.barangay,
  address: f.address,
  purpose: f.purpose,
  findings: f.findings,
  dateOfExamination: f.dateOfExamination,
  medicalOfficer: f.medicalOfficer || "",
  licenseNumber: f.licenseNumber || "",
  status: f.status || "Draft",
  preparedBy: f.preparedBy || "",
  preparedByRole: f.preparedByRole || "",
  dateIssued: f.dateIssued || "",
  notes: f.notes || "",
  // Formal document fields (A4 Medical Certificate layout).
  certificateNumber: f.certificateNumber || f.reference || "",
  civilStatus: f.civilStatus || "",
  recommendation: f.recommendation || "",
  remarks: f.remarks || "",
  issuedAt: f.issuedAt || "",
  orNumber: f.orNumber || "",
  amount: f.amount || "",
  paymentDate: f.paymentDate || "",
  createdAt: f.createdAt || new Date().toISOString(),
  audit: f.audit || [
    { action: "Created", by: f.preparedBy || "—", at: f.createdAt || new Date().toISOString(), notes: "" },
  ],
});

const SEED = [
  cert({
    id: "MC-2026-0001", reference: "MC-2026-0001", patientId: "R-1024", patient: "Maria Santos", age: 28, sex: "Female",
    barangay: "San Isidro", address: "Purok 1, San Isidro", purpose: "General Medical Certificate",
    findings: "Routine prenatal consultation. Vital signs within normal limits; no acute distress noted.",
    dateOfExamination: "2026-09-08", status: "Issued", preparedBy: "Antonio Reyes", preparedByRole: "RHU Personnel",
    medicalOfficer: "Dr. Maria L. Santos", licenseNumber: "PRC-0123456", dateIssued: "2026-09-09",
    createdAt: "2026-09-08T09:20:00.000Z",
  }),
  cert({
    id: "MC-2026-0002", reference: "MC-2026-0002", patientId: "R-2101", patient: "Rosa Dimagiba", age: 34, sex: "Female",
    barangay: "San Isidro", address: "Purok 2, San Isidro", purpose: "Fitness to Work / School",
    findings: "Blood pressure 145/92 during check-up; advised follow-up and medication adherence.",
    dateOfExamination: "2026-09-10", status: "For Review", preparedBy: "Ana Villanueva", preparedByRole: "Public Health Nurse",
    createdAt: "2026-09-10T10:05:00.000Z",
  }),
  cert({
    id: "MC-2026-0003", reference: "MC-2026-0003", patientId: "R-2102", patient: "Andres Banaag", age: 60, sex: "Male",
    barangay: "San Isidro", address: "Purok 3, San Isidro", purpose: "Sick Leave Certification",
    findings: "Uncontrolled diabetes; referred for medication review and blood-sugar monitoring.",
    dateOfExamination: "2026-09-09", status: "Approved", preparedBy: "Ana Villanueva", preparedByRole: "Public Health Nurse",
    medicalOfficer: "Dr. Maria L. Santos", licenseNumber: "PRC-0123456", dateIssued: "",
    createdAt: "2026-09-09T14:30:00.000Z",
  }),
  cert({
    id: "MC-2026-0004", reference: "MC-2026-0004", patientId: "R-1030", patient: "Liza Gonzales", age: 45, sex: "Female",
    barangay: "Old San Roque", address: "Purok 4, Old San Roque", purpose: "Post-Consultation Clearance",
    findings: "TB DOTS follow-up ongoing; sputum results pending.",
    dateOfExamination: "2026-09-05", status: "Rejected", preparedBy: "Antonio Reyes", preparedByRole: "RHU Personnel",
    medicalOfficer: "Dr. Maria L. Santos", notes: "Awaiting sputum results before certification; please re-submit once available.",
    createdAt: "2026-09-05T11:00:00.000Z",
  }),
  cert({
    id: "MC-2026-0005", reference: "MC-2026-0005", patientId: "R-2103", patient: "Elena Garcia", age: 25, sex: "Female",
    barangay: "San Isidro", address: "Purok 1, San Isidro", purpose: "General Medical Certificate",
    findings: "Prenatal assessment; no complications noted.",
    dateOfExamination: "2026-09-12", status: "Draft", preparedBy: "Antonio Reyes", preparedByRole: "RHU Personnel",
    createdAt: "2026-09-12T08:45:00.000Z",
  }),
];

const cloneSeed = () => SEED.map((c) => ({ ...c, audit: c.audit.map((a) => ({ ...a })) }));

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
const getCertificates = () => read().map((c) => ({ ...c, audit: c.audit.map((a) => ({ ...a })) }));

const updateRecord = (id, patch) => {
  cache = read().map((c) => (c.id === id ? { ...c, ...patch } : c));
  emit();
};

const appendAudit = (record, action, by, notes) => [
  ...(record.audit || []),
  { action, by: by || "—", at: new Date().toISOString(), notes: notes || "" },
];

/** Create a certificate (Draft) from a patient snapshot. */
const createCertificate = (payload) => {
  const list = read();
  const year = new Date().getFullYear();
  const max = list.reduce((acc, c) => {
    const m = String(c.id || "").match(/MC-(\d{4})-(\d+)/);
    return m && Number(m[1]) === year ? Math.max(acc, parseInt(m[2], 10)) : acc;
  }, 0);
  const seq = max + 1;
  const id = `MC-${year}-${String(seq).padStart(4, "0")}`;
  const record = cert({
    ...payload,
    id,
    reference: id,
    status: payload.status || "Draft",
  });
  cache = [record, ...list];
  emit();
  return record;
};

/**
 * Transition a certificate's status with an audit entry.
 * MHO-only decisions (approve/issue/reject/cancel) are enforced by the UI;
 * the store records whatever the authorized caller performs.
 */
const setStatus = (id, status, { by = "", notes = "" } = {}) => {
  const rec = read().find((c) => c.id === id);
  if (!rec) return null;
  const patch = {
    status,
    audit: appendAudit(rec, status, by, notes),
    notes: notes !== "" ? notes : rec.notes,
  };
  if (status === "Issued") {
    patch.dateIssued = todayIso();
  }
  if ((status === "Approved" || status === "Issued") && !rec.medicalOfficer) {
    patch.medicalOfficer = by;
  }
  updateRecord(id, patch);
  return getCertificates().find((c) => c.id === id);
};

/** Submit a draft for MHO review. */
const submitForReview = (id, { by = "" } = {}) => setStatus(id, "For Review", { by });

/** MHO decisions. */
const approveCertificate = (id, { by = "", notes = "" } = {}) => setStatus(id, "Approved", { by, notes });
const issueCertificate = (id, { by = "", notes = "" } = {}) => setStatus(id, "Issued", { by, notes });
const rejectCertificate = (id, { by = "", notes = "" } = {}) => setStatus(id, "Rejected", { by, notes });
const cancelCertificate = (id, { by = "", notes = "" } = {}) => setStatus(id, "Cancelled", { by, notes });

/**
 * Update an existing certificate's document fields (composer edit/re-print).
 * The audit trail and status workflow are untouched by this update.
 */
const updateCertificate = (id, payload) => {
  const rec = read().find((c) => c.id === id);
  if (!rec) return null;
  updateRecord(id, { ...payload, id });
  return getCertificates().find((c) => c.id === id);
};

/** Next MC-YYYY-#### reference (used to prefill the certificate number). */
const nextReference = () => {
  const year = new Date().getFullYear();
  const max = read().reduce((acc, c) => {
    const m = String(c.id || "").match(/MC-(\d{4})-(\d+)/);
    return m && Number(m[1]) === year ? Math.max(acc, parseInt(m[2], 10)) : acc;
  }, 0);
  return `MC-${year}-${String(max + 1).padStart(4, "0")}`;
};

export const useMedicalCertificates = () => useSyncExternalStore(subscribe, getSnapshot);

export const medicalCertificateStore = {
  getCertificates,
  getSnapshot,
  subscribe,
  createCertificate,
  updateCertificate,
  submitForReview,
  approveCertificate,
  issueCertificate,
  rejectCertificate,
  cancelCertificate,
  nextReference,
  statuses: CERT_STATUSES,
  purposes: CERT_PURPOSES,
};

export default medicalCertificateStore;
