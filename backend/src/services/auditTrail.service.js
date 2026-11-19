/**
 * Audit Trail Service (`services/auditTrail.service.js`) — real, queryable system activity.
 *
 * Fits into KALUSAGAP's backend pipeline:
 *   `auditTrail.routes -> authenticate -> authorize -> auditTrail.controller -> auditTrail.service -> Supabase service-role client`
 *
 * The Audit Trail page previously rendered only browser-session events
 * (sessionStorage `auditStore` + the localStorage permission matrix), so it
 * showed nothing after a refresh and could never show another user's actions.
 *
 * This service queries the three persistent PostgreSQL audit tables written across KALUSAGAP:
 *   - `public.health_audit_logs`           domain events (record CRUD, clinical/admin decisions)
 *   - `public.resident_verification_logs`  resident self-registration verification workflow
 *   - `public.transfer_request_audit_logs` inter-barangay transfer-of-residency workflow
 *
 * All three streams are merged into a single newest-first timeline with actor
 * identities hydrated from `public.profiles` in one batch query, so approvals,
 * rejections, and record mutations surface with user, role, module, entity, and timestamp.
 *
 * Note: The runtime HTTP request log is distinct and lives in `systemLogs.service.js`.
 */
import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';

const HEALTH_LOGS = 'health_audit_logs';
const VERIFICATION_LOGS = 'resident_verification_logs';
const TRANSFER_LOGS = 'transfer_request_audit_logs';

const RESIDENT_SELECT = 'resident:residents(id, first_name, middle_name, last_name, barangay)';

/**
 * Resolve actor display details for a set of auth user ids.
 *
 * `health_audit_logs.actor_id` and `transfer_request_audit_logs.actor_id`
 * reference `auth.users`, not `profiles`, so PostgREST cannot embed the profile
 * through that column. The ids are identical, so the names are fetched in one
 * extra query and joined here. Any id that no longer has a profile (a deleted
 * account) simply falls back to "System" / "Unknown".
 */
const loadActors = async (supabase, ids) => {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.from('profiles').select('id, full_name, email, role').in('id', unique);
  if (error) return new Map();
  return new Map((data || []).map((p) => [p.id, p]));
};

const throwOnError = (error, fallback) => {
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
};

const nameOf = (profile, fallback = '') => profile?.full_name || profile?.email || fallback || 'System';

/** Normalize a `public.health_audit_logs` row into the unified audit timeline shape. */
const fromHealthLog = (row, actors) => {
  const actor = actors.get(row.actor_id) || null;
  return {
    id: `health:${row.id}`,
    source: 'Health records',
    occurredAt: row.created_at,
    actorId: row.actor_id,
    actorName: nameOf(actor, row.actor_id ? 'Unknown' : 'System'),
    actorRole: actor?.role || '',
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    module: row.entity_type,
    details: row.metadata || {},
  };
};

/**
 * Normalize a `public.resident_verification_logs` row into the unified audit timeline shape,
 * prefixing the action as `RESIDENT_<ACTION>` and formatting the embedded resident's full name.
 */
const fromVerificationLog = (row, actors) => {
  const actor = actors.get(row.reviewed_by) || null;
  return {
    id: `verification:${row.id}`,
    source: 'Resident verification',
    occurredAt: row.created_at,
    actorId: row.reviewed_by,
    actorName: nameOf(actor, row.reviewed_by ? 'Unknown' : 'Resident'),
    actorRole: actor?.role || '',
    action: `RESIDENT_${String(row.action || '').toUpperCase()}`,
    entityType: 'resident_verification',
    entityId: row.resident_id,
    module: 'Resident verification',
    resident: row.resident ? `${[row.resident.first_name, row.resident.middle_name, row.resident.last_name].filter(Boolean).join(' ')}`.trim() : '',
    details: {
      previous_status: row.previous_status,
      new_status: row.new_status,
      reason: row.reason || '',
    },
  };
};

/**
 * Normalize a `public.transfer_request_audit_logs` row into the unified audit timeline shape,
 * prefixing the action as `TRANSFER_<ACTION>`.
 */
const fromTransferLog = (row, actors) => {
  const actor = actors.get(row.actor_id) || null;
  return {
    id: `transfer:${row.id}`,
    source: 'Transfer requests',
    occurredAt: row.created_at,
    actorId: row.actor_id,
    actorName: nameOf(actor, row.actor_id ? 'Unknown' : 'System'),
    actorRole: actor?.role || '',
    action: `TRANSFER_${String(row.action || '').toUpperCase()}`,
    entityType: 'transfer_requests',
    entityId: row.transfer_request_id,
    module: 'Transfer requests',
    details: row.metadata || {},
  };
};

/**
 * Query and merge the unified system audit timeline across `health_audit_logs`,
 * `resident_verification_logs`, and `transfer_request_audit_logs`.
 *
 * Over-fetches `size + skip + 200` rows per source table ordered by `created_at DESC`
 * so post-merge in-memory filtering and `offset`/`limit` pagination remain accurate,
 * and returns dynamic `facets` (`actions`, `modules`, `sources`) for UI filter dropdowns.
 *
 * @param {Object} [options] - Query & pagination parameters
 * @param {Object} options.user - Authenticated caller (required; throws 401 if absent)
 * @param {string} [options.q=''] - Free-text substring search across actor, role, action, module, entity, and resident
 * @param {string} [options.action=''] - Case-insensitive substring filter on `entry.action`
 * @param {string} [options.module=''] - Case-insensitive substring filter on `entry.module`
 * @param {string} [options.role=''] - Exact case-insensitive match on `entry.actorRole`
 * @param {string} [options.from=''] - Inclusive start date (`YYYY-MM-DD`, UTC start-of-day)
 * @param {string} [options.to=''] - Inclusive end date (`YYYY-MM-DD`, UTC end-of-day)
 * @param {number} [options.limit=100] - Page size (clamped to 1..200)
 * @param {number} [options.offset=0] - Zero-based row offset
 * @returns {Promise<Object>} `{ rows, total, facets }` timeline response
 */
export const list = async ({ user, q = '', action = '', module: moduleFilter = '', role = '', from = '', to = '', limit = 100, offset = 0 } = {}) => {
  if (!user) throw ApiError.unauthorized();

  const supabase = getServiceClient();
  const size = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const skip = Math.max(Number(offset) || 0, 0);
  // Over-fetch each source so the merged window is filled after filtering.
  const fetchSize = size + skip + 200;

  const since = from ? new Date(`${from}T00:00:00.000Z`).toISOString() : null;
  const until = to ? new Date(`${to}T23:59:59.999Z`).toISOString() : null;
  const bound = (query) => {
    let q2 = query.gte('created_at', since || '1970-01-01T00:00:00.000Z');
    if (until) q2 = q2.lte('created_at', until);
    return q2;
  };

  const [health, verification, transfer] = await Promise.all([
    bound(supabase.from(HEALTH_LOGS).select('id, actor_id, action, entity_type, entity_id, metadata, created_at'))
      .order('created_at', { ascending: false })
      .limit(fetchSize),
    bound(supabase.from(VERIFICATION_LOGS).select(`id, resident_id, reviewed_by, action, reason, previous_status, new_status, created_at, ${RESIDENT_SELECT}`))
      .order('created_at', { ascending: false })
      .limit(fetchSize),
    bound(supabase.from(TRANSFER_LOGS).select('id, transfer_request_id, actor_id, action, metadata, created_at'))
      .order('created_at', { ascending: false })
      .limit(fetchSize),
  ]);

  throwOnError(health.error, 'Could not load health audit logs');
  throwOnError(verification.error, 'Could not load resident verification logs');
  throwOnError(transfer.error, 'Could not load transfer audit logs');

  const actorMap = await loadActors(
    supabase,
    [
      ...(health.data || []).map((r) => r.actor_id),
      ...(verification.data || []).map((r) => r.reviewed_by),
      ...(transfer.data || []).map((r) => r.actor_id),
    ],
  );

  const merged = [
    ...(health.data || []).map((r) => fromHealthLog(r, actorMap)),
    ...(verification.data || []).map((r) => fromVerificationLog(r, actorMap)),
    ...(transfer.data || []).map((r) => fromTransferLog(r, actorMap)),
  ].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));

  const term = String(q || '').trim().toLowerCase();
  const actionFilter = String(action || '').trim().toLowerCase();
  const moduleFilterLower = String(moduleFilter || '').trim().toLowerCase();
  const roleFilter = String(role || '').trim().toLowerCase();

  const filtered = merged.filter((entry) => {
    if (actionFilter && !entry.action.toLowerCase().includes(actionFilter)) return false;
    if (moduleFilterLower && !entry.module.toLowerCase().includes(moduleFilterLower)) return false;
    if (roleFilter && (entry.actorRole || '').toLowerCase() !== roleFilter) return false;
    if (!term) return true;
    const haystack = [entry.actorName, entry.actorRole, entry.action, entry.module, entry.entityType, entry.entityId, entry.resident]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(term);
  });

  return {
    rows: filtered.slice(skip, skip + size),
    total: filtered.length,
    // Distinct values for the filter controls, taken from the data itself.
    facets: {
      actions: [...new Set(merged.map((e) => e.action).filter(Boolean))].sort(),
      modules: [...new Set(merged.map((e) => e.module).filter(Boolean))].sort(),
      sources: [...new Set(merged.map((e) => e.source).filter(Boolean))].sort(),
    },
  };
};

export default { list };
