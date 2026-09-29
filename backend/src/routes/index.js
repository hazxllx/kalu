import { Router } from 'express';

import { FEATURE_ROLES } from '../config/roles.js';
import authRoutes from './auth.routes.js';
import healthRoutes from './health.routes.js';
import intakeRoutes from './intake.routes.js';
import phnRoutes, { phnReadsRouter } from './phnQueue.routes.js';
import residentsRoutes from './residents.routes.js';
import registrationRoutes from './registration.routes.js';
import staffAccountsRoutes from './staffAccounts.routes.js';
import medicalCertificatesRoutes from './medicalCertificates.routes.js';
import observabilityRoutes from './observability.routes.js';
import householdsRoutes from './households.routes.js';
import analyticsRoutes from './analytics.routes.js';
import verificationsRoutes from './verifications.routes.js';
import documentsRoutes from './documents.routes.js';
import transferRoutes from './transfer.routes.js';
import consultationsRoutes from './consultations.routes.js';
import operationalRoutes from './operational.routes.js';
import residentFollowupsRoutes from './residentFollowups.routes.js';
import referralsRoutes from './referrals.routes.js';
import m1Routes from './m1.routes.js';
import usersRoutes from './users.routes.js';
import reportsRoutes from './reports.routes.js';
import healthServicesRoutes from './healthServices.routes.js';
import rolesRoutes from './roles.routes.js';
import municipalSubmissionsRoutes from './municipalSubmissions.routes.js';
import createResourceRouter from '../utils/resourceRouter.js';

/**
 * API route index — every endpoint is mounted here under `/api`.
 *
 * Request flow for every resource:
 *   route -> authenticate -> authorize(roles) -> controller -> service -> data
 *
 * `/api/health` is public. Authentication uses Supabase Auth; protected routes
 * verify the token and load the active application profile. Database-backed
 * workflows are mounted below; legacy resource groups return 501 until their
 * storage is connected.
 */
const router = Router();

// Public
router.use('/health', healthRoutes);

// Authentication
router.use('/auth', authRoutes);

// Resident self-registration (creates the linked residents row; the Supabase
// Auth account is created client-side by supabase.auth.signUp).
router.use('/registration', registrationRoutes);
router.use('/consultations', consultationsRoutes);
router.use('/operational', operationalRoutes);

// Personnel registration + operational account verification.
//   POST /staff-accounts/register                 public registration
//   GET  /staff-accounts/queue, /:id/approve ...  PHN + Health Supervisor only
router.use('/staff-accounts', staffAccountsRoutes);

// Medical certificate register (RHU Personnel prepare, PHN/MHO review).
router.use('/medical-certificates', medicalCertificatesRoutes);

// Administration observability — Audit Trail (business events) and System Log
// (request-level events). Both are backed by real database tables.
router.use(observabilityRoutes);

// Resident self-service follow-ups (list/read own + approve/reject). Separate
// from the staff /operational endpoints; ownership is derived from the session.
router.use('/resident', residentFollowupsRoutes);

// Referral coordination — real Supabase-backed workflow (health_referrals):
// barangay-scoped create/list/update/status/delete for Health Supervisor / PHN,
// resident read of their own referrals.
router.use('/referrals', referralsRoutes);

// FHSIS M1 monthly report — barangay-scoped recording + aggregation over the
// existing health records (public.m1_records + immunizations/households/mortality).
router.use('/m1', m1Routes);

// Resident -> RHU -> PHN submission workflow
router.use('/intake', intakeRoutes);          // BHW / RHU personnel intake
router.use('/phn', phnRoutes);                // PHN processing (queue, referrals)
router.use('/phn', phnReadsRouter);           // authorized read-only review

// Master resident records (PHN / Health Supervisor / MHO)
router.use('/residents', residentsRoutes);

// Resident verification review (Health Supervisor / PHN, barangay-scoped)
router.use('/verifications', verificationsRoutes);

// Account / system administration — Admin User Management (admin-only): real
// Supabase-backed reads + role/status/profile updates on the `profiles` table.
router.use('/users', usersRoutes);

// Role & permission matrix (BUG-011) — authoritative access-control config in
// public.role_permissions. Read by any staff (drives UI), written by admins.
router.use('/roles', rolesRoutes);

// MHO municipal submission review (BUG-010) — persistent review decisions in
// public.municipal_submission_reviews (MHO-only writes, municipality-scoped).
router.use('/municipal-submissions', municipalSubmissionsRoutes);

// Household Profiling — real Supabase-backed workflow: BHW
// collection, Health Supervisor verification, server-computed risk.
router.use('/households', householdsRoutes);

// Legacy clinical resources — schema not connected yet (501).
router.use('/health-records', createResourceRouter('health-records', { readRoles: FEATURE_ROLES.healthRecords }));
router.use('/assessments', createResourceRouter('assessments', { readRoles: FEATURE_ROLES.assessments }));
router.use('/consultations', createResourceRouter('consultations', { readRoles: FEATURE_ROLES.consultations }));
router.use('/triage', createResourceRouter('triage', { readRoles: FEATURE_ROLES.triage }));
// Follow-ups are served by the real operational router at
// `/operational/followups` (follow_ups table). No standalone `/follow-ups`
// mount: it would only shadow the real endpoint with a misleading 501.

// Monitoring / aggregate information
// Report submission workflow — real Supabase-backed table (public.reports):
// role-routed delivery (PHN -> MHO, Health Supervisor -> RHU) with per-recipient
// scope and notifications. Replaces the previous 501 stub.
router.use('/reports', reportsRoutes);

// Health services catalog + personnel assignment — real Supabase-backed tables
// (public.health_services + public.health_service_assignments). Scoped by
// municipality/facility/barangay; an assigned service follows the assignee.
router.use('/health-services', healthServicesRoutes);

// Early Warning analytics — barangay scope enforced from the session
router.use('/analytics', analyticsRoutes);

// Resident document upload and review
router.use(documentsRoutes);
router.use(transferRoutes);

// Notifications are served by the real operational router at
// `/operational/notifications` (notifications table), which enforces
// per-recipient scope. No standalone `/notifications` mount: it would only
// shadow the real endpoint with a misleading 501.

export default router;
