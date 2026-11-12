import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import idempotency from '../middleware/idempotency.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/kalusagap.controller.js';

const router = Router();
const staff = ['admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw'];

router.use(authenticate, resolveBarangayScope);

// ============================================================================
// PREGNANCY REGISTRATION WORKFLOW
// ============================================================================

/**
 * GET /pregnancies/:residentId/check
 * Check if resident has an existing active pregnancy and retrieve autofill data.
 */
router.get(
  '/pregnancies/:residentId/check',
  authorize(staff, { permission: ['pregnancies.view'] }),
  asyncHandler(controller.checkPregnancyStatus),
);

/**
 * POST /pregnancies
 * Register a new pregnancy for a resident.
 * Body: { residentId, lmpDate, lmpReliability, gravida, para, socioEconomicStatus }
 */
router.post(
  '/pregnancies',
  authorize(staff, { permission: ['pregnancies.create'] }),
  idempotency,
  asyncHandler(controller.registerPregnancy),
);

/**
 * GET /pregnancies/:id
 * Get pregnancy details and consolidated maternal profile.
 */
router.get(
  '/pregnancies/:id',
  authorize(staff, { permission: ['pregnancies.view'] }),
  asyncHandler(controller.getPregnancy),
);

/**
 * PUT /pregnancies/:id
 * Update pregnancy record (e.g., change LMP, update risk level, change status).
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
 * Record a prenatal visit/encounter.
 * Body: { encounterDate, weight, height, bp, gestationalAge, findings, assessments, ... }
 */
router.post(
  '/pregnancies/:id/encounters',
  authorize(staff, { permission: ['encounters.create'] }),
  idempotency,
  asyncHandler(controller.addPrenatalEncounter),
);

/**
 * GET /pregnancies/:id/encounters
 * List all prenatal encounters for a pregnancy.
 */
router.get(
  '/pregnancies/:id/encounters',
  authorize(staff, { permission: ['encounters.view'] }),
  asyncHandler(controller.listPrenatalEncounters),
);

/**
 * GET /pregnancies/:id/encounters/:encounterId
 * Get details of a specific prenatal encounter.
 */
router.get(
  '/pregnancies/:id/encounters/:encounterId',
  authorize(staff, { permission: ['encounters.view'] }),
  asyncHandler(controller.getPrenatalEncounter),
);

/**
 * PUT /pregnancies/:id/encounters/:encounterId
 * Update a prenatal encounter record.
 */
router.put(
  '/pregnancies/:id/encounters/:encounterId',
  authorize(staff, { permission: ['encounters.edit'] }),
  idempotency,
  asyncHandler(controller.updatePrenatalEncounter),
);

/**
 * DELETE /pregnancies/:id/encounters/:encounterId
 * Delete a prenatal encounter (admin only).
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
 * Record a prenatal service (immunization, screening, supplementation, etc.).
 * Body: { serviceCategory, serviceType, serviceName, status, dateProvided, resultStatus, ... }
 */
router.post(
  '/pregnancies/:id/services',
  authorize(staff, { permission: ['services.create'] }),
  idempotency,
  asyncHandler(controller.recordPrenatalService),
);

/**
 * GET /pregnancies/:id/services
 * List all prenatal services for a pregnancy.
 * Query params: ?status=pending|due|completed|...
 */
router.get(
  '/pregnancies/:id/services',
  authorize(staff, { permission: ['services.view'] }),
  asyncHandler(controller.listPrenatalServices),
);

/**
 * GET /pregnancies/:id/services/:serviceId
 * Get details of a specific prenatal service.
 */
router.get(
  '/pregnancies/:id/services/:serviceId',
  authorize(staff, { permission: ['services.view'] }),
  asyncHandler(controller.getPrenatalService),
);

/**
 * PUT /pregnancies/:id/services/:serviceId
 * Update a prenatal service record (e.g., mark as completed, change result).
 */
router.put(
  '/pregnancies/:id/services/:serviceId',
  authorize(staff, { permission: ['services.edit'] }),
  idempotency,
  asyncHandler(controller.updatePrenatalService),
);

/**
 * DELETE /pregnancies/:id/services/:serviceId
 * Delete a prenatal service (admin only).
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
 * Record delivery outcome and auto-generate postpartum follow-up schedule.
 * Body: { deliveryDate, deliveryOutcome, typeOfDelivery, birthWeight, ... }
 */
router.post(
  '/pregnancies/:id/delivery',
  authorize(staff, { permission: ['delivery.create'] }),
  idempotency,
  asyncHandler(controller.recordDelivery),
);

/**
 * GET /pregnancies/:id/delivery
 * Get delivery record for a pregnancy.
 */
router.get(
  '/pregnancies/:id/delivery',
  authorize(staff, { permission: ['delivery.view'] }),
  asyncHandler(controller.getDeliveryRecord),
);

/**
 * PUT /pregnancies/:id/delivery
 * Update delivery record (admin only).
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
 * Record a postpartum visit/encounter.
 * Body: { encounterDate, scheduledMilestone, vitalSigns, assessment, ... }
 */
router.post(
  '/pregnancies/:id/postpartum-encounters',
  authorize(staff, { permission: ['postpartum_encounters.create'] }),
  idempotency,
  asyncHandler(controller.addPostpartumEncounter),
);

/**
 * GET /pregnancies/:id/postpartum-encounters
 * List all postpartum encounters for a pregnancy.
 */
router.get(
  '/pregnancies/:id/postpartum-encounters',
  authorize(staff, { permission: ['postpartum_encounters.view'] }),
  asyncHandler(controller.listPostpartumEncounters),
);

/**
 * GET /pregnancies/:id/postpartum-encounters/:encounterId
 * Get details of a specific postpartum encounter.
 */
router.get(
  '/pregnancies/:id/postpartum-encounters/:encounterId',
  authorize(staff, { permission: ['postpartum_encounters.view'] }),
  asyncHandler(controller.getPostpartumEncounter),
);

/**
 * PUT /pregnancies/:id/postpartum-encounters/:encounterId
 * Update a postpartum encounter record.
 */
router.put(
  '/pregnancies/:id/postpartum-encounters/:encounterId',
  authorize(staff, { permission: ['postpartum_encounters.edit'] }),
  idempotency,
  asyncHandler(controller.updatePostpartumEncounter),
);

/**
 * DELETE /pregnancies/:id/postpartum-encounters/:encounterId
 * Delete a postpartum encounter (admin only).
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
 * Get postpartum follow-up schedule (24h, 3d, 7-14d, 6wk milestones).
 */
router.get(
  '/pregnancies/:id/postpartum-schedule',
  authorize(staff, { permission: ['postpartum_schedule.view'] }),
  asyncHandler(controller.getPostpartumSchedule),
);

/**
 * PUT /pregnancies/:id/postpartum-schedule/:milestoneId
 * Update postpartum follow-up milestone status (mark as completed, etc.).
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
 * GET /maternal-profile/:residendId/pregnancies
 * List all pregnancies for a resident (active and historical).
 */
router.get(
  '/maternal-profile/:residentId/pregnancies',
  authorize(staff, { permission: ['pregnancies.view'] }),
  asyncHandler(controller.listResidentPregnancies),
);

/**
 * GET /maternal-profile/:pregnancyId
 * Get consolidated maternal care profile for a pregnancy.
 * Returns: pregnancy details, encounters, services, delivery, postpartum info.
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
 * GET /pregnancies/:id/services/due
 * Get list of services that are due or overdue based on clinical protocols.
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
 * Get audit trail for a pregnancy (created, updated, status changes).
 */
router.get(
  '/maternal-care/audit-log/:pregnancyId',
  authorize(staff, { permission: ['audit.view'] }),
  asyncHandler(controller.getMaternalAuditLog),
);

export default router;
