import { api } from "./apiClient";
import { mapVisitsToPatients, splitWalkInName, triageToVisitPayload } from "@/lib/phnWorkflowMap";
import { cacheRecord, listCachedRecords } from "@/services/offline/records";
import { queueOfflineDraft } from "@/services/offline/queue";
import { listDrafts } from "@/services/offline/drafts";
import { classifySyncError, SYNC_ERROR } from "@/services/offline/errors";

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
  listQueue: async () => {
    const payload = await api.get("/phn/submissions");
    return mapVisitsToPatients(payload?.submissions || []);
  },
  listQueueOffline: async (ownerId) => {
    if (!ownerId) throw new Error("A signed-in user is required.");
    let patients = null;
    let networkError = null;
    try {
      patients = await phnWorkflowApi.listQueue();
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
        console.warn("[phnWorkflow] cache write failed, returning live data", cacheError);
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
  listMyIntake: async () => {
    const payload = await api.get("/intake/visits");
    return mapVisitsToPatients(payload?.submissions || []);
  },

  listMyIntakeOffline: async (ownerId) => {
    if (!ownerId) throw new Error("A signed-in user is required.");
    let patients = null;
    let networkError = null;
    try {
      patients = await phnWorkflowApi.listMyIntake();
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
        console.warn("[phnWorkflow] cache write failed, returning live data", cacheError);
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
   * RHU triage hand-off: create the visit (existing resident or new walk-in)
   * then SUBMIT it, which persists the record and transfers it to the PHN
   * queue. Returns the created submission id.
   */
  sendToPhnQueue: async (payload) => {
    const visit = triageToVisitPayload(payload);
    // When the patient arrived via a barangay referral, the referral is
    // authoritative for identity + is linked to this encounter server-side.
    const referralId = payload.referralId || null;
    const body = payload.residentId
      ? { residentId: payload.residentId, visit, referralId }
      : {
          resident: {
            ...splitWalkInName(payload.patient),
            sex: payload.sex || "",
            barangay: payload.barangay || "",
          },
          visit,
          referralId,
        };
    const created = await api.post("/intake/visits", body);
    const id = created?.submission?.id;
    if (!id) throw new Error("Intake submission failed.");
    await api.post(`/intake/visits/${id}/submit`);
    return id;
  },

  /** PHN starts the check-up: move the submission into review. */
  startCheckup: async (id) => {
    const payload = await api.post(`/phn/submissions/${id}/review`);
    return payload?.submission;
  },

  /**
   * PHN completes the check-up: persist findings/treatment/assessment, then
   * transition the visit to completed. `recorded` is the workbench payload.
   */
  completeCheckup: async (id, recorded = {}) => {
    const patch = {
      findings: recorded.assessment || "",
      // The backend requires a non-empty treatment at completion; fall back to
      // the recommendations / clinical notes / health concern the PHN recorded.
      treatmentGiven:
        recorded.recommendations || recorded.clinicalNotes || recorded.healthConcern || "",
      recommendation: recorded.recommendations || "",
      // Structured prescriptions recorded in the workbench's MedicineSelector.
      // Forwarded verbatim (never renamed/dropped) so the backend persists them
      // to visits.medications; an empty array clears nothing it did not set.
      medications: Array.isArray(recorded.medications) ? recorded.medications : [],
      phn: {
        assessment: recorded.healthConcern || recorded.assessment || "",
        notes: recorded.clinicalNotes || "",
        // The consultation personnel is stamped server-side from the authenticated
        // user; it is never sent from the client.
      },
    };
    await api.put(`/phn/submissions/${id}`, { submission: patch });
    const payload = await api.post(`/phn/submissions/${id}/complete`);
    return payload?.submission;
  },
};

export default phnWorkflowApi;
