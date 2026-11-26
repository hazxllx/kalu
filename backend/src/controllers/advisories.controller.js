// backend/src/controllers/advisories.controller.js
import * as advisories from '../services/advisories.service.js';
import { sendCreated, sendData, sendNoContent } from '../utils/apiResponse.js';

export const listActive = async (_req, res) => {
  sendData(res, await advisories.listActiveAdvisories());
};

export const listAll = async (req, res) => {
  sendData(res, await advisories.listAdvisories({ user: req.user }));
};

export const create = async (req, res) => {
  sendCreated(res, await advisories.createAdvisory({ user: req.user, payload: req.body }));
};

export const update = async (req, res) => {
  sendData(res, await advisories.updateAdvisory({
    user: req.user,
    id: req.params.id,
    payload: req.body,
  }));
};

export const setStatus = async (req, res) => {
  sendData(res, await advisories.setAdvisoryStatus({
    user: req.user,
    id: req.params.id,
    isActive: req.body.isActive,
  }));
};

export const remove = async (req, res) => {
  await advisories.deleteAdvisory({ user: req.user, id: req.params.id });
  sendNoContent(res);
};

export default { listActive, listAll, create, update, setStatus, remove };
