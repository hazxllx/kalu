import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import authorizeStation from '../middleware/authorizeStation.js';
import { FEATURE_ROLES } from '../config/roles.js';
import { RHU_STATIONS } from '../config/rhuStations.js';
import * as phnQueueController from '../controllers/phnQueue.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * PHN / RHU clinical consultation queue and referral processing routes.
 *
 * Role in KALUSAGAP:
 * Coordinates clinical encounters forwarded from barangay/triage intake to the
 * Consultation station, including queue triage, assessment/findings entry,
 * consultation completion, and outbound clinical referral generation.
 *
 * Architectural pipeline:
 *   route -> authenticate -> authorize(roles, permission)
 *         -> [authorizeStation(CONSULTATION)] -> phnQueue.controller
 *         -> phnQueue.service -> Supabase
 *
 * Exported routers:
 * 1. Default export (`processing` router, mounted at `/phn`) — shared consultation
 *    queue and clinical/referral mutations:
 *    - Consultation endpoints require `FEATURE_ROLES.consultationProcessing`
 *      (PHN + RHU Personnel + Health Supervisor) AND `authorizeStation(CONSULTATION)`.
 *      PHN always qualifies as a clinical role; RHU Personnel and Health Supervisor
 *      qualify ONLY when assigned to the Consultation station (Triage-only RHU
 *      accounts are refused).
 *    - Referral creation, editing, and snapshot sync remain PHN-only via
 *      `FEATURE_ROLES.phnProcessing` (re-verified in the service layer).
 * 2. Named export (`phnReadsRouter`) — read-only inspection of submissions and
 *    referrals:
 *    - Scoped to `FEATURE_ROLES.referralRecords` and NOT station-gated so Health
 *      Supervisors and MHOs can review completed consultation/referral records.
 *    - `submissionReaders` excludes `rhu_personnel`, and the service layer blocks
 *      non-PHN roles from reading unsubmitted drafts.
 */
const processing = Router();
processing.use(authenticate);

// Station & granular permission guards for consultation queue processing and referral actions.
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
  permission: 'referrals.assign',
});
const referralSnapshotEditors = authorize(FEATURE_ROLES.phnProcessing, { permission: 'referrals.status.update' });

// Maps the target referral status in `req.body` to its corresponding permission:
// `Accepted` -> `referrals.approve`, `Rejected` -> `referrals.reject`, other -> `referrals.status.update`.
const referralStatusEditors = authorize(['phn', 'health_supervisor', 'rhu_personnel'], {
  permission: (req) => {
    const status = (req.body?.referral || req.body?.record || req.body || {}).status;
    return [status === 'Accepted' ? 'referrals.approve' : status === 'Rejected' ? 'referrals.reject' : 'referrals.status.update'];
  },
});

// ---------------------------------------------------------------------------
// Consultation Queue & Encounter Lifecycle (Consultation station gated)
// - GET  /submissions               : Lists consultation queue entries (query filters: status, search, pagination).
// - GET  /consultation-services     : Lists active health services selectable during a consultation encounter.
// - PUT  /submissions/:id           : Updates clinical findings, vitals, diagnosis, or prescriptions in `req.body`.
// - POST /submissions/:id/receive   : Marks submission `:id` as received into the consultation queue.
// - POST /submissions/:id/review    : Transitions submission `:id` to active clinical review.
// - POST /submissions/:id/complete  : Completes consultation `:id` with final disposition/notes in `req.body`.
// ---------------------------------------------------------------------------
processing.get('/submissions', queueReaders, consultationStation, asyncHandler(phnQueueController.listQueue));
processing.get('/submissions/:id/consultation', queueReaders, consultationStation, asyncHandler(phnQueueController.getSubmission));
processing.get(
  '/consultation-services',
  consultationConductors,
  consultationStation,
  asyncHandler(phnQueueController.listConsultationHealthServices),
);
processing.put('/submissions/:id', findingsWriters, consultationStation, asyncHandler(phnQueueController.updateSubmission));
processing.post('/submissions/:id/receive', consultationConductors, consultationStation, asyncHandler(phnQueueController.receiveSubmission));
processing.post('/submissions/:id/review', consultationConductors, consultationStation, asyncHandler(phnQueueController.markInReview));
processing.post('/submissions/:id/complete', consultationConductors, consultationStation,
  (req, res, next) => req.body?.submission !== undefined ? findingsWriters(req, res, next) : next(),
  asyncHandler(phnQueueController.completeSubmission));

// ---------------------------------------------------------------------------
// Referral Mutations
// - POST /submissions/:id/referral : Generates a referral from consultation `:id` (`req.body`; PHN-only).
// - PUT  /referrals/:id            : Updates referral `:id` routing/details (`req.body`; PHN-only).
// - PUT  /referrals/:id/status     : Transitions referral `:id` status (`Accepted`, `Rejected`, etc. in `req.body`).
// - POST /referrals/:id/sync       : Refreshes referral `:id`'s clinical snapshot from its parent submission (PHN-only).
// ---------------------------------------------------------------------------
processing.post('/submissions/:id/referral', referralCreators, asyncHandler(phnQueueController.createReferral));
processing.put('/referrals/:id', referralEditors, asyncHandler(phnQueueController.updateReferral));
processing.put('/referrals/:id/status', referralStatusEditors, asyncHandler(phnQueueController.updateReferralStatus));
processing.post('/referrals/:id/sync', referralSnapshotEditors, asyncHandler(phnQueueController.syncReferral));

// ---------------------------------------------------------------------------
// Read-Only Submission & Referral Inspection Router (`phnReadsRouter`, non-station-gated)
// - GET /submissions/:id          : Fetches full consultation submission `:id` (HS/PHN/MHO; excludes RHU Personnel).
// - GET /submissions/:id/referral : Fetches referral linked to submission/visit `:id`.
// - GET /referrals                : Lists scoped referrals via query filters.
// - GET /referrals/:id            : Fetches single referral `:id`.
// ---------------------------------------------------------------------------
const reads = Router();
reads.use(authenticate);
const submissionReaders = authorize(FEATURE_ROLES.referralRecords.filter((role) => role !== 'rhu_personnel'), {
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
