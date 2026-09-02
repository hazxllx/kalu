import { Router } from 'express';

import { FEATURE_ROLES } from '../config/roles.js';
import authRoutes from './auth.routes.js';
import healthRoutes from './health.routes.js';
import intakeRoutes from './intake.routes.js';
import phnRoutes, { phnReadsRouter } from './phnQueue.routes.js';
import residentsRoutes from './residents.routes.js';
import createResourceRouter from '../utils/resourceRouter.js';

/**
 * API route index — every endpoint is mounted here under `/api`.
 *
 * Request flow for every resource:
 *   route -> authenticate -> authorize(roles) -> controller -> service -> data
 *
 * `/api/health` is public. `/api/auth/*` handles authentication (Supabase Auth
 * when configured; a local dev session otherwise). The resident -> RHU -> PHN
 * workflow lives under `/api/intake` and `/api/phn`. Remaining groups keep the
 * generic resource router (501) until their verified schema is connected.
 */
const router = Router();

// Public
router.use('/health', healthRoutes);

// Authentication
router.use('/auth', authRoutes);

// Resident -> RHU -> PHN submission workflow
router.use('/intake', intakeRoutes);          // BHW / RHU personnel intake
router.use('/phn', phnRoutes);                // PHN processing (queue, referrals)
router.use('/phn', phnReadsRouter);           // authorized read-only review

// Master resident records (PHN / Health Supervisor / MHO)
router.use('/residents', residentsRoutes);

// Account / system administration
router.use('/users', createResourceRouter('users', { readRoles: FEATURE_ROLES.users }));

// Community data collection (BHW)
router.use('/households', createResourceRouter('households', { readRoles: FEATURE_ROLES.households, writeRoles: FEATURE_ROLES.dataCollection }));

// Legacy clinical resources — schema not connected yet (501).
router.use('/health-records', createResourceRouter('health-records', { readRoles: FEATURE_ROLES.healthRecords }));
router.use('/assessments', createResourceRouter('assessments', { readRoles: FEATURE_ROLES.assessments }));
router.use('/consultations', createResourceRouter('consultations', { readRoles: FEATURE_ROLES.consultations }));
router.use('/triage', createResourceRouter('triage', { readRoles: FEATURE_ROLES.triage }));
router.use('/referrals', createResourceRouter('referrals', { readRoles: FEATURE_ROLES.referralRecords }));
router.use('/follow-ups', createResourceRouter('follow-ups', { readRoles: FEATURE_ROLES.followUps }));

// Monitoring / aggregate information
router.use('/reports', createResourceRouter('reports', { readRoles: FEATURE_ROLES.reports }));
router.use('/analytics', createResourceRouter('analytics', { readRoles: FEATURE_ROLES.analytics }));

// Cross-cutting
router.use('/notifications', createResourceRouter('notifications', { readRoles: FEATURE_ROLES.notifications }));

export default router;
