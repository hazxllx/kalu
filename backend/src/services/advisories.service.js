// backend/src/services/advisories.service.js
import repository from '../repositories/index.js';
import ApiError from '../utils/apiError.js';

const assertAdmin = (user) => {
  if (user?.role !== 'admin') {
    throw ApiError.forbidden('Only the System Administrator may manage advisories.');
  }
};

export const listActiveAdvisories = ({ repo = repository } = {}) => repo.listActiveAdvisories();

export const listAdvisories = async ({ user, repo = repository } = {}) => {
  assertAdmin(user);
  return repo.listAdvisories();
};

export const createAdvisory = async ({ user, payload, repo = repository } = {}) => {
  assertAdmin(user);
  return repo.createAdvisory({ ...payload, createdBy: user.id });
};

export const updateAdvisory = async ({ user, id, payload, repo = repository } = {}) => {
  assertAdmin(user);
  const advisory = await repo.updateAdvisory(id, payload);
  if (!advisory) throw ApiError.notFound('Advisory not found.');
  return advisory;
};

export const setAdvisoryStatus = async ({ user, id, isActive, repo = repository } = {}) => {
  assertAdmin(user);
  const advisory = await repo.setAdvisoryStatus(id, isActive);
  if (!advisory) throw ApiError.notFound('Advisory not found.');
  return advisory;
};

export const deleteAdvisory = async ({ user, id, repo = repository } = {}) => {
  assertAdmin(user);
  const deleted = await repo.deleteAdvisory(id);
  if (!deleted) throw ApiError.notFound('Advisory not found.');
};

export default {
  listActiveAdvisories,
  listAdvisories,
  createAdvisory,
  updateAdvisory,
  setAdvisoryStatus,
  deleteAdvisory,
};
