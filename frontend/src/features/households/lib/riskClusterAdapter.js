/**
 * Household risk-cluster adapter.
 *
 * Maps the SERVER household record (GET /households, GET /households/:id) plus
 * its persisted workflow (GET /households/:id/risk-workflow, backed by
 * public.household_risk_workflow) into the display shape the retained Household
 * Risk Overview / Detail pages render.
 *
 * This replaces the obsolete client-only sessionStorage store as the data
 * source (BUG-009). Risk classification comes from the server (risk_level /
 * risk_score / risk_factors, recomputed server-side on every write — never from
 * the client); follow-up / assignment / escalation state comes from the
 * scope-enforced workflow table. No demo/mock/hardcoded households are used, and
 * barangay/municipality scope + role permissions remain enforced by the API and
 * RLS (this module never sends a scope id and cannot widen access).
 */
import { RISK_LEVELS, RISK_CLASSIFICATION_BASIS } from "../../../lib/householdRisk.js";

/**
 * The server risk model is 3-level (Low / Moderate / High); the retained
 * overview UI is 4-level. Map High -> Priority Review, Moderate -> Needs
 * Intervention, Low -> Stable so the "priority households" section surfaces the
 * households that actually need attention.
 */
const SERVER_TO_DISPLAY = {
  High: RISK_LEVELS.PRIORITY,
  Moderate: RISK_LEVELS.INTERVENTION,
  Low: RISK_LEVELS.STABLE,
};

export const mapServerRiskLevel = (level) =>
  SERVER_TO_DISPLAY[level] || RISK_LEVELS.STABLE;

/** Whole days since an ISO date (yyyy-mm-dd), or null when unset/invalid. */
export const daysSince = (iso) => {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
};

const surnameFrom = (headName) => {
  const parts = String(headName || "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
};

const toDateOnly = (value) => (value ? String(value).slice(0, 10) : "");

/**
 * Build the display "risk cluster" record for one household.
 * `household` is the server household record; `workflow` is the persisted
 * workflow row (or null when none has been recorded yet).
 */
export const toRiskCluster = (household = {}, workflow = null) => {
  const level = mapServerRiskLevel(household.riskLevel);
  const factors = Array.isArray(household.riskFactors) ? household.riskFactors : [];
  const indicators = factors.map((f) => ({ key: String(f), label: String(f) }));
  const basis = RISK_CLASSIFICATION_BASIS[level] || RISK_CLASSIFICATION_BASIS[RISK_LEVELS.STABLE];

  const risk = {
    level,
    score: Number(household.riskScore) || 0,
    count: factors.length,
    indicators,
    hasEscalation: false,
    recommendedAction: basis.recommendedResponse,
  };

  const memberCount = Array.isArray(household.members)
    ? household.members.length
    : household.memberCount ?? 0;

  const escalation =
    workflow?.escalation && Object.keys(workflow.escalation).length ? workflow.escalation : null;

  return {
    id: household.id,
    head: household.headName || "",
    surname: surnameFrom(household.headName),
    barangay: household.barangay || "",
    purok: household.purok || "",
    address: household.address || household.streetAddress || "",
    members: memberCount,
    riskLevelRaw: household.riskLevel || "Low",
    risk,
    // Persisted workflow (server-side, survives refresh/logout/device).
    workflowStatus: workflow?.workflowStatus || "",
    assignedWorker: workflow?.assignedWorker || "",
    assignedWorkerRole: workflow?.assignedWorkerRole || "",
    followUpCount: workflow?.followUpCount || 0,
    lastFollowUpAt: toDateOnly(workflow?.lastFollowUpAt),
    lastHouseholdVisit: toDateOnly(workflow?.lastFollowUpAt),
    escalation,
    history: Array.isArray(workflow?.history) ? workflow.history : [],
    lastAssessment: toDateOnly(household.updatedAt),
    lastNote: workflow?.lastNote || "",
  };
};

export default { mapServerRiskLevel, daysSince, toRiskCluster };
