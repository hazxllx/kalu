// frontend/src/services/api/phnWorkflow.js
import { api } from "./apiClient";
import { mapVisitToPatient, mapVisitsToPatients, splitWalkInName, triageToVisitPayload } from "@/lib/phnWorkflowMap";
import { cacheRecord, listCachedRecords } from "@/services/offline/records";
import { queueOfflineDraft } from "@/services/offline/queue";
import { listDrafts } from "@/services/offline/drafts";
import { classifySyncError, SYNC_ERROR } from "@/services/offline/errors";

const queuePatients = (payload, endpoint) => {
  if (!Array.isArray(payload?.submissions)) {
    throw new Error(`${endpoint} returned an invalid submission list. The queue could not be verified.`);
  }
  const patients = mapVisitsToPatients(payload.submissions);
  if (patients.length !== payload.submissions.length) {
    throw new Error(`${endpoint} returned unsupported workflow statuses. The queue could not be verified.`);
  }
  return patients;
};

/**
 * PHN clinical workflow API (BUG-008).
 *
 * Backs the RHU triage → PHN queue → check-up → completion pipeline with the
 * existing persistent Express/Supabase endpoints (`/intake` + `/phn`, the
 * `visits` table) instead of a browser-only localStorage snapshot. All scope
 * (municipality/barangay), ownership and role rules are enforced server-side.
 */
export const phnWorkflowApi = {
  /** Active health-service options visible to the consultation station only. */
  listConsultationHealthServices: async () => {
    const payload = await api.get("/phn/consultation-services");
    if (!Array.isArray(payload?.services)) {
      throw new Error("The consultation health-service response was invalid.");
    }
    return payload.services;
  },

  /** PHN queue — every submission routed to the PHN (municipality-scoped). */
  listQueue: async (options = {}) => {
    const payload = await api.get("/phn/submissions", options);
    return queuePatients(payload, "GET /phn/submissions");
  },
  getCheckup: async (id, residentId) => {
    const payload = await api.get(`/phn/submissions/${id}/consultation`);
    const record = payload?.submission;
    if (record?.id !== id || !residentId || record.residentId !== residentId) {
      throw new Error("The consultation record does not match the selected patient. Refresh the queue before continuing.");
    }
    const patient = mapVisitToPatient(record);
    if (!patient) throw new Error("This encounter is not available for consultation.");
    return patient;
  },
  listQueueOffline: async (ownerId) => {
    if (!ownerId) throw new Error("A signed-in user is required.");
    let patients = null;
    let networkError = null;
    try {
      patients = await phnWorkflowApi.listQueue({ ownerId });
    } catch (error) {
      if (classifySyncError(error).code !== SYNC_ERROR.NETWORK) throw error;
      networkError = error;
    }
    if (patients) {
      // Best-effort cache: a storage/migration failure must never hide the
      // successfully fetched queue or turn it into a spurious server error.
      try {
        await Promise.all(
          patients.map((patient) =>
            cacheRecord({
              entity: "phnQueueVisit",
              remoteId: patient.id,
              ownerId,
              data: patient,
            }),
          ),
        );
      } catch (cacheError) {
        if (classifySyncError(cacheError).code === SYNC_ERROR.AUTH) throw cacheError;
        console.warn("[phnWorkflow] device cache unavailable; live queue was retrieved.");
      }
      return patients;
    }
    // Network failure — fall back to cached data; a cache read failure is
    // surfaced as a storage error, not a server error, and never masks the
    // original network cause when the cache is empty.
    try {
      const cached = await listCachedRecords(ownerId, "phnQueueVisit");
      const rows = cached.map((row) => row.data);
      if (rows.length > 0) return rows;
      throw networkError || new Error("No cached PHN queue available offline.");
    } catch (cacheError) {
      if (networkError && cacheError === networkError) throw networkError;
      // If cache read itself failed (e.g. storage/migration error), surface it
      // distinctly so the UI does not misreport it as a server failure.
      console.warn("[phnWorkflow] cache read failed", cacheError);
      throw cacheError?.code ? cacheError : networkError || cacheError;
    }
  },

  /** The caller's own intake submissions (RHU personnel / BHW view). */
  listMyIntake: async (options = {}) => {
    const payload = await api.get("/intake/visits", options);
    // Drafts are valid in the intake editor, but never in the PHN queue.
    if (!Array.isArray(payload?.submissions)) throw new Error('GET /intake/visits returned an invalid submission list.');
    return mapVisitsToPatients(payload.submissions);
  },

  listMyIntakeOffline: async (ownerId) => {
    if (!ownerId) throw new Error("A signed-in user is required.");
    let patients = null;
    let networkError = null;
    try {
      patients = await phnWorkflowApi.listMyIntake({ ownerId });
    } catch (error) {
      if (classifySyncError(error).code !== SYNC_ERROR.NETWORK) throw error;
      networkError = error;
    }
    if (patients) {
      try {
        await Promise.all(
          patients.map((patient) =>
            cacheRecord({
              entity: "rhuIntakeVisit",
              remoteId: patient.id,
              ownerId,
              data: patient,
            }),
          ),
        );
      } catch (cacheError) {
        if (classifySyncError(cacheError).code === SYNC_ERROR.AUTH) throw cacheError;
        console.warn("[phnWorkflow] device cache unavailable; live intake was retrieved.");
      }
      const drafts = await listDrafts(ownerId, "rhuTriage");
      return [
        ...drafts
          .filter((draft) => draft.status !== "synced")
          .map((draft) => ({
            ...draft.data,
            id: draft.localId,
            status: "Saved Offline",
            offline: true,
            syncStatus: "Saved Offline",
          })),
        ...patients,
      ];
    }
    // Offline path: cached rows + local drafts. Cache failures are isolated.
    let cached = [];
    try {
      cached = (await listCachedRecords(ownerId, "rhuIntakeVisit")).map((row) => row.data);
    } catch (cacheError) {
      console.warn("[phnWorkflow] cache read failed", cacheError);
      if (!networkError) throw cacheError;
      cached = [];
    }
    const drafts = await listDrafts(ownerId, "rhuTriage");
    return [
      ...drafts.filter((draft) => draft.status !== "synced").map((draft) => ({
        ...draft.data,
        id: draft.localId,
        status: "Saved Offline",
        offline: true,
        syncStatus: "Saved Offline",
      })),
      ...cached,
    ];
  },

  saveTriageDraft: async (ownerId, payload) => {
    if (!ownerId) throw new Error("A signed-in user is required.");
    const result = await queueOfflineDraft({
      entity: "rhuTriage",
      ownerId,
      data: payload,
    });
    return {
      ...payload,
      id: result.localId,
      status: "Saved Offline",
      offline: true,
      syncStatus: "Saved Offline",
    };
  },

  /**
   * RHU triage hand-off is one atomic, replayable database operation.
   */
  sendToPhnQueue: async (payload) => {
    if (!payload.clientSubmissionId) throw new Error("The submission identity is missing. Reopen the triage form before saving.");
    const visit = triageToVisitPayload(payload);
    // When the patient arrived via a barangay referral, the referral is
    // authoritative for identity + is linked to this encounter server-side.
    const referralId = payload.referralId || null;
    const body = payload.residentId
      ? { residentId: payload.residentId, visit, referralId }
      : {
          resident: {
            ...splitWalkInName(payload.patient),
            age: payload.age,
            sex: payload.sex || "",
            barangay: payload.barangay || "",
          },
          visit,
          referralId,
        };
    const created = await api.post("/intake/visits", {
      ...body,
      submit: true,
      clientSubmissionId: payload.clientSubmissionId,
    });
    const id = created?.submission?.id;
    if (!id || !["submitted", "received", "in_review", "referred", "completed"].includes(created.submission.status)) {
      throw new Error("The saved triage handoff could not be confirmed. Your entries are preserved; retry to verify it.");
    }
    if (payload.residentId && created.submission.residentId !== payload.residentId) {
      throw new Error("The saved encounter does not match the selected patient. Reload the record before continuing.");
    }
    return { confirmed: true, id };
  },

  /** PHN starts the check-up: move the submission into review. */
  startCheckup: async (id) => {
    const payload = await api.post(`/phn/submissions/${id}/review`);
    return payload?.submission;
  },

  /**
   * Save clinician-entered outputs and complete this encounter atomically.
   */
  completeCheckup: async (id, recorded = {}) => {
    const patch = {
      findings: recorded.assessment || "",
      diagnosis: recorded.diagnosis || "",
      treatmentGiven: recorded.recommendations || "",
      recommendation: recorded.recommendations || "",
      // The workbench captures an optional health-service association; forward
      // it verbatim so the backend persists visits.health_service_id. When the
      // field is genuinely absent we leave it untouched rather than clearing an
      // association the submission already carried.
      ...(recorded.healthServiceId === undefined ? {} : { healthServiceId: recorded.healthServiceId || null }),
      ...(recorded.dangerSignsReviewed === undefined ? {} : {
        consultationDetails: { clinicalIndicators: { dangerSignsReviewed: recorded.dangerSignsReviewed === true } },
      }),
      // Structured prescriptions recorded in the workbench's MedicineSelector.
      // Forwarded verbatim (never renamed/dropped) so the backend persists them
      // to visits.medications; an empty array clears nothing it did not set.
      medications: Array.isArray(recorded.medications) ? recorded.medications : [],
      ...(recorded.consultationVitals && typeof recorded.consultationVitals === "object"
        ? { consultationVitals: recorded.consultationVitals }
        : {}),
      ...(recorded.expectedUpdatedAt ? { expectedUpdatedAt: recorded.expectedUpdatedAt } : {}),
      phn: {
        assessment: recorded.healthConcern || recorded.assessment || "",
        notes: recorded.clinicalNotes || "",
        // The consultation personnel is stamped server-side from the authenticated
        // user; it is never sent from the client.
      },
    };
    const payload = await api.post(`/phn/submissions/${id}/complete`, { submission: patch });
    if (payload?.submission?.id !== id || payload.submission.status !== 'completed') {
      throw new Error('The consultation save could not be confirmed. Your entries are preserved; retry using the same form.');
    }
    return payload.submission;
  },

  routeToConsultation: async (id, facilityId = null) => {
    const payload = await api.post(`/phn/submissions/${id}/route-consultation`, facilityId ? { facility_id: facilityId } : {});
    if (payload?.submission?.id !== id || !payload.submission.consultationRoutedAt) {
      throw new Error('The RHU Consultation hand-off could not be confirmed. Refresh the PHN queue and retry.');
    }
    return payload.submission;
  },

  listConsultationFacilities: async () => {
    const payload = await api.get('/phn/consultation-facilities');
    if (!Array.isArray(payload?.facilities)) throw new Error('The RHU facility list could not be verified.');
    return payload.facilities;
  },
};

export default phnWorkflowApi;
