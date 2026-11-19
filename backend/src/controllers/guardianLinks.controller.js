/**
 * Guardian Link Controller for Minor Residents.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   route -> authenticate -> authorize -> controller -> guardianLinks.service -> repository / Supabase
 *
 * Manages the relationship verification workflow between minor residents and their
 * adult guardians. Includes staff-initiated candidate search and linking, minor/resident-initiated
 * link requests, adult guardian acceptance/rejection of incoming requests, staff
 * verification reviews, and administrative corrections. Guardian access to clinical
 * records is NOT automatically granted by a link here; record sharing is governed
 * by separate explicit authorization policies.
 */
import * as guardianLinksService from '../services/guardianLinks.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

/**
 * Searches eligible adult resident guardian candidates matching `req.query.q`
 * within `req.user`'s scope via `guardianLinksService.searchGuardianCandidates`.
 * Returns `{ results }` (`200 OK` via `sendData`).
 */
export const searchGuardianCandidates = async (req, res) => {
  const results = await guardianLinksService.searchGuardianCandidates({ user: req.user, q: req.query.q || '' });
  sendData(res, { results });
};

/**
 * Creates a staff-recorded guardian relationship link from `req.body.guardianLink`
 * (or `req.body`) on behalf of `req.user`. Calls `guardianLinksService.createGuardianLink`
 * and responds with `{ guardianLink }` (`201 Created` via `sendCreated`).
 */
export const createGuardianLink = async (req, res) => {
  const link = await guardianLinksService.createGuardianLink({
    user: req.user,
    payload: req.body?.guardianLink || req.body || {},
  });
  sendCreated(res, { guardianLink: link });
};

/**
 * Submits a self-service guardian link request from an authenticated minor resident
 * (`req.user`) using `req.body.guardianRequest` (or `req.body`).
 * Calls `guardianLinksService.requestOwnGuardianLink` and responds with `201 Created`.
 */
export const requestOwnGuardianLink = async (req, res) => {
  const result = await guardianLinksService.requestOwnGuardianLink({
    user: req.user,
    ...(req.body?.guardianRequest || req.body || {}),
  });
  sendCreated(res, result);
};

/**
 * Lists guardian links associated with the authenticated resident (`req.user`)
 * via `guardianLinksService.listOwnGuardianLinks`, returning `200 OK` via `sendData`.
 */
export const listOwnGuardianLinks = async (req, res) => {
  const result = await guardianLinksService.listOwnGuardianLinks({ user: req.user });
  sendData(res, result);
};

/**
 * Lists pending guardian-link requests directed to the authenticated adult resident
 * (`req.user`) via `guardianLinksService.listIncomingGuardianRequests`.
 * Returns `{ requests }` (`200 OK`).
 */
export const listIncomingGuardianRequests = async (req, res) => {
  const requests = await guardianLinksService.listIncomingGuardianRequests({ user: req.user });
  sendData(res, { requests });
};

/**
 * Records an adult resident's (`req.user`) response (`req.body.decision`) to an
 * incoming guardian link request (`req.params.id`).
 * Calls `guardianLinksService.respondToGuardianRequest` and returns `{ request }` (`200 OK`).
 */
export const respondToGuardianRequest = async (req, res) => {
  const request = await guardianLinksService.respondToGuardianRequest({
    user: req.user,
    linkId: req.params.id,
    decision: req.body?.decision,
  });
  sendData(res, { request });
};

/**
 * Cancels the authenticated minor resident's (`req.user`) active pending guardian
 * request via `guardianLinksService.cancelOwnGuardianRequest`, returning `{ guardianLink }` (`200 OK`).
 */
export const cancelOwnGuardianRequest = async (req, res) => {
  const guardianLink = await guardianLinksService.cancelOwnGuardianRequest({
    user: req.user,
  });
  sendData(res, { guardianLink });
};

/**
 * Lists all guardian links recorded for minor resident `req.params.minorId` for
 * authorized staff (`req.user`) via `guardianLinksService.listGuardianLinksForMinor`.
 * Returns `{ guardianLinks }` (`200 OK`).
 */
export const listGuardianLinksForMinor = async (req, res) => {
  const links = await guardianLinksService.listGuardianLinksForMinor({
    user: req.user,
    minorResidentId: req.params.minorId,
  });
  sendData(res, { guardianLinks: links });
};

/**
 * Records a staff verification decision (`req.body.review.decision` and optional
 * `req.body.review.note`) on guardian link `req.params.id`.
 * Calls `guardianLinksService.reviewGuardianLink` and returns `{ guardianLink }` (`200 OK`).
 */
export const reviewGuardianLink = async (req, res) => {
  const link = await guardianLinksService.reviewGuardianLink({
    user: req.user,
    linkId: req.params.id,
    decision: req.body?.review?.decision,
    note: req.body?.review?.note || '',
  });
  sendData(res, { guardianLink: link });
};

/**
 * Applies an audited staff correction (`req.body.correction` or `req.body`) to an
 * existing guardian link (`req.params.id`) on behalf of `req.user`.
 * Calls `guardianLinksService.correctGuardianLink` and returns `{ guardianLink }` (`200 OK`).
 */
export const correctGuardianLink = async (req, res) => {
  const link = await guardianLinksService.correctGuardianLink({
    user: req.user,
    linkId: req.params.id,
    payload: req.body?.correction || req.body || {},
  });
  sendData(res, { guardianLink: link });
};

export default {
  searchGuardianCandidates,
  createGuardianLink,
  requestOwnGuardianLink,
  listOwnGuardianLinks,
  listIncomingGuardianRequests,
  respondToGuardianRequest,
  cancelOwnGuardianRequest,
  listGuardianLinksForMinor,
  reviewGuardianLink,
  correctGuardianLink,
};
