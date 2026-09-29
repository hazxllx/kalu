import { api } from "./apiClient";
import { mapVisitsToPatients, splitWalkInName, triageToVisitPayload } from "@/lib/phnWorkflowMap";

/**
 * PHN clinical workflow API (BUG-008).
 *
 * Backs the RHU triage → PHN queue → check-up → completion pipeline with the
 * existing persistent Express/Supabase endpoints (`/intake` + `/phn`, the
 * `visits` table) instead of a browser-only localStorage snapshot. All scope
 * (municipality/barangay), ownership and role rules are enforced server-side.
 */
export const phnWorkflowApi = {
  /** PHN queue — every submission routed to the PHN (municipality-scoped). */
  listQueue: async () => {
    const payload = await api.get("/phn/submissions");
    return mapVisitsToPatients(payload?.submissions || []);
  },

  /** The caller's own intake submissions (RHU personnel / BHW view). */
  listMyIntake: async () => {
    const payload = await api.get("/intake/visits");
    return mapVisitsToPatients(payload?.submissions || []);
  },

  /**
   * RHU triage hand-off: create the visit (existing resident or new walk-in)
   * then SUBMIT it, which persists the record and transfers it to the PHN
   * queue. Returns the created submission id.
   */
  sendToPhnQueue: async (payload) => {
    const visit = triageToVisitPayload(payload);
    const body = payload.residentId
      ? { residentId: payload.residentId, visit }
      : {
          resident: {
            ...splitWalkInName(payload.patient),
            sex: payload.sex || "",
            barangay: payload.barangay || "",
          },
          visit,
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
      phn: {
        assessment: recorded.healthConcern || recorded.assessment || "",
        notes: recorded.clinicalNotes || "",
      },
    };
    await api.put(`/phn/submissions/${id}`, { submission: patch });
    const payload = await api.post(`/phn/submissions/${id}/complete`);
    return payload?.submission;
  },
};

export default phnWorkflowApi;
