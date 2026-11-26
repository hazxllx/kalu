// backend/src/controllers/riskConfig.controller.js
/**
 * Community health risk scoring configuration controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> authenticate -> authorize -> riskConfig.controller -> riskConfig.service / residentRisk.service -> repository/Supabase`
 *
 * Endpoints handled:
 *   GET    /risk-config                     active criteria + thresholds (read)
 *   PUT    /risk-config/thresholds          update Low/Moderate/High cutoffs (admin)
 *   POST   /risk-config/criteria            create/update a criterion (admin)
 *   PUT    /risk-config/criteria/:code      update a criterion (admin)
 *   DELETE /risk-config/criteria/:code      remove a criterion (admin)
 *   POST   /risk-config/recalculate         recompute every resident's risk (admin)
 *
 * Writes are admin-only (enforced in the service and by the route `authorize`
 * list) and audited; every write triggers a resident risk recalculation so the
 * new classification propagates across the community directory.
 */
import * as riskConfig from '../services/riskConfig.service.js';
import * as residentRisk from '../services/residentRisk.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * Handles `GET /risk-config` — retrieves the active risk scoring criteria and
 * Low/Moderate/High threshold cutoffs via `riskConfig.getRiskConfig()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 */
export const getConfig = async (req, res) => {
  const config = await riskConfig.getRiskConfig();
  sendData(res, config);
};

/**
 * Handles `PUT /risk-config/thresholds` — updates Low/Moderate/High risk score
 * cutoff thresholds from `req.body` as admin `req.user` via `riskConfig.updateThresholds()`.
 * Responds with `200 OK` (`{ thresholds }`) via `sendData`.
 *
 * @param {Object} req - Express request with threshold cutoffs in `body` and admin `user`.
 * @param {Object} res - Express response.
 */
export const updateThresholds = async (req, res) => {
  const thresholds = await riskConfig.updateThresholds({ user: req.user, payload: req.body || {} });
  sendData(res, { thresholds });
};

/**
 * Handles `POST /risk-config/criteria` and `PUT /risk-config/criteria/:code` —
 * creates or updates a risk scoring criterion from `req.body`, overriding `payload.code`
 * with `req.params.code` when present, via `riskConfig.upsertCriterion()`.
 * Responds with `200 OK` (`{ criterion }`) via `sendData`.
 *
 * @param {Object} req - Express request with optional `params.code`, criterion fields in `body`, and admin `user`.
 * @param {Object} res - Express response.
 */
export const upsertCriterion = async (req, res) => {
  const payload = { ...(req.body || {}) };
  if (req.params.code) payload.code = req.params.code;
  const criterion = await riskConfig.upsertCriterion({ user: req.user, payload });
  sendData(res, { criterion });
};

/**
 * Handles `DELETE /risk-config/criteria/:code` — deletes risk scoring criterion
 * `req.params.code` as admin `req.user` via `riskConfig.deleteCriterion()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with `params.code` and admin `user`.
 * @param {Object} res - Express response.
 */
export const deleteCriterion = async (req, res) => {
  const result = await riskConfig.deleteCriterion({ user: req.user, code: req.params.code });
  sendData(res, result);
};

/**
 * Handles `POST /risk-config/recalculate` — executes an admin-triggered full
 * recomputation of every resident's risk score and risk level classification via
 * `residentRisk.recalculateAll({})`. Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with admin `user`.
 * @param {Object} res - Express response.
 */
export const recalculate = async (req, res) => {
  // Admin-triggered full recalculation (also runs automatically after any
  // configuration change). Guarded by the admin-only route + service.
  const result = await residentRisk.recalculateAll({});
  sendData(res, result);
};

export default { getConfig, updateThresholds, upsertCriterion, deleteCriterion, recalculate };
