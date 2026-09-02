import { Router } from 'express';

import * as healthController from '../controllers/health.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(healthController.getHealth));

export default router;
