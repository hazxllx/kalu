// backend/src/controllers/householdRiskWorkflow.controller.js
/**
 * Household Risk-Cluster Workflow Controller (BUG-009).
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   route -> authenticate -> authorize -> controller -> householdRiskWorkflow.service -> repository / Supabase
 *
 * Endpoints:
 * - GET /households/:id/risk-workflow — read the household risk-cluster workflow (scope-checked)
 * - PUT /households/:id/risk-workflow — upsert follow-up status, BHW/staff assignment, and escalation state
 */
import * as service from '../services/householdRiskWorkflow.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * GET /api/households/:id/risk-workflow
 * Retrieves the current risk-cluster follow-up and escalation workflow state for
 * household `req.params.id`, enforcing barangay/municipality scope for `req.user`
 * in `service.getWorkflow`. Returns `{ workflow }` (`200 OK` via `sendData`).
 */
export const getWorkflow = async (req, res) => {
  const workflow = await service.getWorkflow({ id: req.params.id, user: req.user });
  sendData(res, { workflow });
};

/**
 * PUT /api/households/:id/risk-workflow
 * Upserts follow-up notes, worker assignment, and escalation status (`req.body.workflow`
 * or `req.body`) for household `req.params.id` on behalf of `req.user`.
 * Calls `service.saveWorkflow` and returns `{ workflow }` (`200 OK` via `sendData`).
 */
export const saveWorkflow = async (req, res) => {
  const workflow = await service.saveWorkflow({
    id: req.params.id,
    user: req.user,
    patch: req.body.workflow || req.body || {},
  });
  sendData(res, { workflow });
};

/** Returns aggregate household cluster counts for the caller's assigned scope. */
export const getRiskClusterSummary = async (req, res) => {
  const summary = await service.getRiskClusterSummary({ user: req.user });
  sendData(res, summary);
};

export default { getWorkflow, saveWorkflow, getRiskClusterSummary };
