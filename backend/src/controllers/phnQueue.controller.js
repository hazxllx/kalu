/**
 * Public Health Nurse (PHN) clinical queue and RHU referral controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> authenticate -> authorize -> phnQueue.controller -> phnQueue.service -> repository/Supabase`
 *
 * Supports two integrated RHU workflows for PHN and authorized clinical readers:
 * 1. BHC-to-RHU clinical submission queue triage (`listQueue`, `getSubmission`,
 *    `updateSubmission`, `receiveSubmission`, `markInReview`, `completeSubmission`).
 * 2. Consultation-linked clinical referrals (`createReferral`, `listReferrals`,
 *    `getReferral`, `getReferralByVisit`, `updateReferral`, `syncReferral`, `updateReferralStatus`).
 *
 * Role checks, municipality/facility scope, and optimistic referral versioning
 * are enforced in `phnQueue.service` using `req.user`.
 */
import * as phnQueueService from '../services/phnQueue.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

/**
 * Handles `GET /queue` — lists clinical submissions queued for PHN review within
 * `req.user`'s scope, parsing comma-separated `req.query.status` values and optional
 * search term `req.query.q` via `phnQueueService.listQueue()`.
 * Responds with `200 OK` (`{ submissions }`) via `sendData`.
 *
 * @param {Object} req - Express request with optional `status` and `q` query params.
 * @param {Object} res - Express response.
 */
export const listQueue = async (req, res) => {
  const { rows } = await phnQueueService.listQueue({
    statuses: req.query.status ? String(req.query.status).split(',') : null,
    q: req.query.q || '',
    user: req.user,
  });
  sendData(res, { submissions: rows });
};

/**
 * Handles `GET /health-services` — lists consultation health services available
 * in `req.user`'s facility scope via `phnQueueService.listConsultationHealthServices()`.
 * Responds with `200 OK` (`{ services }`) via `sendData`.
 *
 * @param {Object} req - Express request with authenticated `user`.
 * @param {Object} res - Express response.
 */
export const listConsultationHealthServices = async (req, res) => {
  const services = await phnQueueService.listConsultationHealthServices({ user: req.user });
  sendData(res, { services });
};

/**
 * Handles `GET /submissions/:id` — retrieves a single PHN queue submission
 * (`req.params.id`) within `req.user`'s scope via `phnQueueService.viewSubmission()`.
 * Responds with `200 OK` (`{ submission }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const getSubmission = async (req, res) => {
  const submission = await phnQueueService.viewSubmission({ id: req.params.id, user: req.user });
  sendData(res, { submission });
};

/**
 * Handles `PUT`/`PATCH /submissions/:id` — applies PHN clinical assessment edits
 * (`req.body.submission` or `req.body`) to submission `req.params.id` via
 * `phnQueueService.updateSubmissionForPhn()`. Responds with `200 OK` (`{ submission }`).
 *
 * @param {Object} req - Express request with `params.id` and patch fields in `body`.
 * @param {Object} res - Express response.
 */
export const updateSubmission = async (req, res) => {
  const submission = await phnQueueService.updateSubmissionForPhn({
    id: req.params.id,
    patch: req.body.submission || req.body,
    user: req.user,
  });
  sendData(res, { submission });
};

/**
 * Handles `POST`/`PATCH /submissions/:id/receive` — acknowledges receipt of
 * BHC submission `req.params.id` into the PHN queue via `phnQueueService.receiveSubmission()`.
 * Responds with `200 OK` (`{ submission }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and PHN `user`.
 * @param {Object} res - Express response.
 */
export const receiveSubmission = async (req, res) => {
  const submission = await phnQueueService.receiveSubmission({ id: req.params.id, user: req.user });
  sendData(res, { submission });
};

/**
 * Handles `POST`/`PATCH /submissions/:id/in-review` — transitions submission
 * `req.params.id` to the `in_review` state via `phnQueueService.markInReview()`.
 * Responds with `200 OK` (`{ submission }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and PHN `user`.
 * @param {Object} res - Express response.
 */
export const markInReview = async (req, res) => {
  const submission = await phnQueueService.markInReview({ id: req.params.id, user: req.user });
  sendData(res, { submission });
};

/** Explicitly routes a PHN-reviewed submission to an RHU Consultation facility. */
export const routeSubmissionToConsultation = async (req, res) => {
  const submission = await phnQueueService.routeSubmissionToConsultation({
    id: req.params.id,
    facilityId: req.body?.facility_id || null,
    user: req.user,
  });
  sendData(res, { submission });
};

export const listConsultationFacilities = async (req, res) => {
  const facilities = await phnQueueService.listConsultationFacilities({ user: req.user });
  sendData(res, { facilities });
};

/**
 * Handles `POST`/`PATCH /submissions/:id/complete` — finalizes PHN clinical
 * processing of submission `req.params.id` via `phnQueueService.completeSubmission()`.
 * Responds with `200 OK` (`{ submission }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and PHN `user`.
 * @param {Object} res - Express response.
 */
export const completeSubmission = async (req, res) => {
  const submission = await phnQueueService.completeSubmission({ id: req.params.id, user: req.user, patch: req.body?.submission });
  sendData(res, { submission });
};

/**
 * Handles `POST /submissions/:id/referrals` — creates a clinical referral linked
 * to visit/submission `req.params.id` (`visitId`) from `req.body.referral`,
 * `req.body.record`, or `req.body` via `phnQueueService.createReferral()`.
 * Responds with `201 Created` (`sendCreated`) containing `{ referral }`.
 *
 * @param {Object} req - Express request with `params.id` (visitId) and referral draft in `body`.
 * @param {Object} res - Express response.
 */
export const createReferral = async (req, res) => {
  const referral = await phnQueueService.createReferral({
    visitId: req.params.id,
    draft: req.body.referral || req.body.record || req.body || {},
    user: req.user,
  });
  sendCreated(res, { referral });
};

/**
 * Handles `GET /referrals` — lists referrals visible to `req.user` filtered by
 * search query `req.query.q`, mailbox `req.query.box`, and `req.query.status`
 * via `phnQueueService.listReferrals()`. Responds with `200 OK` (`{ referrals }`).
 *
 * @param {Object} req - Express request with optional `q`, `box`, and `status` query params.
 * @param {Object} res - Express response.
 */
export const listReferrals = async (req, res) => {
  const { rows } = await phnQueueService.listReferrals({ q: req.query.q || '', box: req.query.box, status: req.query.status, user: req.user });
  sendData(res, { referrals: rows });
};

/**
 * Handles `GET /referrals/:id` — fetches a single referral (`req.params.id`)
 * within `req.user`'s scope via `phnQueueService.getReferral()`.
 * Responds with `200 OK` (`{ referral }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const getReferral = async (req, res) => {
  const referral = await phnQueueService.getReferral({ id: req.params.id, user: req.user });
  sendData(res, { referral });
};

/**
 * Handles `GET /submissions/:id/referral` — retrieves the referral linked to
 * visit/submission `req.params.id` (`visitId`) via `phnQueueService.getReferralByVisitId()`.
 * Responds with `200 OK` (`{ referral }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` (visitId) and authenticated `user`.
 * @param {Object} res - Express response.
 */
export const getReferralByVisit = async (req, res) => {
  const referral = await phnQueueService.getReferralByVisitId({ visitId: req.params.id, user: req.user });
  sendData(res, { referral });
};

/**
 * Handles `PUT`/`PATCH /referrals/:id` — updates editable referral fields on
 * `req.params.id` from `req.body.referral`, `req.body.record`, or `req.body`
 * via `phnQueueService.updateReferral()`. Responds with `200 OK` (`{ referral }`).
 *
 * @param {Object} req - Express request with `params.id` and referral patch in `body`.
 * @param {Object} res - Express response.
 */
export const updateReferral = async (req, res) => {
  const referral = await phnQueueService.updateReferral({
    id: req.params.id,
    patch: req.body.referral || req.body.record || req.body || {},
    user: req.user,
  });
  sendData(res, { referral });
};

/**
 * Handles `POST /referrals/:id/sync` — refreshes resident and clinical visit
 * snapshot fields stored on referral `req.params.id`, forwarding optional optimistic
 * version (`expected_version ?? version`) to `phnQueueService.syncReferralSnapshots()`.
 * Responds with `200 OK` (`{ referral }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and optional version in `body`.
 * @param {Object} res - Express response.
 */
export const syncReferral = async (req, res) => {
  const body = req.body.referral || req.body.record || req.body || {};
  const referral = await phnQueueService.syncReferralSnapshots({ id: req.params.id, user: req.user, version: body.expected_version ?? body.version });
  sendData(res, { referral });
};

/**
 * Handles `PATCH /referrals/:id/status` — transitions referral `req.params.id` to
 * `body.status` with optional `resolution_notes`/`resolutionNotes` and optimistic
 * version check (`expected_version ?? version`) via `phnQueueService.updateReferralStatus()`.
 * Responds with `200 OK` (`{ referral }`) via `sendData`.
 *
 * @param {Object} req - Express request with `params.id` and status transition payload in `body`.
 * @param {Object} res - Express response.
 */
export const updateReferralStatus = async (req, res) => {
  const body = req.body.referral || req.body.record || req.body || {};
  sendData(res, { referral: await phnQueueService.updateReferralStatus({ id: req.params.id, user: req.user, status: body.status, resolutionNotes: body.resolution_notes ?? body.resolutionNotes, version: body.expected_version ?? body.version }) });
};

export default {
  listQueue,
  listConsultationHealthServices,
  getSubmission,
  updateSubmission,
  receiveSubmission,
  markInReview,
  completeSubmission,
  createReferral,
  listReferrals,
  getReferral,
  getReferralByVisit,
  updateReferral,
  syncReferral,
  updateReferralStatus,
};
