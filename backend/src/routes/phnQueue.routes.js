import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as phnQueueController from '../controllers/phnQueue.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * PHN / RHU consultation workflow routes.
 *
 * Processing router (`/phn`) — the shared consultation queue and its clinical
 * mutations. Guarded by `consultationProcessing` (PHN + RHU consultation
 * personnel) so RHU can run the consultation station on the same encounter the
 * PHN assessment uses. Referral generation stays PHN-only via a per-route
 * `phnProcessing` guard (and the service re-checks the PHN role).
 *
 * Read router (`/phn/records`) — opening a submission or referral for review.
 * Scoped to `referralRecords` (Health Supervisor / PHN / MHO). The service
 * layer additionally prevents non-PHN roles from reading drafts.
 */
const processing = Router();
processing.use(authenticate);
processing.use(authorize(FEATURE_ROLES.consultationProcessing));

const phnOnly = authorize(FEATURE_ROLES.phnProcessing);

processing.get('/submissions', asyncHandler(phnQueueController.listQueue));
processing.put('/submissions/:id', asyncHandler(phnQueueController.updateSubmission));
processing.post('/submissions/:id/receive', asyncHandler(phnQueueController.receiveSubmission));
processing.post('/submissions/:id/review', asyncHandler(phnQueueController.markInReview));
processing.post('/submissions/:id/complete', asyncHandler(phnQueueController.completeSubmission));
// Referrals remain PHN-only.
processing.post('/submissions/:id/referral', phnOnly, asyncHandler(phnQueueController.createReferral));
processing.put('/referrals/:id', phnOnly, asyncHandler(phnQueueController.updateReferral));
processing.post('/referrals/:id/sync', phnOnly, asyncHandler(phnQueueController.syncReferral));

const reads = Router();
reads.use(authenticate);
reads.use(authorize(FEATURE_ROLES.referralRecords));

reads.get('/submissions/:id', asyncHandler(phnQueueController.getSubmission));
reads.get('/submissions/:id/referral', asyncHandler(phnQueueController.getReferralByVisit));
reads.get('/referrals', asyncHandler(phnQueueController.listReferrals));
reads.get('/referrals/:id', asyncHandler(phnQueueController.getReferral));

export const phnReadsRouter = reads;

export default processing;
