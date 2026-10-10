/**
 * Blood-pressure threshold configuration endpoints.
 *
 *   GET /bp-config              active thresholds + category labels (clinical read)
 *   PUT /bp-config/thresholds   update the numeric cut-offs (admin)
 *
 * Classification is screening guidance, not a diagnosis. The thresholds are
 * read by the consultation form to classify a reading; writes are admin-only
 * (route authorize list + service guard) and audited.
 */
import * as bpConfig from '../services/bpConfig.service.js';
import { sendData } from '../utils/apiResponse.js';

export const getConfig = async (req, res) => {
  const config = await bpConfig.getBpConfig();
  sendData(res, config);
};

export const updateThresholds = async (req, res) => {
  const config = await bpConfig.updateThresholds({ user: req.user, payload: req.body || {} });
  sendData(res, config);
};

export default { getConfig, updateThresholds };
