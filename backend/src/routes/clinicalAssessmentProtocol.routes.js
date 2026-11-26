// backend/src/routes/clinicalAssessmentProtocol.routes.js
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/clinicalAssessmentProtocol.controller.js';

const router = Router();
router.use(authenticate);
router.put('/approval', authorize(['mho', 'phn']), asyncHandler(controller.approve));
export default router;
