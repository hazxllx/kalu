/**
 * Household Profiling, Membership & Home-Visit Controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   route -> authenticate -> authorize -> [idempotency] -> controller -> households.service -> repository / Supabase
 *
 * Manages barangay/municipality-scoped household records, monitoring summaries,
 * resident/worker lookup, home-visit logs, household member links, and individual
 * member health profiles. Supports offline-first field synchronization via
 * `Idempotency-Key` on household creation and `If-Match` / `baseRevision`
 * optimistic concurrency checks on household updates.
 */
import * as householdsService from '../services/households.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';
import ApiError from '../utils/apiError.js';

/**
 * Lists households in `req.user`'s scope with optional `q`, `barangay`, `limit`,
 * and `offset` query parameters via `householdsService.listHouseholds` (`200 OK`).
 */
export const listHouseholds = async (req, res) => {
  const result = await householdsService.listHouseholds({
    user: req.user,
    q: req.query.q,
    barangay: req.query.barangay,
    verificationStatus: req.query.verificationStatus,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  sendData(res, result);
};

/**
 * Returns aggregated household risk and visit monitoring metrics for `req.user`'s
 * coverage via `householdsService.getHouseholdMonitoring` (`200 OK`).
 */
export const getHouseholdMonitoring = async (req, res) => {
  const summary = await householdsService.getHouseholdMonitoring({ user: req.user });
  sendData(res, summary);
};

/**
 * Searches residents eligible to be linked as household members matching `req.query.q`
 * within `req.user`'s scope via `householdsService.searchHouseholdResidents`.
 * Returns `{ rows }` (`200 OK`).
 */
export const searchResidents = async (req, res) => {
  const rows = await householdsService.searchHouseholdResidents({
    user: req.user,
    q: req.query.q,
  });
  sendData(res, { rows });
};

/**
 * Lists assignable Barangay Health Workers / field staff for a household or barangay.
 * When `req.query.householdId` is supplied, resolves the household first (`422` if it
 * lacks a `barangayId`); otherwise uses `req.query.barangayId`.
 * Calls `householdsService.listHouseholdWorkers` and returns `{ rows }` (`200 OK`).
 */
export const listWorkers = async (req, res) => {
  const household = req.query.householdId
    ? await householdsService.getHousehold({ id: req.query.householdId, user: req.user })
    : null;
  if (household && !household.barangayId) throw ApiError.unprocessable('The household has no recorded barangay assignment.');
  const rows = await householdsService.listHouseholdWorkers({ user: req.user, barangayId: household?.barangayId || req.query.barangayId });
  sendData(res, { rows });
};

/**
 * Retrieves full profile and member roster for household `req.params.id` scoped
 * to `req.user` via `householdsService.getHousehold`, returning `{ household }` (`200 OK`).
 */
export const getHousehold = async (req, res) => {
  const household = await householdsService.getHousehold({ id: req.params.id, user: req.user });
  sendData(res, { household });
};

/**
 * Lists chronological home-visit records for household `req.params.id` scoped to
 * `req.user` via `householdsService.listHouseholdVisits`, returning `{ visits }` (`200 OK`).
 */
export const listHouseholdVisits = async (req, res) => {
  const visits = await householdsService.listHouseholdVisits({ id: req.params.id, user: req.user });
  sendData(res, { visits });
};

/**
 * Records a new home visit (`req.body.visit` or `req.body`) for household
 * `req.params.id` on behalf of `req.user` via `householdsService.recordHouseholdVisit`.
 * Responds with `{ visit }` (`201 Created` via `sendCreated`).
 */
export const recordHouseholdVisit = async (req, res) => {
  const visit = await householdsService.recordHouseholdVisit({
    id: req.params.id,
    payload: req.body?.visit || req.body || {},
    user: req.user,
  });
  sendCreated(res, { visit });
};

/**
 * Creates a new household profile (`req.body.household` or `req.body`) within
 * `req.user`'s scope. Forwards `req.idempotencyKey` (or `Idempotency-Key` header)
 * so offline sync retries return the existing household without duplication.
 * Responds with `201 Created` via `sendCreated`.
 */
export const createHousehold = async (req, res) => {
  const result = await householdsService.createHousehold({
    payload: req.body?.household || req.body || {},
    // Set by the idempotency middleware; makes a replayed offline create return
    // the already-created household instead of a duplicate.
    idempotencyKey: req.idempotencyKey || req.headers['idempotency-key'] || null,
    user: req.user,
  });
  sendCreated(res, result);
};

/**
 * Updates household `req.params.id` with `req.body.household` (or `req.body`),
 * enforcing optimistic concurrency when `If-Match` header or `req.body.baseRevision`
 * is provided. Calls `householdsService.updateHousehold` and returns `{ household }` (`200 OK`).
 */
export const updateHousehold = async (req, res) => {
  // Optimistic concurrency: the offline client sends the last-seen revision in
  // `If-Match` (falling back to `baseRevision` in the body).
  const expectedRevision = req.headers['if-match'] ?? req.body?.baseRevision ?? null;
  const household = await householdsService.updateHousehold({
    id: req.params.id,
    patch: req.body?.household || req.body || {},
    expectedRevision,
    user: req.user,
  });
  sendData(res, { household });
};

/**
 * Adds a resident member (`req.body.member` or `req.body`) to household `req.params.id`
 * via `householdsService.addHouseholdMember`, responding with `201 Created`.
 */
export const addHouseholdMember = async (req, res) => {
  const result = await householdsService.addHouseholdMember({
    id: req.params.id,
    member: req.body?.member || req.body || {},
    user: req.user,
  });
  sendCreated(res, result);
};

/**
 * Removes member `req.params.memberId` from household `req.params.id` on behalf
 * of `req.user` via `householdsService.removeHouseholdMember` (`200 OK`).
 */
export const removeHouseholdMember = async (req, res) => {
  const result = await householdsService.removeHouseholdMember({
    id: req.params.id,
    memberId: req.params.memberId,
    user: req.user,
  });
  sendData(res, result);
};

/**
 * Updates relationship or role metadata (`req.body.member` or `req.body`) for
 * member `req.params.memberId` in household `req.params.id` via
 * `householdsService.updateHouseholdMember` (`200 OK`).
 */
export const updateHouseholdMember = async (req, res) => {
  const result = await householdsService.updateHouseholdMember({
    id: req.params.id,
    memberId: req.params.memberId,
    member: req.body?.member || req.body || {},
    user: req.user,
  });
  sendData(res, result);
};

/**
 * Retrieves the household-context health profile for member `req.params.memberId`
 * in household `req.params.id` via `householdsService.getMemberHealth` (`200 OK`).
 */
export const getMemberHealth = async (req, res) => {
  const result = await householdsService.getMemberHealth({
    id: req.params.id,
    memberId: req.params.memberId,
    user: req.user,
  });
  sendData(res, result);
};

/**
 * Upserts the household-context health profile (`req.body.health` or `req.body`)
 * for member `req.params.memberId` in household `req.params.id` via
 * `householdsService.saveMemberHealth`, returning `{ profile }` (`200 OK`).
 */
export const saveMemberHealth = async (req, res) => {
  const profile = await householdsService.saveMemberHealth({
    id: req.params.id,
    memberId: req.params.memberId,
    payload: req.body?.health || req.body || {},
    user: req.user,
  });
  sendData(res, { profile });
};

export default {
  listHouseholds,
  getHouseholdMonitoring,
  searchResidents,
  listWorkers,
  getHousehold,
  listHouseholdVisits,
  recordHouseholdVisit,
  createHousehold,
  updateHousehold,
  addHouseholdMember,
  removeHouseholdMember,
  updateHouseholdMember,
  getMemberHealth,
  saveMemberHealth,
};
