/**
 * Health check endpoint (public, no authentication required).
 *
 * Returns server readiness status including database connectivity.
 * Used by deployment health probes and load balancers.
 */
import { Router } from 'express';

import * as healthController from '../controllers/health.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(healthController.getHealth));

export default router;
