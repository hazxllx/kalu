import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveOrganizationScope } from '../middleware/organizationScope.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as phnQueueController from '../controllers/phnQueue.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * PHN workflow routes.
 *
 * PHN processing router (`/phn`) — mutations and the PHN queue. Everything is
 * behind `authorize(phnProcessing)` so BHW/RHU intake roles can never act on a
 * received submission.
 *
 * Read router (`/phn/records`) — opening a submission or referral for review.
 * Scoped to `referralRecords` (Health Supervisor / PHN / MHO). The service
 * layer additionally prevents non-PHN roles from reading drafts.
 */
const processing = Router();
processing.use(authenticate, resolveOrganizationScope);
processing.use(authorize(FEATURE_ROLES.phnProcessing));

processing.get('/submissions', asyncHandler(phnQueueController.listQueue));
processing.put('/submissions/:id', asyncHandler(phnQueueController.updateSubmission));
processing.post('/submissions/:id/receive', asyncHandler(phnQueueController.receiveSubmission));
processing.post('/submissions/:id/review', asyncHandler(phnQueueController.markInReview));
processing.post('/submissions/:id/complete', asyncHandler(phnQueueController.completeSubmission));
processing.post('/submissions/:id/referral', asyncHandler(phnQueueController.createReferral));
processing.put('/referrals/:id', asyncHandler(phnQueueController.updateReferral));
processing.post('/referrals/:id/sync', asyncHandler(phnQueueController.syncReferral));

const reads = Router();
reads.use(authenticate, resolveOrganizationScope);
reads.use(authorize(FEATURE_ROLES.referralRecords));

reads.get('/submissions/:id', asyncHandler(phnQueueController.getSubmission));
reads.get('/submissions/:id/referral', asyncHandler(phnQueueController.getReferralByVisit));
reads.get('/referrals', asyncHandler(phnQueueController.listReferrals));
reads.get('/referrals/:id', asyncHandler(phnQueueController.getReferral));

export const phnReadsRouter = reads;

export default processing;
