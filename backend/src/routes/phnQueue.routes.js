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

const queueReaders = authorize(FEATURE_ROLES.consultationProcessing, {
  permission: 'consultation.requests.view',
});
const findingsWriters = authorize(FEATURE_ROLES.consultationProcessing, {
  permission: 'consultation.findings.record',
});
const consultationConductors = authorize(FEATURE_ROLES.consultationProcessing, {
  permission: 'consultation.conduct',
});
const referralCreators = authorize(FEATURE_ROLES.phnProcessing, {
  permission: 'referrals.create',
});
const referralEditors = authorize(FEATURE_ROLES.phnProcessing, {
  permission: 'referrals.status.update',
});

processing.get('/submissions', queueReaders, asyncHandler(phnQueueController.listQueue));
processing.put('/submissions/:id', findingsWriters, asyncHandler(phnQueueController.updateSubmission));
processing.post('/submissions/:id/receive', consultationConductors, asyncHandler(phnQueueController.receiveSubmission));
processing.post('/submissions/:id/review', consultationConductors, asyncHandler(phnQueueController.markInReview));
processing.post('/submissions/:id/complete', consultationConductors, asyncHandler(phnQueueController.completeSubmission));
// Referrals remain PHN-only.
processing.post('/submissions/:id/referral', referralCreators, asyncHandler(phnQueueController.createReferral));
processing.put('/referrals/:id', referralEditors, asyncHandler(phnQueueController.updateReferral));
processing.post('/referrals/:id/sync', referralEditors, asyncHandler(phnQueueController.syncReferral));

const reads = Router();
reads.use(authenticate);
const submissionReaders = authorize(FEATURE_ROLES.referralRecords, {
  anyPermission: ['consultation.requests.view', 'consultation.history.view'],
});
const referralReaders = authorize(FEATURE_ROLES.referralRecords, {
  anyPermission: ['referrals.view', 'referrals.history.view'],
});

reads.get('/submissions/:id', submissionReaders, asyncHandler(phnQueueController.getSubmission));
reads.get('/submissions/:id/referral', referralReaders, asyncHandler(phnQueueController.getReferralByVisit));
reads.get('/referrals', referralReaders, asyncHandler(phnQueueController.listReferrals));
reads.get('/referrals/:id', referralReaders, asyncHandler(phnQueueController.getReferral));

export const phnReadsRouter = reads;

export default processing;
