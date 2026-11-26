// frontend/src/features/households/lib/riskClusterAdapter.js
/**
 * Household risk-cluster adapter.
 *
 * Maps the SERVER household record (GET /households, GET /households/:id) plus
 * its persisted workflow (GET /households/:id/risk-workflow, backed by
 * public.household_risk_workflow) into the display shape the retained Household
 * Risk Overview / Detail pages render.
 *
 * This replaces the obsolete client-only sessionStorage store as the data
 * source (BUG-009). Community cluster levels come only from the separate,
 * persisted riskClusterLevel assignment in the scope-enforced workflow table.
 * Environmental risk_level / risk_score / risk_factors remain independent and
 * are displayed separately. No demo/mock/hardcoded households are used, and
 * barangay/municipality scope + role permissions remain enforced by the API and
 * RLS (this module never sends a scope id and cannot widen access).
 */
import {
  RISK_LEVELS, RISK_LEVEL_LABELS,
} from "../../../lib/householdRisk.js";

const LEVEL_BY_LABEL = Object.fromEntries(
  Object.entries(RISK_LEVEL_LABELS).map(([key, label]) => [label.toLowerCase(), key]),
);

/** Normalize only explicit four-tier cluster assignments; unknown stays unassigned. */
export const mapServerRiskLevel = (level) => {
  if (typeof level !== "string") return null;
  const value = level.trim().toLowerCase();
  return Object.values(RISK_LEVELS).includes(value) ? value : LEVEL_BY_LABEL[value] || null;
};

const environmentalLevel = (level) =>
  ["Low", "Moderate", "High"].includes(level) ? level : null;

const toCamelCase = (key) => key.replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());

export const normalizeHouseholdSnapshot = (value) => {
  if (Array.isArray(value)) return value.map(normalizeHouseholdSnapshot);
  if (!value || typeof value !== "object") return value;

  const normalized = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    normalized[key] = normalizeHouseholdSnapshot(nestedValue);
  }
  for (const [key, nestedValue] of Object.entries(normalized)) {
    const camelKey = toCamelCase(key);
    if (camelKey !== key && !Object.hasOwn(normalized, camelKey)) {
      normalized[camelKey] = nestedValue;
    }
  }
  return normalized;
};

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
  const assignment = Object.prototype.hasOwnProperty.call(workflow || {}, 'riskClusterLevel')
    ? workflow.riskClusterLevel : household.riskClusterLevel;
  const level = mapServerRiskLevel(assignment) || RISK_LEVELS.UNASSESSED;
  const environmentalFactors = Array.isArray(household.riskFactors) ? household.riskFactors : [];
  const environmentalScore = household.riskScore == null || household.riskScore === ""
    ? null
    : Number(household.riskScore);

  const risk = {
    level,
    score: null,
    count: 0,
    indicators: [],
    hasEscalation: false,
    recommendedAction: "",
  };

  const memberCount = Array.isArray(household.members)
    ? household.members.length
    : household.memberCount ?? 0;

  const escalation =
    workflow?.escalation && Object.keys(workflow.escalation).length ? workflow.escalation : null;

  return {
    id: household.id,
    assessmentProfile: normalizeHouseholdSnapshot(household),
    assessmentRecords: Array.isArray(household.assessmentRecords) ? household.assessmentRecords : [],
    head: household.headName || "",
    surname: surnameFrom(household.headName),
    barangay: household.barangay || "",
    barangayId: household.barangayId || null,
    purok: household.purok || "",
    address: household.address || household.streetAddress || "",
    members: memberCount,
    indicatorCount: Number.isSafeInteger(household.indicatorCount)
      ? household.indicatorCount
      : (environmentalFactors.length),
    riskClusterLevel: level,
    riskLevelRaw: household.riskLevel ?? null,
    environmentalRisk: {
      level: environmentalLevel(household.riskLevel),
      score: Number.isFinite(environmentalScore) ? environmentalScore : null,
      factors: environmentalFactors.map(String),
    },
    risk,
    // Persisted workflow (server-side, survives refresh/logout/device).
    workflowStatus: workflow?.workflowStatus || "",
    assignedWorker: workflow?.assignedWorker || "",
    assignedWorkerId: workflow?.assignedWorkerId || null,
    assignedWorkerRole: workflow?.assignedWorkerRole || "",
    followUpCount: workflow?.followUpCount || 0,
    lastFollowUpAt: toDateOnly(workflow?.lastFollowUpAt),
    lastHouseholdVisit: toDateOnly(household.lastVisitDate),
    nextScheduledFollowUp: toDateOnly(household.nextFollowUpDate),
    escalation,
    history: Array.isArray(workflow?.history) ? workflow.history.map((entry) => ({
      ...entry,
      level: mapServerRiskLevel(entry.level) || RISK_LEVELS.UNASSESSED,
    })) : [],
    lastAssessment: toDateOnly(household.updatedAt),
    lastNote: workflow?.lastNote || "",
  };
};

/** Read every scoped household page, then load workflow state with bounded concurrency. */
export const loadRiskClusters = async ({
  listHouseholds,
  getWorkflow,
  includeWorkflow = false,
  pageSize = 100,
  concurrency = 8,
} = {}) => {
  const rows = [];
  const ids = new Set();
  let expectedTotal = null;
  for (let offset = 0; ; ) {
    const page = await listHouseholds({ limit: pageSize, offset });
    if (!Array.isArray(page?.rows) || !Number.isInteger(page.total) || page.total < 0) {
      throw new Error("Household list returned an incomplete page or total count.");
    }
    if (expectedTotal === null) expectedTotal = page.total;
    if (page.total !== expectedTotal) throw new Error("Household list total count changed while loading.");
    const pageRows = page.rows;
    if (pageRows.length > pageSize || offset + pageRows.length > page.total) {
      throw new Error("Household list returned an inconsistent page count.");
    }
    for (const row of pageRows) {
      if (!row?.id || ids.has(row.id)) throw new Error("Household list returned a missing or duplicate household ID.");
      ids.add(row.id);
    }
    rows.push(...pageRows);
    offset += pageRows.length;
    if (!pageRows.length && offset < page.total) {
      throw new Error("Household list pagination ended before all rows were returned.");
    }
    if (offset >= page.total) break;
    if (pageRows.length < pageSize) {
      throw new Error("Household list pagination returned a short page before the total count.");
    }
  }
  if (rows.length !== expectedTotal) throw new Error("Household list total count changed while loading.");
  const workflows = new Array(rows.length).fill(null);
  if (includeWorkflow && getWorkflow) {
    let nextIndex = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
      while (nextIndex < rows.length) {
        const index = nextIndex++;
        workflows[index] = await getWorkflow(rows[index].id);
      }
    }));
  }
  return rows.map((row, index) => toRiskCluster(row, workflows[index]));
};

export default { mapServerRiskLevel, normalizeHouseholdSnapshot, daysSince, toRiskCluster, loadRiskClusters };
