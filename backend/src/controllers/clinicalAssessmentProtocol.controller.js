// backend/src/controllers/clinicalAssessmentProtocol.controller.js
import { sendData } from '../utils/apiResponse.js';
import { approveClinicalAssessmentProtocol } from '../services/clinicalAssessmentProtocol.service.js';

export const approve = async (req, res) => {
  const protocol = await approveClinicalAssessmentProtocol({ user: req.user, payload: req.body || {} });
  sendData(res, { protocol });
};
