/**
 * Resident registration and account activation endpoints.
 *
 * Handles two registration workflows:
 * 1. New resident registration (self-service or staff-initiated)
 * 2. Existing resident account activation (linking a login to an existing barangay record)
 *
 * Authorization and scope checks are performed in the service layer.
 * All registration forms require identity verification and validation.
 */
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

// Existing-resident activation (simplified "I already have a barangay health
// record" flow). Public lookup returns only an eligibility state; the activate
// step links the authenticated account to the existing record after a
// server-side identity (date-of-birth) check.
export const lookupExistingResident = async (req, res) => {
  const result = await registrationService.lookupExistingResident({
    residentId: req.body?.residentId,
  });
  sendData(res, result);
};

export const activateExistingResident = async (req, res) => {
  const result = await registrationService.activateExistingResident({
    user: req.user,
    residentId: req.body?.residentId,
    birthDate: req.body?.birthDate,
  });
  sendData(res, result);
};

export default { registerResident, activateAccount, lookupExistingResident, activateExistingResident };
