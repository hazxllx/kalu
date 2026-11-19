import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendData } from '../utils/apiResponse.js';
import * as auditTrailService from '../services/auditTrail.service.js';
import * as systemLogsService from '../services/systemLogs.service.js';
import { FEATURE_ROLES } from '../config/roles.js';

/**
 * Administration observability routes (Audit Trail & System Logs).
 *
 * Role in KALUSAGAP:
 * Provides read-only administrative visibility into domain-level business audits
 * (`public.health_audit_logs` — approvals, clinical/account CRUD) and HTTP/runtime
 * request telemetry (`public.system_logs`).
 *
 * Architectural pipeline:
 *   route -> authenticate -> authorize(FEATURE_ROLES.system, permission)
 *         -> inline controller handler -> auditTrail/systemLogs.service -> Supabase
 *
 * Security & RLS:
 * Both endpoints are restricted to system administrators (`FEATURE_ROLES.system`),
 * enforcing `system.audit.view` and `system.activity.view` from the role-permission
 * matrix. Underlying tables also enforce RLS (`health_audit_logs` readable by active
 * staff for scoped history views; `system_logs` restricted to administrators only).
 */
const router = Router();

/**
 * GET /audit-trail
 * Lists paginated business audit events (`system.audit.view`).
 * Query parameters:
 * - `q`      : Free-text search across actor, target, or summary
 * - `action` : Exact action type filter
 * - `module` : Subsystem/module filter
 * - `role`   : Actor role filter
 * - `from` / `to` : ISO date/timestamp range bounds
 * - `limit` / `offset` : Pagination controls
 * Passes `req.user` + query filters to `auditTrailService.list` and returns via `sendData`.
 */
router.get(
  '/audit-trail',
  authenticate,
  authorize(FEATURE_ROLES.system, { permission: 'system.audit.view' }),
  asyncHandler(async (req, res) => {
    const result = await auditTrailService.list({
      user: req.user,
      q: req.query.q,
      action: req.query.action,
      module: req.query.module,
      role: req.query.role,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    sendData(res, result);
  }),
);

/**
 * GET /system-logs
 * Lists paginated runtime/request telemetry entries (`system.activity.view`).
 * Query parameters:
 * - `q`      : Free-text search across path, message, or request metadata
 * - `status` : HTTP status / severity filter
 * - `limit` / `offset` : Pagination controls
 * Delegates to `systemLogsService.list` and returns the result via `sendData`.
 */
router.get(
  '/system-logs',
  authenticate,
  authorize(FEATURE_ROLES.system, { permission: 'system.activity.view' }),
  asyncHandler(async (req, res) => {
    const result = await systemLogsService.list({
      q: req.query.q,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    sendData(res, result);
  }),
);

export default router;
