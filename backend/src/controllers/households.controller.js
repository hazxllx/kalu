/**
 * Household Profiling endpoints.
 */
import * as householdsService from '../services/households.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

export const listHouseholds = async (req, res) => {
  const result = await householdsService.listHouseholds({
    user: req.user,
    q: req.query.q,
    barangay: req.query.barangay,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  sendData(res, result);
};

export const getHousehold = async (req, res) => {
  const household = await householdsService.getHousehold({ id: req.params.id, user: req.user });
  sendData(res, { household });
};

export const createHousehold = async (req, res) => {
  const household = await householdsService.createHousehold({
    payload: req.body?.household || req.body || {},
    user: req.user,
  });
  sendCreated(res, { household });
};

export const updateHousehold = async (req, res) => {
  const household = await householdsService.updateHousehold({
    id: req.params.id,
    patch: req.body?.household || req.body || {},
    user: req.user,
  });
  sendData(res, { household });
};

export const addHouseholdMember = async (req, res) => {
  const result = await householdsService.addHouseholdMember({
    id: req.params.id,
    member: req.body?.member || req.body || {},
    user: req.user,
  });
  sendCreated(res, result);
};

export const removeHouseholdMember = async (req, res) => {
  const result = await householdsService.removeHouseholdMember({
    id: req.params.id,
    memberId: req.params.memberId,
    user: req.user,
  });
  sendData(res, result);
};

export default {
  listHouseholds,
  getHousehold,
  createHousehold,
  updateHousehold,
  addHouseholdMember,
  removeHouseholdMember,
};
