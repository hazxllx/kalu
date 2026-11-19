import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as riskConfigController from '../controllers/riskConfig.controller.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Resident health-risk scoring configuration routes — authoritative criteria & thresholds.
 *
 * Role in KALUSAGAP:
 * Exposes the ruleset (weighted clinical/demographic risk criteria and Low/Moderate/High
 * cutoff thresholds) that drives automated community health risk stratification,
 * along with an administrative trigger to recalculate risk across resident records.
 *
 * Architectural pipeline:
 *   route -> authenticate -> authorize(roles, permission)
 *         -> riskConfig.controller -> riskConfig.service -> Supabase
 *
 * Security & integrity:
 * Configuration reads are open to `FEATURE_ROLES.riskConfigRead` with analytics or
 * settings permissions; all mutations and batch recalculations require `FEATURE_ROLES.riskConfig`
 * (admin) + `system.settings.manage` and are re-verified + audit-logged in the service.
 * Resident risk is always computed server-side from this configuration — never trusted
 * from client-supplied scores or levels.
 */
const router = Router();

router.use(authenticate);

// GET / : Returns current risk score thresholds and active/configured criteria rules.
router.get(
  '/',
  authorize(FEATURE_ROLES.riskConfigRead, {
    anyPermission: ['reports.analytics.view', 'system.settings.manage'],
  }),
  asyncHandler(riskConfigController.getConfig),
);

// PUT /thresholds : Updates risk tier cutoff boundaries from `req.body` (admin only).
router.put(
  '/thresholds',
  authorize(FEATURE_ROLES.riskConfig, { permission: 'system.settings.manage' }),
  asyncHandler(riskConfigController.updateThresholds),
);

// POST /criteria : Creates or upserts a risk criterion definition (code, label, weight, condition) from `req.body`.
router.post(
  '/criteria',
  authorize(FEATURE_ROLES.riskConfig, { permission: 'system.settings.manage' }),
  asyncHandler(riskConfigController.upsertCriterion),
);

// PUT /criteria/:code : Updates existing risk criterion `:code` using fields in `req.body`.
router.put(
  '/criteria/:code',
  authorize(FEATURE_ROLES.riskConfig, { permission: 'system.settings.manage' }),
  asyncHandler(riskConfigController.upsertCriterion),
);

// DELETE /criteria/:code : Removes risk criterion `:code` from the scoring configuration.
router.delete(
  '/criteria/:code',
  authorize(FEATURE_ROLES.riskConfig, { permission: 'system.settings.manage' }),
  asyncHandler(riskConfigController.deleteCriterion),
);

// POST /recalculate : Recomputes health risk scores and tiers across resident records using current rules.
router.post(
  '/recalculate',
  authorize(FEATURE_ROLES.riskConfig, { permission: 'system.settings.manage' }),
  asyncHandler(riskConfigController.recalculate),
);

export default router;
