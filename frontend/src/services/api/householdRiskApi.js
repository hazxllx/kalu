// frontend/src/services/api/householdRiskApi.js
import { api } from "./apiClient";
import { RISK_LEVELS } from "../../lib/householdRisk.js";

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
  getClusterSummary: async () => {
    const payload = await api.get('/households/risk-clusters/summary');
    const levels = Object.values(RISK_LEVELS);
    const counts = payload?.riskDistribution;
    const valid = Number.isSafeInteger(payload?.totalHouseholds) && payload.totalHouseholds >= 0
      && Number.isSafeInteger(payload.classifiedHouseholds) && payload.classifiedHouseholds >= 0
      && Array.isArray(counts) && counts.length === levels.length
      && new Set(counts.map((row) => row?.name)).size === levels.length
      && counts.every((row) => levels.includes(row?.name) && Number.isSafeInteger(row.value) && row.value >= 0)
      && counts.reduce((sum, row) => sum + row.value, 0) === payload.totalHouseholds
      && counts.filter((row) => row.name !== RISK_LEVELS.UNASSESSED).reduce((sum, row) => sum + row.value, 0) === payload.classifiedHouseholds;
    if (!valid) throw new Error('Household cluster distribution is unavailable or incomplete.');
    return payload;
  },
};

export default householdRiskApi;
