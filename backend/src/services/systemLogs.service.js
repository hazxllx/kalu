/**
 * System Log service — the request-level runtime log.
 *
 * Deliberately distinct from the Audit Trail:
 *
 *   Audit Trail (auditTrail.service.js) -> business events: who approved an
 *                                            account, who changed a record
 *   System Log  (this service)          -> technical events: which endpoint was
 *                                            called, by whom, with what result
 *
 * Rows are written by backend/src/middleware/requestLogger.js and stored in
 * public.system_logs. The middleware never records bodies, headers, tokens or
 * query strings, so no personal health data or credential can reach the log.
 */
import { getServiceClient } from '../config/supabase.js';

const TABLE = 'system_logs';

/** Normalise a filesystem-ish path into a stable route group label. */
const moduleOf = (path) => {
  const clean = String(path || '').replace(/^\/api\/?/, '').split('/').filter(Boolean);
  if (!clean.length) return 'root';
  const [head] = clean;
  return head.startsWith(':') ? 'param' : head;
};

/**
 * Append one request to the system log.
 *
 * Fire-and-forget: a logging failure must never affect the response, so this
 * returns void and only reports a problem on the server console.
 */
export const record = async ({ method, path, statusCode, durationMs, actorId, actorRole, requestId }) => {
  try {
    const supabase = getServiceClient();
    const { error } = await supabase.from(TABLE).insert({
      method: String(method || '').slice(0, 10),
      path: String(path || '').slice(0, 300),
      status_code: Number(statusCode) || 0,
      duration_ms: Number(durationMs) || 0,
      actor_id: actorId || null,
      actor_role: String(actorRole || '').slice(0, 40),
      request_id: String(requestId || '').slice(0, 40),
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error(`systemLog: could not record request: ${err?.message}`);
  }
};

/** The system log timeline, newest first. Administrators only. */
export const list = async ({ q = '', status = '', level = '', limit = 100, offset = 0 } = {}) => {
  const supabase = getServiceClient();
  const size = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const skip = Math.max(Number(offset) || 0, 0);
  const fetchSize = size + skip + 200;

  let query = supabase
    .from(TABLE)
    .select('id, occurred_at, method, path, status_code, duration_ms, actor_id, actor_role, request_id, actor:profiles!actor_id(full_name, email, role)')
    .order('occurred_at', { ascending: false })
    .limit(fetchSize);

  const statusFilter = String(status || '').trim();
  if (statusFilter === 'error') query = query.gte('status_code', 400);
  else if (statusFilter === 'success') query = query.lt('status_code', 400);

  const { data, error, count } = await query;
  if (error) {
    throw Object.assign(new Error(error.message || 'Could not load system logs'), { statusCode: 500, details: error });
  }

  const term = String(q || '').trim().toLowerCase();
  const rows = (data || []).map((row) => ({
    id: String(row.id),
    occurredAt: row.occurred_at,
    method: row.method,
    path: row.path,
    module: moduleOf(row.path),
    statusCode: row.status_code,
    outcome: row.status_code >= 500 ? 'Error' : row.status_code >= 400 ? 'Failed' : 'Success',
    durationMs: Number(row.duration_ms) || 0,
    actorId: row.actor_id,
    actorName: row.actor?.full_name || row.actor?.email || (row.actor_id ? 'Unknown' : 'Anonymous'),
    actorRole: row.actor?.role || row.actor_role || '',
    requestId: row.request_id,
  }));

  const filtered = term
    ? rows.filter((r) => [r.method, r.path, r.module, r.actorName, r.actorRole, String(r.statusCode)].join(' ').toLowerCase().includes(term))
    : rows;

  return {
    rows: filtered.slice(skip, skip + size),
    total: count ?? filtered.length,
    facets: {
      modules: [...new Set(rows.map((r) => r.module).filter(Boolean))].sort(),
    },
  };
};

export default { record, list, moduleOf };
