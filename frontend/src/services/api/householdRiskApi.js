import { api } from "./apiClient";

/**
 * Household risk-cluster workflow API (BUG-009).
 *
 * Persists follow-up / assignment / escalation / resolution to PostgreSQL
 * (public.household_risk_workflow via /households/:id/risk-workflow), scope
 * enforced server-side. sessionStorage is no longer the source of truth.
 */
export const householdRiskApi = {
  getWorkflow: async (householdId) => {
    const payload = await api.get(`/households/${householdId}/risk-workflow`);
    return payload?.workflow || null;
  },
  saveWorkflow: async (householdId, workflow) => {
    const payload = await api.put(`/households/${householdId}/risk-workflow`, { workflow });
    return payload?.workflow || null;
  },
};

export default householdRiskApi;
