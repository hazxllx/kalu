// backend/src/routes/kalusagap.routes.js
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import idempotency from '../middleware/idempotency.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/kalusagap.controller.js';

/**
 * Maternal Care and Pregnancy Tracking routes in KALUSAGAP.
 *
 * Request pipeline:
 *   route -> authenticate -> resolveBarangayScope -> authorize(roles, permission) -> [idempotency] -> controller -> service -> Supabase
 *
 * Covers the end-to-end maternal health continuum:
 *   1. Pregnancy registration and active-pregnancy pre-checks (`/pregnancies`)
 *   2. Prenatal clinical encounters (`/pregnancies/:id/encounters`)
 *   3. Prenatal preventive services, immunizations, and supplementation (`/pregnancies/:id/services`)
 *   4. Delivery outcome capture and automatic postpartum milestone generation (`/pregnancies/:id/delivery`)
 *   5. Postpartum clinical encounters (`/pregnancies/:id/postpartum-encounters`)
 *   6. Postpartum follow-up milestone tracking (`24h`, `3d`, `7-14d`, `6wk` at `/pregnancies/:id/postpartum-schedule`)
 *   7. Consolidated maternal care profiles and protocol due/overdue alerts (`/maternal-profile/...`, `/pregnancies/:id/services-due`)
 *   8. Maternal care record audit trail (`/maternal-care/audit-log/:pregnancyId`)
 *
 * All routes enforce active authentication and session barangay/municipality scope.
 * Mutating `POST`/`PUT` endpoints include `idempotency` middleware so retries or
 * intermittent clinical network connections never duplicate maternal records. Destructive
 * `DELETE` operations and delivery-record edits are restricted to `admin`.
 */
const router = Router();

// Authorized clinical and administrative staff roles eligible for maternal care workflows.
const staff = ['admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw'];

// Authenticate caller and attach barangay/municipality data scope across all maternal care routes.
router.use(authenticate, resolveBarangayScope);

// ============================================================================
// PREGNANCY REGISTRATION WORKFLOW
// ============================================================================

/**
 * GET /pregnancies/:residentId/check
 * Check if `:residentId` has an existing active pregnancy and retrieve demographic/obstetric autofill data.
 * Middleware: `authorize(staff, { permission: ['pregnancies.view'] })` -> `controller.checkPregnancyStatus`.
 */
router.get(
  '/pregnancies/:residentId/check',
  authorize(staff, { permission: ['pregnancies.view'] }),
  asyncHandler(controller.checkPregnancyStatus),
);

/**
 * POST /pregnancies
 * Register a new pregnancy for a resident (`idempotency` protected).
 * Body: `{ residentId, lmpDate, lmpReliability, gravida, para, socioEconomicStatus }`.
 * Middleware: `authorize(staff, { permission: ['pregnancies.create'] })`, `idempotency` -> `controller.registerPregnancy`.
 */
router.post(
  '/pregnancies',
  authorize(staff, { permission: ['pregnancies.create'] }),
  idempotency,
  asyncHandler(controller.registerPregnancy),
);

/**
 * GET /pregnancies/:id
 * Retrieve pregnancy `:id` details and maternal summary within the caller's barangay/municipality scope.
 * Middleware: `authorize(staff, { permission: ['pregnancies.view'] })` -> `controller.getPregnancy`.
 */
router.get(
  '/pregnancies/:id',
  authorize(staff, { permission: ['pregnancies.view'] }),
  asyncHandler(controller.getPregnancy),
);

/**
 * PUT /pregnancies/:id
 * Update pregnancy `:id` record (e.g., LMP revision, risk level, or pregnancy status; `idempotency` protected).
 * Middleware: `authorize(staff, { permission: ['pregnancies.edit'] })`, `idempotency` -> `controller.updatePregnancy`.
 */
router.put(
  '/pregnancies/:id',
  authorize(staff, { permission: ['pregnancies.edit'] }),
  idempotency,
  asyncHandler(controller.updatePregnancy),
);

// ============================================================================
// PRENATAL ENCOUNTER WORKFLOW
// ============================================================================

/**
 * POST /pregnancies/:id/encounters
 * Record a prenatal clinical visit/encounter for pregnancy `:id` (`idempotency` protected).
 * Body: `{ encounterDate, weight, height, bp, gestationalAge, findings, assessments, ... }`.
 * Middleware: `authorize(staff, { permission: ['encounters.create'] })`, `idempotency` -> `controller.addPrenatalEncounter`.
 */
router.post(
  '/pregnancies/:id/encounters',
  authorize(staff, { permission: ['encounters.create'] }),
  idempotency,
  asyncHandler(controller.addPrenatalEncounter),
);

/**
 * GET /pregnancies/:id/encounters
 * List all recorded prenatal encounters for pregnancy `:id`.
 * Middleware: `authorize(staff, { permission: ['encounters.view'] })` -> `controller.listPrenatalEncounters`.
 */
router.get(
  '/pregnancies/:id/encounters',
  authorize(staff, { permission: ['encounters.view'] }),
  asyncHandler(controller.listPrenatalEncounters),
);

/**
 * GET /pregnancies/:id/encounters/:encounterId
 * Retrieve clinical details of prenatal encounter `:encounterId` under pregnancy `:id`.
 * Middleware: `authorize(staff, { permission: ['encounters.view'] })` -> `controller.getPrenatalEncounter`.
 */
router.get(
  '/pregnancies/:id/encounters/:encounterId',
  authorize(staff, { permission: ['encounters.view'] }),
  asyncHandler(controller.getPrenatalEncounter),
);

/**
 * PUT /pregnancies/:id/encounters/:encounterId
 * Update prenatal encounter `:encounterId` under pregnancy `:id` (`idempotency` protected).
 * Middleware: `authorize(staff, { permission: ['encounters.edit'] })`, `idempotency` -> `controller.updatePrenatalEncounter`.
 */
router.put(
  '/pregnancies/:id/encounters/:encounterId',
  authorize(staff, { permission: ['encounters.edit'] }),
  idempotency,
  asyncHandler(controller.updatePrenatalEncounter),
);

/**
 * DELETE /pregnancies/:id/encounters/:encounterId
 * Delete prenatal encounter `:encounterId` (restricted to `admin` role + `encounters.delete` permission).
 * Handler: `controller.deletePrenatalEncounter`.
 */
router.delete(
  '/pregnancies/:id/encounters/:encounterId',
  authorize(['admin'], { permission: ['encounters.delete'] }),
  asyncHandler(controller.deletePrenatalEncounter),
);

// ============================================================================
// PRENATAL SERVICES WORKFLOW
// ============================================================================

/**
 * POST /pregnancies/:id/services
 * Record a prenatal preventive service (immunization, lab screening, micronutrient supplementation, etc.).
 * Body: `{ serviceCategory, serviceType, serviceName, status, dateProvided, resultStatus, ... }`.
 * Middleware: `authorize(staff, { permission: ['services.create'] })`, `idempotency` -> `controller.recordPrenatalService`.
 */
router.post(
  '/pregnancies/:id/services',
  authorize(staff, { permission: ['services.create'] }),
  idempotency,
  asyncHandler(controller.recordPrenatalService),
);

/**
 * GET /pregnancies/:id/services
 * List prenatal services recorded for pregnancy `:id` (optional query filter: `?status=pending|due|completed|...`).
 * Middleware: `authorize(staff, { permission: ['services.view'] })` -> `controller.listPrenatalServices`.
 */
router.get(
  '/pregnancies/:id/services',
  authorize(staff, { permission: ['services.view'] }),
  asyncHandler(controller.listPrenatalServices),
);

/**
 * GET /pregnancies/:id/services/:serviceId
 * Retrieve details of prenatal service `:serviceId` for pregnancy `:id`.
 * Middleware: `authorize(staff, { permission: ['services.view'] })` -> `controller.getPrenatalService`.
 */
router.get(
  '/pregnancies/:id/services/:serviceId',
  authorize(staff, { permission: ['services.view'] }),
  asyncHandler(controller.getPrenatalService),
);

/**
 * PUT /pregnancies/:id/services/:serviceId
 * Update prenatal service `:serviceId` (e.g., mark completed or record lab result; `idempotency` protected).
 * Middleware: `authorize(staff, { permission: ['services.edit'] })`, `idempotency` -> `controller.updatePrenatalService`.
 */
router.put(
  '/pregnancies/:id/services/:serviceId',
  authorize(staff, { permission: ['services.edit'] }),
  idempotency,
  asyncHandler(controller.updatePrenatalService),
);

/**
 * DELETE /pregnancies/:id/services/:serviceId
 * Delete prenatal service `:serviceId` (restricted to `admin` role + `services.delete` permission).
 * Handler: `controller.deletePrenatalService`.
 */
router.delete(
  '/pregnancies/:id/services/:serviceId',
  authorize(['admin'], { permission: ['services.delete'] }),
  asyncHandler(controller.deletePrenatalService),
);

// ============================================================================
// DELIVERY RECORD WORKFLOW
// ============================================================================

/**
 * POST /pregnancies/:id/delivery
 * Record delivery outcome for pregnancy `:id` and auto-generate the postpartum follow-up milestone schedule.
 * Body: `{ deliveryDate, deliveryOutcome, typeOfDelivery, birthWeight, ... }`.
 * Middleware: `authorize(staff, { permission: ['delivery.create'] })`, `idempotency` -> `controller.recordDelivery`.
 */
router.post(
  '/pregnancies/:id/delivery',
  authorize(staff, { permission: ['delivery.create'] }),
  idempotency,
  asyncHandler(controller.recordDelivery),
);

/**
 * GET /pregnancies/:id/delivery
 * Retrieve the recorded delivery outcome for pregnancy `:id`.
 * Middleware: `authorize(staff, { permission: ['delivery.view'] })` -> `controller.getDeliveryRecord`.
 */
router.get(
  '/pregnancies/:id/delivery',
  authorize(staff, { permission: ['delivery.view'] }),
  asyncHandler(controller.getDeliveryRecord),
);

/**
 * PUT /pregnancies/:id/delivery
 * Amend delivery outcome details for pregnancy `:id` (restricted to `admin` + `delivery.edit`, `idempotency` protected).
 * Handler: `controller.updateDeliveryRecord`.
 */
router.put(
  '/pregnancies/:id/delivery',
  authorize(['admin'], { permission: ['delivery.edit'] }),
  idempotency,
  asyncHandler(controller.updateDeliveryRecord),
);

// ============================================================================
// POSTPARTUM ENCOUNTER WORKFLOW
// ============================================================================

/**
 * POST /pregnancies/:id/postpartum-encounters
 * Record a postpartum visit/encounter for pregnancy `:id` (`idempotency` protected).
 * Body: `{ encounterDate, scheduledMilestone, vitalSigns, assessment, ... }`.
 * Middleware: `authorize(staff, { permission: ['postpartum_encounters.create'] })`, `idempotency` -> `controller.addPostpartumEncounter`.
 */
router.post(
  '/pregnancies/:id/postpartum-encounters',
  authorize(staff, { permission: ['postpartum_encounters.create'] }),
  idempotency,
  asyncHandler(controller.addPostpartumEncounter),
);

/**
 * GET /pregnancies/:id/postpartum-encounters
 * List all postpartum encounters recorded for pregnancy `:id`.
 * Middleware: `authorize(staff, { permission: ['postpartum_encounters.view'] })` -> `controller.listPostpartumEncounters`.
 */
router.get(
  '/pregnancies/:id/postpartum-encounters',
  authorize(staff, { permission: ['postpartum_encounters.view'] }),
  asyncHandler(controller.listPostpartumEncounters),
);

/**
 * GET /pregnancies/:id/postpartum-encounters/:encounterId
 * Retrieve details of postpartum encounter `:encounterId` under pregnancy `:id`.
 * Middleware: `authorize(staff, { permission: ['postpartum_encounters.view'] })` -> `controller.getPostpartumEncounter`.
 */
router.get(
  '/pregnancies/:id/postpartum-encounters/:encounterId',
  authorize(staff, { permission: ['postpartum_encounters.view'] }),
  asyncHandler(controller.getPostpartumEncounter),
);

/**
 * PUT /pregnancies/:id/postpartum-encounters/:encounterId
 * Update postpartum encounter `:encounterId` under pregnancy `:id` (`idempotency` protected).
 * Middleware: `authorize(staff, { permission: ['postpartum_encounters.edit'] })`, `idempotency` -> `controller.updatePostpartumEncounter`.
 */
router.put(
  '/pregnancies/:id/postpartum-encounters/:encounterId',
  authorize(staff, { permission: ['postpartum_encounters.edit'] }),
  idempotency,
  asyncHandler(controller.updatePostpartumEncounter),
);

/**
 * DELETE /pregnancies/:id/postpartum-encounters/:encounterId
 * Delete postpartum encounter `:encounterId` (restricted to `admin` role + `postpartum_encounters.delete` permission).
 * Handler: `controller.deletePostpartumEncounter`.
 */
router.delete(
  '/pregnancies/:id/postpartum-encounters/:encounterId',
  authorize(['admin'], { permission: ['postpartum_encounters.delete'] }),
  asyncHandler(controller.deletePostpartumEncounter),
);

// ============================================================================
// POSTPARTUM FOLLOW-UP SCHEDULE
// ============================================================================

/**
 * GET /pregnancies/:id/postpartum-schedule
 * Retrieve the postpartum follow-up schedule (`24h`, `3d`, `7-14d`, and `6wk` milestones) for pregnancy `:id`.
 * Middleware: `authorize(staff, { permission: ['postpartum_schedule.view'] })` -> `controller.getPostpartumSchedule`.
 */
router.get(
  '/pregnancies/:id/postpartum-schedule',
  authorize(staff, { permission: ['postpartum_schedule.view'] }),
  asyncHandler(controller.getPostpartumSchedule),
);

/**
 * PUT /pregnancies/:id/postpartum-schedule/:milestoneId
 * Update status or completion metadata on postpartum follow-up milestone `:milestoneId` (`idempotency` protected).
 * Middleware: `authorize(staff, { permission: ['postpartum_schedule.edit'] })`, `idempotency` -> `controller.updatePostpartumMilestone`.
 */
router.put(
  '/pregnancies/:id/postpartum-schedule/:milestoneId',
  authorize(staff, { permission: ['postpartum_schedule.edit'] }),
  idempotency,
  asyncHandler(controller.updatePostpartumMilestone),
);

// ============================================================================
// MATERNAL PROFILE & REPORTS
// ============================================================================

/**
 * GET /maternal-profile/:residentId/pregnancies
 * List all active and historical pregnancies recorded for `:residentId` within scope.
 * Middleware: `authorize(staff, { permission: ['pregnancies.view'] })` -> `controller.listResidentPregnancies`.
 */
router.get(
  '/maternal-profile/:residentId/pregnancies',
  authorize(staff, { permission: ['pregnancies.view'] }),
  asyncHandler(controller.listResidentPregnancies),
);

/**
 * GET /maternal-profile/:pregnancyId
 * Retrieve the consolidated maternal care profile for `:pregnancyId` (pregnancy details,
 * prenatal encounters, services, delivery record, and postpartum follow-up info).
 * Middleware: `authorize(staff, { permission: ['pregnancies.view'] })` -> `controller.getMaternalProfile`.
 */
router.get(
  '/maternal-profile/:pregnancyId',
  authorize(staff, { permission: ['pregnancies.view'] }),
  asyncHandler(controller.getMaternalProfile),
);

// ============================================================================
// SERVICE DUE/OVERDUE TRACKING
// ============================================================================

/**
 * GET /pregnancies/:id/services-due
 * Compute and list prenatal/maternal services currently due or overdue for pregnancy `:id` per clinical protocol.
 * Middleware: `authorize(staff, { permission: ['services.view'] })` -> `controller.getServicesDueOrOverdue`.
 */
router.get(
  '/pregnancies/:id/services-due',
  authorize(staff, { permission: ['services.view'] }),
  asyncHandler(controller.getServicesDueOrOverdue),
);

// ============================================================================
// AUDIT LOG
// ============================================================================

/**
 * GET /maternal-care/audit-log/:pregnancyId
 * Retrieve the chronological audit trail for `:pregnancyId` (creation, edits, and status transitions).
 * Middleware: `authorize(staff, { permission: ['audit.view'] })` -> `controller.getMaternalAuditLog`.
 */
router.get(
  '/maternal-care/audit-log/:pregnancyId',
  authorize(staff, { permission: ['audit.view'] }),
  asyncHandler(controller.getMaternalAuditLog),
);

export default router;
