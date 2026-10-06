import * as service from '../services/healthServices.service.js';
import { sendCreated, sendData } from '../utils/apiResponse.js';

/**
 * Health service endpoints.
 *
 *   GET   /meta                  category vocabulary
 *   GET   /?mine=&category=      services in my scope (or only mine=true)
 *   GET   /personnel             assignable personnel in my municipality
 *   GET   /:id                   one service (scope-checked)
 *   POST  /                      create a service (+ optional assignment)
 *   POST  /:id/assign            assign a personnel to a service
 *   DELETE /:id/assign/:personnelId  remove an assignment
 */

export const meta = async (req, res) => sendData(res, service.meta());

export const reference = async (req, res) => {
  const data = await service.reference({ user: req.user });
  sendData(res, data);
};

export const list = async (req, res) => {
  const mine = String(req.query.mine || '').toLowerCase() === 'true';
  const rows = await service.list({ user: req.user, mine, category: req.query.category || null });
  sendData(res, { rows, records: rows });
};

export const personnel = async (req, res) => {
  const rows = await service.assignablePersonnel({ user: req.user });
  sendData(res, { rows });
};

export const get = async (req, res) => {
  const record = await service.getById({ user: req.user, id: req.params.id });
  sendData(res, { record });
};

export const create = async (req, res) => {
  const record = await service.create({ user: req.user, payload: req.body || {} });
  sendCreated(res, { record });
};

export const assign = async (req, res) => {
  const record = await service.assign({ user: req.user, serviceId: req.params.id, personnelId: req.body?.personnelId });
  sendData(res, { record });
};

export const unassign = async (req, res) => {
  const record = await service.unassign({ user: req.user, serviceId: req.params.id, personnelId: req.params.personnelId });
  sendData(res, { record });
};

export const createAttendance = async (req, res) => {
  const record = await service.createHealthServiceAttendance({ user: req.user, payload: req.body || {} });
  sendCreated(res, { record });
};

export const listAttendance = async (req, res) => {
  let rows;
  if (req.query.service_id) {
    rows = await service.listAttendanceByService({ user: req.user, query: req.query });
  } else if (req.query.resident_id) {
    rows = await service.listAttendanceByResident({ user: req.user, query: req.query });
  } else {
    // No service/resident filter: a staff caller in scope lists attendance
    // scheduled within their coverage for the dashboard calendar.
    rows = await service.listScopeAttendance({ user: req.user, query: req.query });
  }
  sendData(res, { rows, records: rows });
};

export const updateAttendance = async (req, res) => {
  const record = await service.updateHealthServiceAttendance({
    user: req.user,
    params: req.params,
    payload: req.body || {},
  });
  sendData(res, { record });
};

export default {
  meta,
  reference,
  list,
  personnel,
  get,
  create,
  assign,
  unassign,
  createAttendance,
  listAttendance,
  updateAttendance,
};