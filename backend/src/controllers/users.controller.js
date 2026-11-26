// backend/src/controllers/users.controller.js
/**
 * User and personnel management endpoints. Authorization and account scope are
 * enforced by route middleware, the service, and the database operations.
 */
import * as usersService from '../services/users.service.js';
import { sendData } from '../utils/apiResponse.js';

export const listUsers = async (req, res) => {
  const result = await usersService.listUsers({
    actor: req.user,
    q: req.query.q,
    role: req.query.role,
    status: req.query.status,
    municipalityId: req.query.municipalityId,
    barangayId: req.query.barangayId,
    facilityId: req.query.facilityId,
    rhuStation: req.query.rhuStation,
    personnelOnly: req.query.personnelOnly,
    approvalStatus: req.query.approvalStatus,
    lifecycleState: req.query.lifecycleState,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  sendData(res, result);
};

export const getAccountOptions = async (req, res) => {
  sendData(res, await usersService.getAccountOptions(req.user));
};

export const getAccountSummary = async (req, res) => {
  sendData(res, await usersService.getAccountSummary(req.query, req.user));
};

export const createUser = async (req, res) => {
  const user = await usersService.createUser({
    actor: req.user,
    actorId: req.user.id,
    input: req.body?.user || req.body || {},
  });
  sendData(res, { user }, { status: 201 });
};

export const getUser = async (req, res) => {
  // Authorization scope is resolved from the signed-in profile, never the request body.
  const scopedUser = await usersService.getUser({ id: req.params.id, actor: req.user });
  sendData(res, { user: scopedUser });
};

export const updateUser = async (req, res) => {
  const user = await usersService.updateUser({
    id: req.params.id,
    actor: req.user,
    actorId: req.user.id,
    patch: req.body?.user || req.body || {},
  });
  sendData(res, { user });
};

export const resetUserAccess = async (req, res) => {
  const result = await usersService.resetUserAccess({ id: req.params.id, actorId: req.user.id, operationId: req.body?.operationId });
  sendData(res, result);
};

export const transitionUserLifecycle = async (req, res) => {
  const user = await usersService.transitionUserLifecycle({ id: req.params.id, actor: req.user, actorId: req.user.id, input: req.body });
  sendData(res, { user });
};

export const getUserHistory = async (req, res) => {
  sendData(res, await usersService.getUserHistory({ id: req.params.id, actor: req.user }));
};

export const deleteUser = async (req, res) => {
  const result = await usersService.deleteUser({
    id: req.params.id,
    actorId: req.user.id,
    confirmEmail: req.body?.confirmEmail ?? req.body?.user?.confirmEmail,
  });
  sendData(res, result);
};

export default {
  listUsers,
  getAccountOptions,
  getAccountSummary,
  createUser,
  getUser,
  updateUser,
  resetUserAccess,
  transitionUserLifecycle,
  getUserHistory,
  deleteUser,
};
