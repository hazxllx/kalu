// backend/src/controllers/bpConfig.controller.js
/**
 * Blood-Pressure Threshold Configuration Controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   route -> authenticate -> authorize -> controller -> bpConfig.service -> repository / Supabase
 *
 * Endpoints:
 * - GET /bp-config            — active systolic/diastolic thresholds + category labels (clinical read)
 * - PUT /bp-config/thresholds — update numeric BP cut-offs (admin-only, audited)
 *
 * Classification is clinical screening guidance rather than a standalone diagnosis.
 * Thresholds are read by consultation and intake forms to classify readings consistently,
 * while updates are restricted to administrators at both route and service layers.
 */
import * as bpConfig from '../services/bpConfig.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * GET /api/bp-config
 * Retrieves the active blood-pressure category definitions and numeric cut-offs
 * via `bpConfig.getBpConfig()` and returns `200 OK` via `sendData`.
 */
export const getConfig = async (req, res) => {
  const config = await bpConfig.getBpConfig();
  sendData(res, config);
};

/**
 * PUT /api/bp-config/thresholds
 * Updates the blood-pressure classification thresholds using `req.body` and
 * `req.user` (for admin verification and audit logging) via `bpConfig.updateThresholds`,
 * returning the updated configuration (`200 OK`) via `sendData`.
 */
export const updateThresholds = async (req, res) => {
  const config = await bpConfig.updateThresholds({ user: req.user, payload: req.body || {} });
  sendData(res, config);
};

export default { getConfig, updateThresholds };
