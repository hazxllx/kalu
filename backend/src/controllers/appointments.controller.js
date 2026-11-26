// backend/src/controllers/appointments.controller.js
import * as service from '../services/appointments.service.js';
import { sendData, sendCreated, sendNoContent } from '../utils/apiResponse.js';

/**
 * Clinic Appointment Scheduling & Slot Management Controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   route -> authenticate -> authorize -> controller -> appointments.service -> repository / Supabase
 *
 * Covers three operational domains:
 * 1. Resident self-service booking, slot availability lookup, cancellation, and
 *    responding to staff reschedule proposals. Ownership is derived strictly from
 *    `req.user` in the service layer — no client-supplied resident ID is accepted.
 * 2. Health staff triage and lifecycle management (listing, viewing, approving,
 *    declining, proposing alternate times, cancelling, and recording visit outcomes)
 *    constrained to the caller's barangay/municipality scope.
 * 3. Clinic operating schedule and holiday/closure blackout management.
 */

// --- Resident self-service -------------------------------------------------

/**
 * Lists all appointments belonging to the authenticated resident (`req.user`).
 * Delegates to `service.listOwn` and returns `{ rows }` (`200 OK`).
 */
export const listOwn = async (req, res) =>
  sendData(res, { rows: await service.listOwn({ user: req.user }) });

/**
 * Retrieves a single appointment (`req.params.id`) owned by the authenticated
 * resident (`req.user`). Delegates to `service.getOwn` and returns `{ record }` (`200 OK`).
 */
export const getOwn = async (req, res) =>
  sendData(res, { record: await service.getOwn({ user: req.user, id: req.params.id }) });

/**
 * Lists bookable health services available to the authenticated resident (`req.user`).
 * Delegates to `service.listAvailableServices` and returns `{ rows }` (`200 OK`).
 */
export const services = async (req, res) =>
  sendData(res, { rows: await service.listAvailableServices({ user: req.user }) });

/**
 * Returns bookable time-slot availability for `req.query.serviceId` on `req.query.date`
 * scoped to `req.user`. Calls `service.availability` and returns `{ availability }` (`200 OK`).
 */
export const availability = async (req, res) =>
  sendData(res, {
    availability: await service.availability({
      user: req.user,
      serviceId: req.query.serviceId,
      date: req.query.date,
    }),
  });

/**
 * Submits a new appointment booking request for the authenticated resident (`req.user`)
 * using `serviceId`, `date`, `time`, and `reason` from `req.body`.
 * Calls `service.book` and responds with `{ record }` (`201 Created` via `sendCreated`).
 */
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

/**
 * Cancels the authenticated resident's own appointment (`req.params.id`) with an
 * optional `req.body.reason`. Calls `service.cancelOwn` and returns `{ record }` (`200 OK`).
 */
export const cancelOwn = async (req, res) =>
  sendData(res, { record: await service.cancelOwn({ user: req.user, id: req.params.id, reason: req.body?.reason }) });

/**
 * Records a resident's response (`req.body.decision` and optional `req.body.reason`)
 * to a staff-proposed reschedule on appointment `req.params.id`.
 * Calls `service.respondToProposal` and returns `{ record }` (`200 OK`).
 */
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

/**
 * Lists appointments within the staff caller's (`req.user`) barangay/municipality
 * scope, applying optional filter parameters from `req.query`.
 * Calls `service.staffList` and returns `{ rows }` (`200 OK`).
 */
export const staffList = async (req, res) =>
  sendData(res, { rows: await service.staffList({ user: req.user, query: req.query }) });

/**
 * Retrieves full details of appointment `req.params.id` for an authorized staff
 * member (`req.user`). Calls `service.staffGet` and returns `{ record }` (`200 OK`).
 */
export const staffGet = async (req, res) =>
  sendData(res, { record: await service.staffGet({ user: req.user, id: req.params.id }) });

/**
 * Approves a pending appointment (`req.params.id`), optionally confirming or
 * adjusting `date`, `time`, and staff `note` from `req.body`.
 * Calls `service.approve` and returns `{ record }` (`200 OK`).
 */
export const approve = async (req, res) =>
  sendData(res, {
    record: await service.approve({
      user: req.user, id: req.params.id, date: req.body.date, time: req.body.time, note: req.body.note,
    }),
  });

/**
 * Declines an appointment request (`req.params.id`) with `req.body.reason`.
 * Calls `service.decline` and returns `{ record }` (`200 OK`).
 */
export const decline = async (req, res) =>
  sendData(res, { record: await service.decline({ user: req.user, id: req.params.id, reason: req.body.reason }) });

/**
 * Proposes an alternative `date` and `time` (plus optional `note` from `req.body`)
 * for appointment `req.params.id`, awaiting resident confirmation via `respond`.
 * Calls `service.propose` and returns `{ record }` (`200 OK`).
 */
export const propose = async (req, res) =>
  sendData(res, {
    record: await service.propose({
      user: req.user, id: req.params.id, date: req.body.date, time: req.body.time, note: req.body.note,
    }),
  });

/**
 * Cancels an appointment (`req.params.id`) on behalf of health staff (`req.user`)
 * with `req.body.reason`. Calls `service.cancel` and returns `{ record }` (`200 OK`).
 */
export const cancel = async (req, res) =>
  sendData(res, { record: await service.cancel({ user: req.user, id: req.params.id, reason: req.body.reason }) });

/**
 * Records the post-visit attendance outcome (`req.body.status`, e.g. completed or
 * no-show, plus optional `req.body.note`) for appointment `req.params.id`.
 * Calls `service.setOutcome` and returns `{ record }` (`200 OK`).
 */
export const outcome = async (req, res) =>
  sendData(res, {
    record: await service.setOutcome({ user: req.user, id: req.params.id, status: req.body.status, note: req.body.note }),
  });

// --- Schedule + closure configuration --------------------------------------

/**
 * Lists recurring clinic schedule rules visible to `req.user`, filtered by `req.query`.
 * Calls `service.listSchedules` and returns `{ rows }` (`200 OK`).
 */
export const listSchedules = async (req, res) =>
  sendData(res, { rows: await service.listSchedules({ user: req.user, query: req.query }) });

/**
 * Creates a new recurring clinic schedule window (`req.body`) within `req.user` scope.
 * Calls `service.createSchedule` and responds with `{ record }` (`201 Created`).
 */
export const createSchedule = async (req, res) =>
  sendCreated(res, { record: await service.createSchedule({ user: req.user, payload: req.body }) });

/**
 * Updates an existing clinic schedule (`req.params.id`) with `req.body`.
 * Calls `service.updateSchedule` and returns `{ record }` (`200 OK`).
 */
export const updateSchedule = async (req, res) =>
  sendData(res, { record: await service.updateSchedule({ user: req.user, id: req.params.id, payload: req.body }) });

/**
 * Deletes clinic schedule `req.params.id` after scope verification for `req.user`.
 * Calls `service.deleteSchedule` and responds with `204 No Content`.
 */
export const deleteSchedule = async (req, res) => {
  await service.deleteSchedule({ user: req.user, id: req.params.id });
  return sendNoContent(res);
};

/**
 * Lists clinic blackout/closure dates visible to `req.user`, filtered by `req.query`.
 * Calls `service.listBlackouts` and returns `{ rows }` (`200 OK`).
 */
export const listBlackouts = async (req, res) =>
  sendData(res, { rows: await service.listBlackouts({ user: req.user, query: req.query }) });

/**
 * Creates a clinic blackout/closure date (`req.body`) blocking bookings on that window.
 * Calls `service.createBlackout` and responds with `{ record }` (`201 Created`).
 */
export const createBlackout = async (req, res) =>
  sendCreated(res, { record: await service.createBlackout({ user: req.user, payload: req.body }) });

/**
 * Removes clinic blackout/closure entry `req.params.id` within `req.user` scope.
 * Calls `service.deleteBlackout` and responds with `204 No Content`.
 */
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
