/**
 * Household risk-cluster workflow endpoints (BUG-009).
 *   GET /households/:id/risk-workflow   read the workflow (scope-checked)
 *   PUT /households/:id/risk-workflow   upsert follow-up/assignment/escalation
 */
import * as service from '../services/householdRiskWorkflow.service.js';
import { sendData } from '../utils/apiResponse.js';

export const getWorkflow = async (req, res) => {
  const workflow = await service.getWorkflow({ id: req.params.id, user: req.user });
  sendData(res, { workflow });
};

export const saveWorkflow = async (req, res) => {
  const workflow = await service.saveWorkflow({
    id: req.params.id,
    user: req.user,
    patch: req.body.workflow || req.body || {},
  });
  sendData(res, { workflow });
};

export default { getWorkflow, saveWorkflow };
