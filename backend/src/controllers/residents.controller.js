/**
 * Resident record endpoints for authorized health staff.
 */
import * as residentsService from '../services/residents.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

export const listResidents = async (req, res) => {
  // Verified-only directory: `?verified=true` (or `?status=approved|verified`).
  // The actual verified rule (approved individual verification OR membership of
  // a Verified household) and the barangay/municipality scope are enforced in
  // the service — this only reads the caller's intent.
  const statusParam = String(req.query.status || '').trim().toLowerCase();
  const verifiedOnly =
    req.query.verified === 'true' || statusParam === 'approved' || statusParam === 'verified';
  const result = await residentsService.listResidents({
    user: req.user,
    q: req.query.q,
    barangay: req.query.barangay,
    limit: req.query.limit,
    offset: req.query.offset,
    verifiedOnly,
  });
  sendData(res, result);
};

export const createResident = async (req, res) => {
  const resident = await residentsService.createResident({
    payload: req.body?.resident || req.body || {},
    user: req.user,
  });
  sendCreated(res, { resident });
};

export const getResident = async (req, res) => {
  const resident = await residentsService.getResident({ id: req.params.id, user: req.user });
  sendData(res, { resident });
};

export const updateResident = async (req, res) => {
  const resident = await residentsService.updateResident({
    id: req.params.id,
    patch: req.body.resident || {},
    user: req.user,
  });
  sendData(res, { resident });
};

// Resident self-service: update own profile (contact number). Resident derived
// from the session; no id accepted from the client.
export const updateMyProfile = async (req, res) => {
  const profile = await residentsService.updateOwnProfile({ user: req.user, payload: req.body || {} });
  sendData(res, { profile });
};

// Resident self-service: read own health record (basic profile + own completed
// consultations). Resident is derived from the session; no id is accepted.
export const getMyHealthRecords = async (req, res) => {
  const data = await residentsService.getOwnHealthRecords({ user: req.user });
  sendData(res, data);
};

export default { listResidents, createResident, getResident, updateResident, updateMyProfile, getMyHealthRecords };
