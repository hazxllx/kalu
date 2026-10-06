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

export const searchResidents = async (req, res) => {
  const rows = await householdsService.searchHouseholdResidents({
    user: req.user,
    q: req.query.q,
  });
  sendData(res, { rows });
};

export const getHousehold = async (req, res) => {
  const household = await householdsService.getHousehold({ id: req.params.id, user: req.user });
  sendData(res, { household });
};

export const createHousehold = async (req, res) => {
  const household = await householdsService.createHousehold({
    payload: req.body?.household || req.body || {},
    // Set by the idempotency middleware; makes a replayed offline create return
    // the already-created household instead of a duplicate.
    idempotencyKey: req.idempotencyKey || req.headers['idempotency-key'] || null,
    user: req.user,
  });
  sendCreated(res, { household });
};

export const updateHousehold = async (req, res) => {
  // Optimistic concurrency: the offline client sends the last-seen revision in
  // `If-Match` (falling back to `baseRevision` in the body).
  const expectedRevision = req.headers['if-match'] ?? req.body?.baseRevision ?? null;
  const household = await householdsService.updateHousehold({
    id: req.params.id,
    patch: req.body?.household || req.body || {},
    expectedRevision,
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

export const getMemberHealth = async (req, res) => {
  const result = await householdsService.getMemberHealth({
    id: req.params.id,
    memberId: req.params.memberId,
    user: req.user,
  });
  sendData(res, result);
};

export const saveMemberHealth = async (req, res) => {
  const profile = await householdsService.saveMemberHealth({
    id: req.params.id,
    memberId: req.params.memberId,
    payload: req.body?.health || req.body || {},
    user: req.user,
  });
  sendData(res, { profile });
};

export default {
  listHouseholds,
  searchResidents,
  getHousehold,
  createHousehold,
  updateHousehold,
  addHouseholdMember,
  removeHouseholdMember,
  getMemberHealth,
  saveMemberHealth,
};
