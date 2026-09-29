/**
 * MHO municipal submission review endpoints (BUG-010).
 *   GET  /municipal-submissions/reviews        list persisted decisions (scope)
 *   POST /municipal-submissions/reviews        record an MHO review decision
 */
import * as service from '../services/municipalSubmissions.service.js';
import { sendData } from '../utils/apiResponse.js';

export const listReviews = async (req, res) => {
  const reviews = await service.listReviews({ user: req.user });
  sendData(res, { reviews });
};

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
