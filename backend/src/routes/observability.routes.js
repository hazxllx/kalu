import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendData } from '../utils/apiResponse.js';
import * as auditTrailService from '../services/auditTrail.service.js';
import * as systemLogsService from '../services/systemLogs.service.js';
import { FEATURE_ROLES } from '../config/roles.js';

/**
 * Administration observability.
 *
 *   GET /api/audit-trail  business events (approvals, record CRUD) — the Audit Trail
 *   GET /api/system-logs  request-level runtime events      — the System Log
 *
 * Both are administrator-only, mirroring the existing `system.audit.view` and
 * `system.activity.view` permission ids in the frontend role matrix. The
 * underlying tables carry their own RLS: health_audit_logs is readable by
 * active staff, system_logs by administrators only.
 */
const router = Router();

router.get(
  '/audit-trail',
  authenticate,
  authorize(FEATURE_ROLES.system),
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

router.get(
  '/system-logs',
  authenticate,
  authorize(FEATURE_ROLES.system),
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
