// backend/src/controllers/intake.controller.js
/**
 * Field & Station Health Intake Workflow Controller (BHW / RHU Personnel / Health Supervisor).
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   route -> authenticate -> authorize -> controller -> intake.service -> repository / Supabase
 *
 * Supports the community health intake lifecycle: searching in-scope residents,
 * loading pre-filled resident demographics/history for intake, creating draft
 * intake submissions (linked to an existing `residentId` or new `resident` payload
 * and optional `referralId`), listing/viewing/editing the worker's drafts, and
 * finalizing submission into clinical review.
 */
import * as intakeService from '../services/intake.service.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';

/**
 * Searches residents matching `req.query.q` within `req.user`'s barangay/municipality
 * scope for intake selection via `intakeService.searchResidents`.
 * Returns `{ residents }` (`200 OK` via `sendData`).
 */
export const searchResidents = async (req, res) => {
  const residents = await intakeService.searchResidents({ q: req.query.q || '', user: req.user });
  sendData(res, { residents });
};

/**
 * Retrieves resident demographics and baseline clinical context (`req.params.id`)
 * for pre-populating an intake form, scoped to `req.user` via `intakeService.getResidentForIntake`.
 * Returns `{ resident }` (`200 OK`).
 */
export const getResident = async (req, res) => {
  const resident = await intakeService.getResidentForIntake({ id: req.params.id, user: req.user });
  sendData(res, { resident });
};

/**
 * Creates a new intake draft/submission using `residentId`, `resident`, `visit`,
 * and optional `referralId` from `req.body` on behalf of `req.user`.
 * Calls `intakeService.createSubmission` and responds with `{ submission }` (`201 Created`).
 */
export const createSubmission = async (req, res) => {
  const submission = await intakeService.createSubmission({
    residentId: req.body.residentId || null,
    resident: req.body.resident || null,
    visit: req.body.visit || {},
    referralId: req.body.referralId || null,
    submit: req.body.submit === true,
    clientSubmissionId: req.body.clientSubmissionId || null,
    user: req.user,
  });
  sendCreated(res, { submission });
};

/**
 * Lists intake submissions visible to `req.user` within the permitted
 * barangay or RHU facility scope via
 * `intakeService.listMySubmissions`, returning `{ submissions }` (`200 OK`).
 */
export const listMySubmissions = async (req, res) => {
  const submissions = await intakeService.listMySubmissions({ user: req.user });
  sendData(res, { submissions });
};

/**
 * Retrieves a single intake submission (`req.params.id`) for viewing or resuming
 * draft edits, checked against `req.user` in `intakeService.getSubmissionForIntake`.
 * Returns `{ submission }` (`200 OK`).
 */
export const getSubmission = async (req, res) => {
  const submission = await intakeService.getSubmissionForIntake({ id: req.params.id, user: req.user });
  sendData(res, { submission });
};

/**
 * Updates the `visit` payload of an unsubmitted intake draft (`req.params.id`)
 * owned by `req.user` via `intakeService.updateSubmissionDraft`.
 * Returns `{ submission }` (`200 OK`).
 */
export const updateSubmission = async (req, res) => {
  const submission = await intakeService.updateSubmissionDraft({
    id: req.params.id,
    visit: req.body.visit || {},
    user: req.user,
  });
  sendData(res, { submission });
};

/**
 * Finalizes and submits intake draft `req.params.id` into the RHU/clinical review
 * queue on behalf of `req.user` via `intakeService.submitSubmission` (`200 OK`).
 */
export const submitSubmission = async (req, res) => {
  const result = await intakeService.submitSubmission({ id: req.params.id, user: req.user });
  sendData(res, result);
};

export default {
  searchResidents,
  getResident,
  createSubmission,
  listMySubmissions,
  getSubmission,
  updateSubmission,
  submitSubmission,
};
