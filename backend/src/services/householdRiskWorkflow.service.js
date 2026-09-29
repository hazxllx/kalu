/**
 * Household risk-cluster workflow service (BUG-009).
 *
 * Persists the follow-up / assignment / escalation / resolution workflow for a
 * household's risk cluster in PostgreSQL (public.household_risk_workflow), so it
 * survives refresh/logout/device changes instead of living in sessionStorage.
 *
 * Scope is enforced by delegating to households.service.getHousehold(), which
 * returns 404 for any household outside the caller's municipality/barangay, and
 * independently by the table's RLS. Ownership/scope is never taken from a client
 * id.
 */
import ApiError from '../utils/apiError.js';
import { getServiceClient } from '../config/supabase.js';
import { getHousehold } from './households.service.js';

const TABLE = 'household_risk_workflow';

const WRITE_ROLES = new Set(['bhw', 'health_supervisor', 'phn', 'admin']);

const throwOnError = (error, message) => {
  if (error) throw Object.assign(new Error(error.message || message), { statusCode: 500, details: error });
};

const shape = (row) => ({
  householdId: row.household_id,
  workflowStatus: row.workflow_status,
  assignedWorker: row.assigned_worker,
  assignedWorkerRole: row.assigned_worker_role,
  assignmentAt: row.assignment_at,
  escalation: row.escalation || {},
  followUpCount: row.follow_up_count,
  lastFollowUpAt: row.last_follow_up_at,
  lastNote: row.last_note,
  history: row.history || [],
  updatedAt: row.updated_at,
});

/** Read the workflow for a household (scope-checked). Returns null if unset. */
export const getWorkflow = async ({ id, user, supabase = getServiceClient(), scopeCheck = getHousehold }) => {
  await scopeCheck({ id, user }); // 404 if the household is out of scope
  const { data, error } = await supabase.from(TABLE).select('*').eq('household_id', id).maybeSingle();
  throwOnError(error, 'Could not load the household risk workflow');
  return data ? shape(data) : null;
};

/**
 * Upsert the workflow for a household. `patch` may carry any of:
 *   workflowStatus, assignedWorker, assignedWorkerRole, assignmentAt,
 *   escalation, followUpCount, lastFollowUpAt, lastNote, history.
 * Scope + write-role are enforced (service AND RLS).
 */
export const saveWorkflow = async ({ id, user, patch = {}, supabase = getServiceClient(), scopeCheck = getHousehold }) => {
  if (!WRITE_ROLES.has(user?.role)) {
    throw ApiError.forbidden('You are not authorized to update the household risk workflow.');
  }
  await scopeCheck({ id, user }); // 404 if the household is out of scope

  const row = { household_id: id, updated_by: user.id, updated_at: new Date().toISOString() };
  if (patch.workflowStatus !== undefined) row.workflow_status = String(patch.workflowStatus);
  if (patch.assignedWorker !== undefined) row.assigned_worker = String(patch.assignedWorker || '');
  if (patch.assignedWorkerRole !== undefined) row.assigned_worker_role = String(patch.assignedWorkerRole || '');
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

export default { getWorkflow, saveWorkflow };
