// backend/src/controllers/medicalCertificates.controller.js
import {
  CERT_PURPOSES,
  CERT_STATUSES,
  ALLOWED_TRANSITIONS,
  nextReference,
} from '../services/medicalCertificates.service.js';
import * as service from '../services/medicalCertificates.service.js';
import { sendCreated, sendData } from '../utils/apiResponse.js';

/**
 * Medical certificate preparation, review, and issuance controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> authenticate -> authorize -> medicalCertificates.controller -> medicalCertificates.service -> repository/Supabase`
 *
 * Endpoints handled:
 *   GET   /meta                     status vocabulary, purposes, transitions, and caller decision capability
 *   GET   /next-reference           next sequential `MC-YYYY-####` reference number
 *   GET   /?status=&residentId=     certificates within the caller's barangay/facility scope
 *   GET   /:id                      single certificate + its decision history
 *   POST  /                         prepare a new certificate (`Draft`)
 *   PUT   /:id                      edit mutable certificate document fields
 *   PATCH /:id/status              transition lifecycle (`submit`, `approve`, `issue`, `reject`, `cancel`)
 *
 * Role-based sign-off authority (e.g., MHO approval/issuance) and geographic scope
 * are enforced in `medicalCertificates.service` using `req.user`.
 */

/**
 * Handles `GET /meta` — returns certificate status constants, purpose vocabulary,
 * allowed workflow transitions, and whether `req.user` has sign-off permission (`canDecide`).
 * Responds with `200 OK` via `sendData`.
 *
 * @param {Object} req - Express request with authenticated `user`.
 * @param {Object} res - Express response.
 */
export const meta = async (req, res) => {
  sendData(res, {
    statuses: CERT_STATUSES,
    purposes: CERT_PURPOSES,
    allowedTransitions: ALLOWED_TRANSITIONS,
    canDecide: service.canDecide(req.user),
  });
};

/**
 * Handles `GET /next-reference` — computes the next `MC-YYYY-####` certificate
 * reference number via `nextReference()` and responds with `200 OK` (`{ reference }`).
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 */
export const reference = async (req, res) => {
  const referenceNo = await nextReference();
  sendData(res, { reference: referenceNo });
};

/**
 * Handles `GET /` — lists medical certificates in `req.user`'s scope, optionally
 * filtered by `req.query.status` and `req.query.residentId`.
 * Delegates to `service.list()` and responds with `200 OK` containing `{ rows, records }`.
 *
 * @param {Object} req - Express request with optional `status` and `residentId` query params.
 * @param {Object} res - Express response.
 */
export const list = async (req, res) => {
  const rows = await service.list({
    user: req.user,
    status: req.query.status,
    residentId: req.query.residentId,
  });
  sendData(res, { rows, records: rows });
};

/**
 * Handles `GET /:id` — retrieves a single medical certificate (`req.params.id`)
 * together with its decision audit history within `req.user`'s scope via `service.getById()`.
 * Responds with `200 OK` (`{ record }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const get = async (req, res) => {
  const record = await service.getById({ user: req.user, id: req.params.id });
  sendData(res, { record });
};

/**
 * Handles `POST /` — prepares a new draft medical certificate from `req.body`
 * on behalf of `req.user` via `service.create()`.
 * Responds with `201 Created` (`sendCreated`) containing `{ record }`.
 *
 * @param {Object} req - Express request with certificate draft fields in `body`.
 * @param {Object} res - Express response.
 */
export const create = async (req, res) => {
  const record = await service.create({ user: req.user, payload: req.body || {} });
  sendCreated(res, { record });
};

/**
 * Handles `PUT /:id` — updates editable document fields on certificate `req.params.id`
 * from `req.body` via `service.update()`. Responds with `200 OK` (`{ record }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and updated certificate fields in `body`.
 * @param {Object} res - Express response.
 */
export const update = async (req, res) => {
  const record = await service.update({ user: req.user, id: req.params.id, payload: req.body || {} });
  sendData(res, { record });
};

/**
 * Handles `PATCH /:id/status` — transitions certificate `req.params.id` to `req.body.status`
 * (e.g., submit, approve, issue, reject, cancel) with optional decision `req.body.notes`
 * via `service.changeStatus()`. Responds with `200 OK` (`{ record }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and `{ status, notes }` in `body`.
 * @param {Object} res - Express response.
 */
export const changeStatus = async (req, res) => {
  const record = await service.changeStatus({
    user: req.user,
    id: req.params.id,
    status: req.body?.status,
    notes: req.body?.notes,
  });
  sendData(res, { record });
};

export default { meta, reference, list, get, create, update, changeStatus };
