import * as registrationService from '../services/registration.service.js';
import { sendCreated, sendData } from '../utils/apiResponse.js';

export const registerResident = async (req, res) => {
  const resident = await registrationService.registerResident({
    user: req.user,
    payload: req.body?.resident || req.body || {},
  });
  sendCreated(res, { resident });
};

// Resident self-service: activate the account after accepting an invitation
// link and setting a password. Resident is derived from the session.
export const activateAccount = async (req, res) => {
  const result = await registrationService.activateOwnAccount({ user: req.user });
  sendData(res, result);
};

export default { registerResident, activateAccount };
