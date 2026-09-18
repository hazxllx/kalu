/**
 * Resident record endpoints for authorized health staff.
 */
import * as residentsService from '../services/residents.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

export const listResidents = async (req, res) => {
  const result = await residentsService.listResidents({
    user: req.user,
    q: req.query.q,
    barangay: req.query.barangay,
    limit: req.query.limit,
    offset: req.query.offset,
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

export default { listResidents, createResident, getResident, updateResident };
