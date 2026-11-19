/**
 * Household risk-cluster workflow service (BUG-009).
 *
 * Architectural layer:
 *   route -> authenticate -> authorize -> households.controller
 *         -> householdRiskWorkflow.service -> households.service / Supabase
 *
 * Persists the follow-up / assignment / escalation / resolution workflow for a
 * household's risk cluster in PostgreSQL (`public.household_risk_workflow`), so
 * it survives refresh/logout/device changes instead of living in sessionStorage.
 *
 * Scope is enforced by delegating to `households.service.getHousehold()`, which
 * returns 404 for any household outside the caller's municipality/barangay, and
 * independently by the table's RLS. Worker assignments are validated against the
 * household's barangay directory via `resolveHouseholdWorker`. Ownership/scope
 * is never taken from a client id.
 */
import ApiError from '../utils/apiError.js';
import { getServiceClient } from '../config/supabase.js';
import { assignedBarangay, BARANGAY_SCOPED_ROLES } from '../config/scope.js';
import { getHousehold, resolveHouseholdWorker } from './households.service.js';

const TABLE = 'household_risk_workflow';

const WRITE_ROLES = new Set(['bhw', 'health_supervisor', 'phn', 'admin']);
export const RISK_CLUSTER_LEVELS = Object.freeze(['priority', 'intervention', 'monitor', 'stable']);

const normalizeRiskClusterLevel = (level) => {
  if (typeof level !== 'string') return null;
  const normalized = level.trim().toLowerCase();
  return RISK_CLUSTER_LEVELS.includes(normalized) ? normalized : null;
};

const throwOnError = (error, message) => {
  if (error) throw Object.assign(new Error(error.message || message), { statusCode: 500, details: error });
};

const throwOnClusterSchemaError = (error) => {
  if (!error) return;
  const detail = String(error.message || '');
  if (/risk_cluster_level|household_risk_workflow|relationship.*household_risk_workflow/i.test(detail)) {
    throw Object.assign(
      new Error('Household cluster storage is unavailable. Apply migration 20261119050000_household_cluster_assignment.sql and reload the API schema.'),
      { statusCode: 503, code: 'HOUSEHOLD_CLUSTER_SCHEMA_REQUIRED', details: error },
    );
  }
  throwOnError(error, 'Could not load household cluster summary');
};

/** Map a `public.household_risk_workflow` row to the camelCase API response DTO. */
const shape = (row) => ({
  householdId: row.household_id,
  riskClusterLevel: normalizeRiskClusterLevel(row.risk_cluster_level),
  workflowStatus: row.workflow_status,
  assignedWorker: row.assigned_worker_name || row.assigned_worker || '',
  assignedWorkerId: row.assigned_worker_id || null,
  assignedWorkerRole: row.assigned_worker_role,
  assignmentAt: row.assignment_at,
  escalation: row.escalation || {},
  followUpCount: row.follow_up_count,
  lastFollowUpAt: row.last_follow_up_at,
  lastNote: row.last_note,
  history: row.history || [],
  updatedAt: row.updated_at,
});

/**
 * Read the risk-cluster workflow for a household (`id`) after verifying that the
 * household is within the caller's municipality/barangay scope (404 otherwise).
 * Returns `null` when no workflow row has been recorded yet.
 */
export const getWorkflow = async ({ id, user, supabase = getServiceClient(), scopeCheck = getHousehold }) => {
  await scopeCheck({ id, user }); // 404 if the household is out of scope
  const { data, error } = await supabase.from(TABLE).select('*').eq('household_id', id).maybeSingle();
  throwOnError(error, 'Could not load the household risk workflow');
  return data ? shape(data) : null;
};

/**
 * Upsert the risk-cluster workflow for a household (`public.household_risk_workflow`
 * keyed on `household_id`).
 *
 * Enforces `WRITE_ROLES` (`bhw`, `health_supervisor`, `phn`, `admin`) and
 * household scope (`scopeCheck`). `patch` may supply any subset of:
 *   `workflowStatus`, `assignedWorkerId` (or `assignedWorker`), `assignmentAt`,
 *   `escalation`, `followUpCount` (clamped >= 0), `lastFollowUpAt`, `lastNote`, `history`.
 * When a worker ID is provided, `resolveHouseholdWorker` verifies the worker is
 * active and eligible for `household.barangayId` and populates name + role from
 * the authoritative profile; an empty worker clears the assignment.
 */
export const saveWorkflow = async ({ id, user, patch = {}, supabase = getServiceClient(), scopeCheck = getHousehold }) => {
  if (!WRITE_ROLES.has(user?.role)) {
    throw ApiError.forbidden('You are not authorized to update the household risk workflow.');
  }
  const household = await scopeCheck({ id, user }); // 404 if the household is out of scope
  const row = { household_id: id, updated_by: user.id, updated_at: new Date().toISOString() };
  if (patch.riskClusterLevel !== undefined) {
    if (patch.riskClusterLevel === null || patch.riskClusterLevel === '') {
      row.risk_cluster_level = null;
    } else {
      const level = normalizeRiskClusterLevel(patch.riskClusterLevel);
      if (!level) throw ApiError.unprocessable('Select a valid household cluster level.');
      row.risk_cluster_level = level;
    }
  }
  if (patch.workflowStatus !== undefined) row.workflow_status = String(patch.workflowStatus);
  if (patch.assignedWorkerId !== undefined || patch.assignedWorker !== undefined) {
    const workerId = String(patch.assignedWorkerId ?? patch.assignedWorker ?? '').trim();
    if (workerId) {
      if (!household?.barangayId) throw ApiError.unprocessable('Record the household barangay before assigning a worker.');
      const worker = await resolveHouseholdWorker({ user, workerId, barangayId: household.barangayId, supabase });
      row.assigned_worker_id = worker.id;
      row.assigned_worker_name = worker.name;
      row.assigned_worker = worker.name;
      row.assigned_worker_role = worker.role;
    } else {
      row.assigned_worker_id = null;
      row.assigned_worker_name = '';
      row.assigned_worker = '';
      row.assigned_worker_role = '';
    }
  }
  if (patch.assignmentAt !== undefined) row.assignment_at = patch.assignmentAt;
  if (patch.escalation !== undefined) row.escalation = patch.escalation || {};
  if (patch.followUpCount !== undefined) row.follow_up_count = Math.max(0, Number(patch.followUpCount) || 0);
  if (patch.lastFollowUpAt !== undefined) row.last_follow_up_at = patch.lastFollowUpAt || null;
  if (patch.lastNote !== undefined) row.last_note = String(patch.lastNote || '');
  if (patch.history !== undefined) row.history = Array.isArray(patch.history) ? patch.history : [];

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'household_id' })
    .select('*')
    .single();
  throwOnError(error, 'Could not save the household risk workflow');
  return shape(data);
};

/**
 * Return the household cluster distribution for the authenticated geographic
 * scope. Household environmental risk is deliberately not used as a fallback.
 */
export const getRiskClusterSummary = async ({ user, supabase = getServiceClient() }) => {
  if (!user?.municipalityId) throw ApiError.forbidden('A municipality assignment is required to view household clusters.');
  const barangayScoped = BARANGAY_SCOPED_ROLES.includes(user.role);
  const barangay = barangayScoped ? assignedBarangay(user) : null;
  if (barangayScoped && !barangay) {
    throw ApiError.forbidden('A barangay assignment is required to view household clusters.');
  }

  const pageSize = 500;
  const counts = Object.fromEntries(RISK_CLUSTER_LEVELS.map((level) => [level, 0]));
  let totalHouseholds = null;
  let scannedHouseholds = 0;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from('households')
      .select('id, risk_workflow:household_risk_workflow(risk_cluster_level)', { count: 'exact' })
      .eq('municipality_id', user.municipalityId);
    if (barangayScoped) query = query.eq('barangay', barangay);
    query = query.order('id', { ascending: true });
    const { data, error, count } = await query.range(offset, offset + pageSize - 1);
    throwOnClusterSchemaError(error);
    if (!Array.isArray(data)) {
      throw Object.assign(new Error('Could not load household cluster summary: invalid page response'), { statusCode: 500 });
    }
    if (offset === 0) {
      if (!Number.isInteger(count) || count < data.length) {
        throw Object.assign(new Error('Could not load household cluster summary: exact household count is unavailable'), { statusCode: 500 });
      }
      totalHouseholds = count;
    }
    scannedHouseholds += data.length;

    for (const household of data) {
      const embedded = household.risk_workflow;
      const workflow = Array.isArray(embedded) ? embedded[0] : embedded;
      const level = normalizeRiskClusterLevel(workflow?.risk_cluster_level);
      if (level) counts[level] += 1;
    }
    if (data.length < pageSize) break;
  }

  if (scannedHouseholds !== totalHouseholds) {
    throw Object.assign(new Error('Could not load household cluster summary: paginated household count changed or was incomplete'), { statusCode: 500 });
  }

  const classifiedHouseholds = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    totalHouseholds,
    classifiedHouseholds,
    riskDistribution: [
      ...RISK_CLUSTER_LEVELS.map((level) => ({ name: level, value: counts[level] })),
      { name: 'unassessed', value: totalHouseholds - classifiedHouseholds },
    ],
  };
};

export default { getWorkflow, saveWorkflow, getRiskClusterSummary };
