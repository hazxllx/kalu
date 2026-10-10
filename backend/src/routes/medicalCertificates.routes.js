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
 * Medical certificate register.
 *
 * READ + CREATE (`request` chain): PHN and MHO always; a Triage-station RHU
 * Personnel may additionally READ and INITIATE a certificate REQUEST — the
 * `authorizeStation(TRIAGE)` gate admits RHU only with the Triage station, and
 * the service forces the request status ('For Review') and withholds the
 * signatory. A Consultation-only RHU account is refused here.
 *
 * REVIEW/EDIT (`decision` chain): PHN and MHO only. RHU Personnel can never
 * update, approve, issue or reject — those routes keep `FEATURE_ROLES.certificates`
 * (PHN, MHO) and are the authoritative decision boundary alongside the DB
 * decision guard. BHW and System Admin receive 403 everywhere.
 */
const router = Router();

const decision = [authenticate, authorize(FEATURE_ROLES.certificates)];
const request = [
  authenticate,
  authorize(FEATURE_ROLES.certificateRequest),
  authorizeStation(RHU_STATIONS.TRIAGE),
];
const idParam = validate(certificateIdParamValidator, 'params');

// Specific paths before '/:id'.
router.get('/meta', ...request, asyncHandler(controller.meta));
router.get('/next-reference', ...request, asyncHandler(controller.reference));

router.get('/', ...request, asyncHandler(controller.list));
router.get('/:id', ...request, idParam, asyncHandler(controller.get));

router.post('/', ...request, validate(createCertificateValidator), asyncHandler(controller.create));
router.put('/:id', ...decision, idParam, validate(updateCertificateValidator), asyncHandler(controller.update));
router.patch('/:id/status', ...decision, idParam, validate(changeStatusValidator), asyncHandler(controller.changeStatus));

export default router;
