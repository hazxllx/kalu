/**
 * Public system health check route (`/api/health`).
 *
 * Request pipeline:
 *   route -> controller -> Supabase connectivity check (no `authenticate` or `authorize`)
 *
 * Deliberately bypasses authentication and RBAC middleware so deployment probes,
 * uptime monitors, and load balancers can verify API process liveness and
 * database readiness.
 */
import { Router } from 'express';

import * as healthController from '../controllers/health.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router();

// GET /api/health — Public readiness probe returning API uptime and database status (`healthController.getHealth`).
router.get('/', asyncHandler(healthController.getHealth));

export default router;
