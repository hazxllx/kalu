import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import authorizeStation from '../middleware/authorizeStation.js';
import { FEATURE_ROLES } from '../config/roles.js';
import { RHU_STATIONS } from '../config/rhuStations.js';
import * as phnQueueController from '../controllers/phnQueue.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * PHN / RHU consultation workflow routes.
 *
 * Processing router (`/phn`) — the shared consultation queue and its clinical
 * mutations. Guarded by `consultationProcessing` (PHN + RHU + Health Supervisor)
 * AND `authorizeStation(CONSULTATION)`: the PHN always qualifies (clinical role),
 * while an RHU Personnel or Health Supervisor qualifies ONLY when assigned the
 * Consultation station. So RHU can run the consultation station on the same
 * encounter the PHN assessment uses, a Health Supervisor gains it only when
 * assigned, and a Triage-only RHU account is refused. Referral generation stays
 * PHN-only via a per-route `phnProcessing` guard (and the service re-checks).
 *
 * Read router (`/phn/records`) — opening a submission or referral for review.
 * Scoped to `referralRecords` (Health Supervisor / PHN / MHO) and NOT station-
 * gated, so the existing referral-record review for the Health Supervisor is
 * unaffected. The service layer additionally prevents non-PHN roles from reading
 * drafts.
 */
const processing = Router();
processing.use(authenticate);

const consultationStation = authorizeStation(RHU_STATIONS.CONSULTATION);
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

processing.get('/submissions', queueReaders, consultationStation, asyncHandler(phnQueueController.listQueue));
processing.put('/submissions/:id', findingsWriters, consultationStation, asyncHandler(phnQueueController.updateSubmission));
processing.post('/submissions/:id/receive', consultationConductors, consultationStation, asyncHandler(phnQueueController.receiveSubmission));
processing.post('/submissions/:id/review', consultationConductors, consultationStation, asyncHandler(phnQueueController.markInReview));
processing.post('/submissions/:id/complete', consultationConductors, consultationStation, asyncHandler(phnQueueController.completeSubmission));
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
