/**
 * Risk configuration endpoints.
 *
 *   GET    /risk-config                     active criteria + thresholds (read)
 *   PUT    /risk-config/thresholds          update Low/Moderate/High cutoffs (admin)
 *   POST   /risk-config/criteria            create/update a criterion (admin)
 *   PUT    /risk-config/criteria/:code      update a criterion (admin)
 *   DELETE /risk-config/criteria/:code      remove a criterion (admin)
 *   POST   /risk-config/recalculate         recompute every resident's risk (admin)
 *
 * Writes are admin-only (enforced in the service and by the route authorize
 * list) and audited; every write triggers a resident risk recalculation so the
 * new classification propagates.
 */
import * as riskConfig from '../services/riskConfig.service.js';
import * as residentRisk from '../services/residentRisk.service.js';
import { sendData } from '../utils/apiResponse.js';

export const getConfig = async (req, res) => {
  const config = await riskConfig.getRiskConfig();
  sendData(res, config);
};

export const updateThresholds = async (req, res) => {
  const thresholds = await riskConfig.updateThresholds({ user: req.user, payload: req.body || {} });
  sendData(res, { thresholds });
};

export const upsertCriterion = async (req, res) => {
  const payload = { ...(req.body || {}) };
  if (req.params.code) payload.code = req.params.code;
  const criterion = await riskConfig.upsertCriterion({ user: req.user, payload });
  sendData(res, { criterion });
};

export const deleteCriterion = async (req, res) => {
  const result = await riskConfig.deleteCriterion({ user: req.user, code: req.params.code });
  sendData(res, result);
};

export const recalculate = async (req, res) => {
  // Admin-triggered full recalculation (also runs automatically after any
  // configuration change). Guarded by the admin-only route + service.
  const result = await residentRisk.recalculateAll({});
  sendData(res, result);
};

export default { getConfig, updateThresholds, upsertCriterion, deleteCriterion, recalculate };
