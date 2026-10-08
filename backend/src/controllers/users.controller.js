/**
 * Admin User Management endpoints (admin-only). Thin controllers: read the
 * request, delegate to the service, return the standard envelope.
 */
import * as usersService from '../services/users.service.js';
import { sendData } from '../utils/apiResponse.js';

export const listUsers = async (req, res) => {
  const result = await usersService.listUsers({
    q: req.query.q,
    role: req.query.role,
    status: req.query.status,
    municipalityId: req.query.municipalityId,
    barangayId: req.query.barangayId,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  sendData(res, result);
};

export const getAccountOptions = async (_req, res) => {
  sendData(res, await usersService.getAccountOptions());
};

export const createUser = async (req, res) => {
  const user = await usersService.createUser({
    actorId: req.user.id,
    input: req.body?.user || req.body || {},
  });
  sendData(res, { user }, { status: 201 });
};

export const getUser = async (req, res) => {
  const user = await usersService.getUser({ id: req.params.id });
  sendData(res, { user });
};

export const updateUser = async (req, res) => {
  const user = await usersService.updateUser({
    id: req.params.id,
    actorId: req.user.id,
    patch: req.body?.user || req.body || {},
  });
  sendData(res, { user });
};

export const resetUserAccess = async (req, res) => {
  await usersService.resetUserAccess({ id: req.params.id, actorId: req.user.id });
  sendData(res, { sent: true });
};

export default { listUsers, getAccountOptions, createUser, getUser, updateUser, resetUserAccess };
