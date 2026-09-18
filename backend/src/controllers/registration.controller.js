import * as registrationService from '../services/registration.service.js';
import { sendCreated } from '../utils/apiResponse.js';

export const registerResident = async (req, res) => {
  const resident = await registrationService.registerResident({
    user: req.user,
    payload: req.body?.resident || req.body || {},
  });
  sendCreated(res, { resident });
};

export default { registerResident };
