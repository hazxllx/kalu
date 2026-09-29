import { api } from "./apiClient";

/**
 * MHO municipal submission review API (BUG-010).
 *
 * Persists MHO review decisions to PostgreSQL
 * (public.municipal_submission_reviews via /api/municipal-submissions).
 * Municipality scope and MHO authority are enforced server-side; sessionStorage
 * is no longer the source of truth for review decisions.
 */
export const municipalSubmissionsApi = {
  listReviews: async () => {
    const payload = await api.get("/municipal-submissions/reviews");
    return payload?.reviews || [];
  },
  reviewSubmission: async (payload) => {
    const res = await api.post("/municipal-submissions/reviews", payload);
    return res?.review || null;
  },
};

export default municipalSubmissionsApi;
