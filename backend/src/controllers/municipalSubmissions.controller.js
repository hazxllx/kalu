/**
 * Municipal Health Officer (MHO) submission review controller (BUG-010).
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   `route -> authenticate -> authorize -> municipalSubmissions.controller -> municipalSubmissions.service -> repository/Supabase`
 *
 * Endpoints handled:
 *   GET  /municipal-submissions/reviews   list persisted MHO review decisions in caller scope
 *   POST /municipal-submissions/reviews   record an MHO review decision for a barangay/period submission
 */
import * as service from '../services/municipalSubmissions.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * Handles `GET /municipal-submissions/reviews` — retrieves persisted submission
 * review decisions visible to `req.user`, optionally filtered by `req.query.submissionRef`.
 * Delegates to `service.listReviews()` and responds with `200 OK` (`{ reviews }`).
 *
 * @param {Object} req - Express request with authenticated `user` and optional `submissionRef` query param.
 * @param {Object} res - Express response.
 */
export const listReviews = async (req, res) => {
  const reviews = await service.listReviews({ user: req.user, submissionRef: req.query.submissionRef });
  sendData(res, { reviews });
};

/**
 * Handles `POST /municipal-submissions/reviews` — records an MHO review decision
 * (`decision` + optional `notes`) for a municipal submission identified by
 * `submissionRef`, `submissionType`, `period`, and optional `barangayId` in `req.body`.
 * Delegates to `service.reviewSubmission()` with `req.user` and responds with `200 OK` (`{ review }`).
 *
 * @param {Object} req - Express request with submission review payload in `body` and MHO `user`.
 * @param {Object} res - Express response.
 */
export const reviewSubmission = async (req, res) => {
  const body = req.body || {};
  const review = await service.reviewSubmission({
    user: req.user,
    submissionRef: body.submissionRef,
    submissionType: body.submissionType,
    period: body.period,
    barangayId: body.barangayId || null,
    decision: body.decision,
    notes: body.notes || '',
  });
  sendData(res, { review });
};

export default { listReviews, reviewSubmission };
