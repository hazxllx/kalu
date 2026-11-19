/**
 * Resident registration and account activation controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> [authenticate / rateLimit] -> registration.controller -> registration.service -> repository/Supabase`
 *
 * Handles two onboarding workflows:
 * 1. New resident registration (resident self-service or staff-initiated intake).
 * 2. Existing resident account activation (invitations or linking a login to an
 *    existing barangay health record after date-of-birth verification).
 *
 * Authorization, barangay scoping, and identity verification rules are enforced
 * in `registration.service`.
 */
import * as registrationService from '../services/registration.service.js';
import { sendCreated, sendData } from '../utils/apiResponse.js';

/**
 * Handles `POST /register` — registers a new resident profile from `req.body.resident`
 * (or `req.body`), associating `req.user` when authenticated (self-service or staff).
 * Delegates to `registrationService.registerResident()` and responds with `201 Created`
 * (`sendCreated`) containing `{ resident }`.
 *
 * @param {Object} req - Express request with resident registration fields in `body`.
 * @param {Object} res - Express response.
 */
export const registerResident = async (req, res) => {
  const resident = await registrationService.registerResident({
    user: req.user,
    payload: req.body?.resident || req.body || {},
  });
  sendCreated(res, { resident });
};

/**
 * Handles `POST /activate` — resident self-service endpoint that activates the
 * caller's account after accepting an email invitation link and setting a password.
 * Resident identity is derived strictly from `req.user` via `registrationService.activateOwnAccount()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with authenticated resident `user`.
 * @param {Object} res - Express response.
 */
export const activateAccount = async (req, res) => {
  const result = await registrationService.activateOwnAccount({ user: req.user });
  sendData(res, result);
};

/**
 * Handles `POST /existing/lookup` — public lookup step for the "I already have a
 * barangay health record" activation flow. Checks `req.body.residentId` via
 * `registrationService.lookupExistingResident()` and returns only an eligibility
 * state without exposing personal health details. Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with `{ residentId }` in `body`.
 * @param {Object} res - Express response.
 */
export const lookupExistingResident = async (req, res) => {
  const result = await registrationService.lookupExistingResident({
    residentId: req.body?.residentId,
  });
  sendData(res, result);
};

/**
 * Handles `POST /existing/activate` — links the authenticated `req.user` login to an
 * existing barangay resident record (`req.body.residentId`) after server-side identity
 * verification against `req.body.birthDate` via `registrationService.activateExistingResident()`.
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with authenticated `user` and `{ residentId, birthDate }` in `body`.
 * @param {Object} res - Express response.
 */
export const activateExistingResident = async (req, res) => {
  const result = await registrationService.activateExistingResident({
    user: req.user,
    residentId: req.body?.residentId,
    birthDate: req.body?.birthDate,
  });
  sendData(res, result);
};

export default { registerResident, activateAccount, lookupExistingResident, activateExistingResident };
