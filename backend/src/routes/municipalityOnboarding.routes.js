import { Router } from 'express';

import * as controller from '../controllers/municipalityOnboarding.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router();

router.post('/', asyncHandler(controller.submit));
router.get('/verification/:token', asyncHandler(controller.verification));
router.post('/verification/:token/decision', asyncHandler(controller.verificationDecision));
router.post('/:reference/resubmit', asyncHandler(controller.resubmit));
router.get('/:reference', asyncHandler(controller.status));
router.get('/', authenticate, authorize([ROLES.MHO, ROLES.PHN]), asyncHandler(controller.list));
router.post('/:reference/decision', authenticate, authorize([ROLES.MHO, ROLES.PHN]), asyncHandler(controller.decide));

export default router;