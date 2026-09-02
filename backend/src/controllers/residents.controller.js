/**
 * Resident record endpoints for authorized health staff.
 */
import * as residentsService from '../services/residents.service.js';
import { sendData } from '../utils/apiResponse.js';

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

export default { getResident, updateResident };
