import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import authorizeStation from '../middleware/authorizeStation.js';
import validate from '../middleware/validate.js';
import { FEATURE_ROLES } from '../config/roles.js';
import { RHU_STATIONS } from '../config/rhuStations.js';
import {
  certificateIdParamValidator,
  changeStatusValidator,
  createCertificateValidator,
  updateCertificateValidator,
} from '../validators/medicalCertificates.validators.js';
import * as controller from '../controllers/medicalCertificates.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Medical certificate register routes.
 *
 * Role in KALUSAGAP:
 * Manages municipal medical certificate requests, clinical drafting, reference
 * numbering, and authoritative approval/issuance workflows at the RHU/MHO level.
 *
 * Architectural pipeline:
 *   route -> authenticate -> authorize -> [authorizeStation] -> [validate]
 *         -> medicalCertificates.controller -> medicalCertificates.service -> Supabase
 *
 * Access-control tiers:
 * - READ operations (`read` chain): PHN, MHO, and RHU Personnel (`certificateRequest`
 *   + `certificates.request` permission) may read certificates in their municipality
 *   scope. No station gate is applied on reads.
 * - CREATE/REQUEST operations (`request` chain): PHN and MHO always qualify; a
 *   Triage-station RHU Personnel may INITIATE a certificate REQUEST via POST.
 *   `authorizeStation(TRIAGE)` admits RHU Personnel only when assigned to Triage,
 *   while the service forces status `'For Review'` and withholds the signatory.
 *   Consultation-only RHU accounts are refused here.
 * - REVIEW/EDIT operations (`decision` chain): PHN and MHO only (`FEATURE_ROLES.certificates`).
 *   RHU Personnel can never update, approve, issue, or reject — this forms the
 *   authoritative decision boundary alongside the database decision guard.
 *   BHW and System Admin receive 403 on all routes.
 */
const router = Router();

const read = [
  authenticate,
  authorize(FEATURE_ROLES.certificateRequest, { permission: 'certificates.request' }),
];
const decision = [authenticate, authorize(FEATURE_ROLES.certificates)];
const request = [
  authenticate,
  authorize(FEATURE_ROLES.certificateRequest, { permission: 'certificates.request' }),
  authorizeStation(RHU_STATIONS.TRIAGE),
];
const idParam = validate(certificateIdParamValidator, 'params');

// Reference & helper endpoints (registered before '/:id' so literal segments are not captured as IDs):
// - GET /meta           : Returns certificate form metadata (types, statuses, signatories) for the caller's municipality.
// - GET /next-reference : Previews the next sequential certificate reference code.
router.get('/meta', ...read, asyncHandler(controller.meta));
router.get('/next-reference', ...read, asyncHandler(controller.reference));

// Certificate listing & detail reads (`read` chain):
// - GET /    : Lists certificates in the caller's municipality; supports query filters (search, status, pagination).
// - GET /:id : Reads a single certificate by validated `:id` param (`certificateIdParamValidator`).
router.get('/', ...read, asyncHandler(controller.list));
router.get('/:id', ...read, idParam, asyncHandler(controller.get));

// Certificate intake & clinical decision mutations:
// - POST  /           : Initiates a request (Triage RHU) or creates a certificate (PHN/MHO) from `createCertificateValidator` body.
// - PUT   /:id        : Updates clinical details/purpose on certificate `:id` (`decision` chain, `updateCertificateValidator` body).
// - PATCH /:id/status : Transitions status (e.g., approve, issue, reject) for `:id` (`decision` chain, `changeStatusValidator` body).
router.post('/', ...request, validate(createCertificateValidator), asyncHandler(controller.create));
router.put('/:id', ...decision, idParam, validate(updateCertificateValidator), asyncHandler(controller.update));
router.patch('/:id/status', ...decision, idParam, validate(changeStatusValidator), asyncHandler(controller.changeStatus));

export default router;
