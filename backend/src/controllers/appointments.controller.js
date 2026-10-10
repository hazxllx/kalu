import * as service from '../services/appointments.service.js';
import { sendData, sendCreated, sendNoContent } from '../utils/apiResponse.js';

/**
 * Appointment endpoints.
 *
 * Resident handlers derive ownership from the authenticated session in the
 * service layer — the controller never passes a client-supplied resident id,
 * and the appointment id in the URL is only ever matched against the caller's
 * own resident record. Staff handlers pass `req.user` so the service can
 * enforce barangay/municipality scope.
 */

// --- Resident self-service -------------------------------------------------
export const listOwn = async (req, res) =>
  sendData(res, { rows: await service.listOwn({ user: req.user }) });

export const getOwn = async (req, res) =>
  sendData(res, { record: await service.getOwn({ user: req.user, id: req.params.id }) });

export const services = async (req, res) =>
  sendData(res, { rows: await service.listAvailableServices({ user: req.user }) });

export const availability = async (req, res) =>
  sendData(res, {
    availability: await service.availability({
      user: req.user,
      serviceId: req.query.serviceId,
      date: req.query.date,
    }),
  });

export const book = async (req, res) =>
  sendCreated(res, {
    record: await service.book({
      user: req.user,
      serviceId: req.body.serviceId,
      date: req.body.date,
      time: req.body.time,
      reason: req.body.reason,
    }),
  });

export const cancelOwn = async (req, res) =>
  sendData(res, { record: await service.cancelOwn({ user: req.user, id: req.params.id, reason: req.body?.reason }) });

export const respond = async (req, res) =>
  sendData(res, {
    record: await service.respondToProposal({
      user: req.user,
      id: req.params.id,
      decision: req.body.decision,
      reason: req.body.reason,
    }),
  });

// --- Staff management ------------------------------------------------------
export const staffList = async (req, res) =>
  sendData(res, { rows: await service.staffList({ user: req.user, query: req.query }) });

export const staffGet = async (req, res) =>
  sendData(res, { record: await service.staffGet({ user: req.user, id: req.params.id }) });

export const approve = async (req, res) =>
  sendData(res, {
    record: await service.approve({
      user: req.user, id: req.params.id, date: req.body.date, time: req.body.time, note: req.body.note,
    }),
  });

export const decline = async (req, res) =>
  sendData(res, { record: await service.decline({ user: req.user, id: req.params.id, reason: req.body.reason }) });

export const propose = async (req, res) =>
  sendData(res, {
    record: await service.propose({
      user: req.user, id: req.params.id, date: req.body.date, time: req.body.time, note: req.body.note,
    }),
  });

export const cancel = async (req, res) =>
  sendData(res, { record: await service.cancel({ user: req.user, id: req.params.id, reason: req.body.reason }) });

export const outcome = async (req, res) =>
  sendData(res, {
    record: await service.setOutcome({ user: req.user, id: req.params.id, status: req.body.status, note: req.body.note }),
  });

// --- Schedule + closure configuration --------------------------------------
export const listSchedules = async (req, res) =>
  sendData(res, { rows: await service.listSchedules({ user: req.user, query: req.query }) });

export const createSchedule = async (req, res) =>
  sendCreated(res, { record: await service.createSchedule({ user: req.user, payload: req.body }) });

export const updateSchedule = async (req, res) =>
  sendData(res, { record: await service.updateSchedule({ user: req.user, id: req.params.id, payload: req.body }) });

export const deleteSchedule = async (req, res) => {
  await service.deleteSchedule({ user: req.user, id: req.params.id });
  return sendNoContent(res);
};

export const listBlackouts = async (req, res) =>
  sendData(res, { rows: await service.listBlackouts({ user: req.user, query: req.query }) });

export const createBlackout = async (req, res) =>
  sendCreated(res, { record: await service.createBlackout({ user: req.user, payload: req.body }) });

export const deleteBlackout = async (req, res) => {
  await service.deleteBlackout({ user: req.user, id: req.params.id });
  return sendNoContent(res);
};

export default {
  listOwn, getOwn, services, availability, book, cancelOwn, respond,
  staffList, staffGet, approve, decline, propose, cancel, outcome,
  listSchedules, createSchedule, updateSchedule, deleteSchedule,
  listBlackouts, createBlackout, deleteBlackout,
};
