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
    limit: req.query.limit,
    offset: req.query.offset,
  });
  sendData(res, result);
};

export const getUser = async (req, res) => {
  const user = await usersService.getUser({ id: req.params.id });
  sendData(res, { user });
};

export const updateUser = async (req, res) => {
  const user = await usersService.updateUser({
    id: req.params.id,
    patch: req.body?.user || req.body || {},
  });
  sendData(res, { user });
};

export default { listUsers, getUser, updateUser };
