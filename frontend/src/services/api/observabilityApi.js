import { api } from './apiClient';

/**
 * Administration observability API.
 *
 * `auditTrailApi` and `systemLogsApi` are deliberately separate features, not
 * two views of the same data:
 *
 *   Audit Trail  business events — account approvals, rejections, record
 *                creation / update / deletion. Backed by health_audit_logs +
 *                the resident-verification and transfer audit tables.
 *   System Log   request-level runtime events — method, path, status, duration,
 *                acting role. Backed by system_logs, written by the API's
 *                request logger.
 *
 * Both are administrator-only.
 */
export const auditTrailApi = {
  /** @param {{q?, action?, module?, role?, from?, to?, limit?, offset?}} params */
  list: (params) => api.get('/audit-trail', { params }),
};

export const systemLogsApi = {
  /** @param {{q?, status?, limit?, offset?}} params — status: all|success|error */
  list: (params) => api.get('/system-logs', { params }),
};

export default { auditTrailApi, systemLogsApi };
