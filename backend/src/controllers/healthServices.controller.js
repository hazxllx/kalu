// backend/src/controllers/healthServices.controller.js
import * as service from '../services/healthServices.service.js';
import { sendCreated, sendData } from '../utils/apiResponse.js';
import ApiError from '../utils/apiError.js';

/**
 * Community Health Services, Publications & Attendance Controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   route -> authenticate -> authorize -> [upload middleware] -> controller -> healthServices.service -> Supabase Storage & repository
 *
 * Manages facility/barangay health programs and scheduled community services:
 * - Metadata & reference lookups (`meta`, `reference`, `personnel`)
 * - Scoped service catalog CRUD (`list`, `get`, `create`, `update`, `remove`)
 * - Personnel assignment (`assign`, `unassign`) and resident registrations (`registrations`)
 * - Service publication attachments & signed URLs (`uploadAttachment`, `deleteAttachment`, `getAttachmentSignedUrl`)
 * - Service attendance enrollment, listing, and status updates (`createAttendance`, `listAttendance`, `updateAttendance`)
 */

/**
 * Returns static health-service category metadata (`service.meta()`) via `sendData` (`200 OK`).
 */
export const meta = async (req, res) => sendData(res, service.meta());

/**
 * Returns scoped reference data (categories, facilities, barangays) for `req.user`
 * via `service.reference`, responding with `200 OK` via `sendData`.
 */
export const reference = async (req, res) => {
  const data = await service.reference({ user: req.user });
  sendData(res, data);
};

/**
 * Lists health services within `req.user`'s coverage, optionally filtered to
 * services assigned to the caller (`req.query.mine === 'true'`) or by `req.query.category`.
 * Calls `service.list` and returns `{ rows, records }` (`200 OK`).
 */
export const list = async (req, res) => {
  const mine = String(req.query.mine || '').toLowerCase() === 'true';
  const rows = await service.list({ user: req.user, mine, category: req.query.category || null });
  sendData(res, { rows, records: rows });
};

/**
 * Lists health personnel eligible for assignment to services in `req.user`'s municipality.
 * Calls `service.assignablePersonnel` and returns `{ rows }` (`200 OK`).
 */
export const personnel = async (req, res) => {
  const rows = await service.assignablePersonnel({ user: req.user });
  sendData(res, { rows });
};

/**
 * Retrieves a single health service (`req.params.id`) after scope verification
 * for `req.user` via `service.getById`, returning `{ record }` (`200 OK`).
 */
export const get = async (req, res) => {
  const record = await service.getById({ user: req.user, id: req.params.id });
  sendData(res, { record });
};

/**
 * Creates a new health service (and optional initial personnel assignments) from
 * `req.body` within `req.user`'s scope via `service.create`.
 * Responds with `{ record }` (`201 Created` via `sendCreated`).
 */
export const create = async (req, res) => {
  const record = await service.create({ user: req.user, payload: req.body || {} });
  sendCreated(res, { record });
};

/**
 * Updates an existing health service (`req.params.id`) in place with content or
 * status fields from `req.body` via `service.update`, returning `{ record }` (`200 OK`).
 */
export const update = async (req, res) => {
  const record = await service.update({ user: req.user, serviceId: req.params.id, payload: req.body || {} });
  sendData(res, { record });
};

/**
 * Deletes health service `req.params.id` on behalf of `req.user` via `service.remove`
 * (rejected by the service if dependent consultations/appointments/attendance exist).
 * Returns deletion confirmation (`200 OK` via `sendData`).
 */
export const remove = async (req, res) => {
  const result = await service.remove({ user: req.user, serviceId: req.params.id });
  sendData(res, result);
};

/**
 * Assigns personnel `req.body.personnelId` to health service `req.params.id`
 * via `service.assign`, returning the updated `{ record }` (`200 OK`).
 */
export const assign = async (req, res) => {
  const record = await service.assign({ user: req.user, serviceId: req.params.id, personnelId: req.body?.personnelId });
  sendData(res, { record });
};

/**
 * Removes personnel assignment `req.params.personnelId` from health service
 * `req.params.id` via `service.unassign`, returning `{ record }` (`200 OK`).
 */
export const unassign = async (req, res) => {
  const record = await service.unassign({ user: req.user, serviceId: req.params.id, personnelId: req.params.personnelId });
  sendData(res, { record });
};

/**
 * Lists resident registrations/enrollees for health service `req.params.id`
 * scoped to `req.user` via `service.listServiceRegistrations` (`200 OK`).
 */
export const registrations = async (req, res) => {
  const data = await service.listServiceRegistrations({ user: req.user, serviceId: req.params.id });
  sendData(res, data);
};

/**
 * Uploads a publication image or attachment (`req.file`, throwing `422` if absent)
 * of slot `req.params.attachmentType` for health service `req.params.id`.
 * Passes file metadata and buffer to `service.uploadAttachment` and returns `{ record }` (`200 OK`).
 */
export const uploadAttachment = async (req, res) => {
  if (!req.file) throw ApiError.unprocessable('No file was received. Please choose the publication image again.');
  const record = await service.uploadAttachment({
    user: req.user,
    serviceId: req.params.id,
    attachmentType: req.params.attachmentType,
    file: {
      name: req.file.originalname,
      type: req.file.mimetype,
      size: req.file.size,
      buffer: req.file.buffer,
    },
  });
  sendData(res, { record });
};

/**
 * Deletes attachment `req.params.attachmentType` from health service `req.params.id`
 * on behalf of `req.user` via `service.deleteAttachment` (`200 OK`).
 */
export const deleteAttachment = async (req, res) => {
  const result = await service.deleteAttachment({
    user: req.user,
    serviceId: req.params.id,
    attachmentType: req.params.attachmentType,
  });
  sendData(res, result);
};

/**
 * Generates a short-lived signed download URL for attachment `req.params.attachmentType`
 * on health service `req.params.id` via `service.getAttachmentSignedUrl`.
 * Returns `{ url }` (`200 OK`).
 */
export const getAttachmentSignedUrl = async (req, res) => {
  const url = await service.getAttachmentSignedUrl({
    user: req.user,
    serviceId: req.params.id,
    attachmentType: req.params.attachmentType,
  });
  sendData(res, { url });
};

/**
 * Enrolls/records resident attendance for a health service from `req.body` on
 * behalf of `req.user` via `service.createHealthServiceAttendance`.
 * Responds with `{ record }` (`201 Created` via `sendCreated`).
 */
export const createAttendance = async (req, res) => {
  const record = await service.createHealthServiceAttendance({ user: req.user, payload: req.body || {} });
  sendCreated(res, { record });
};

/**
 * Lists health-service attendance records based on query filter mode:
 * - `?service_id=` -> `service.listAttendanceByService`
 * - `?resident_id=` -> `service.listAttendanceByResident`
 * - neither -> `service.listScopeAttendance` (all scheduled attendance in `req.user`'s coverage)
 * Returns `{ rows, records }` (`200 OK` via `sendData`).
 */
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

/**
 * Updates an attendance record identified by `req.params` with `req.body`
 * via `service.updateHealthServiceAttendance`, returning `{ record }` (`200 OK`).
 */
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
  update,
  remove,
  assign,
  unassign,
  uploadAttachment,
  deleteAttachment,
  getAttachmentSignedUrl,
  createAttendance,
  listAttendance,
  updateAttendance,
  registrations,
};
