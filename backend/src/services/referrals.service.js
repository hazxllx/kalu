import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';
import { assignedBarangay } from '../config/scope.js';

/**
 * Health Supervisor referral coordination service.
 *
 * Backs public.health_referrals (see
 * supabase/migrations/20260923100000_health_supervisor_referrals.sql): the
 * barangay-scoped referral workflow where a Health Supervisor / PHN refers a
 * resident to the RHU or a higher-level facility/service and tracks it through
 * to completion.
 *
 * SECURITY MODEL (defense in depth):
 *   - authenticate + authorize middleware gate the route by session + role,
 *   - every read is filtered to the caller's barangay/municipality scope HERE,
 *     never trusting a client-supplied barangay/resident id,
 *   - a resident only ever sees referrals linked to their own account,
 *   - Supabase RLS mirrors the same boundary for any direct token access.
 *
 * The service uses the service-role client (RLS-bypassing) but is only reached
 * after the middleware pipeline has run. `supabase` is injectable so the unit
 * tests can drive it without a live database.
 */

const TABLE = 'health_referrals';

// Roles allowed to create / mutate referrals (barangay/municipality scoped).
const WRITE_ROLES = new Set(['health_supervisor', 'phn']);
// Municipality-wide staff that may READ referrals. RHU Personnel is not part
// of the referral workflow, so it is deliberately absent here, in the Express
// route gate and in the health_referrals RLS policy.
const MUNICIPALITY_ROLES = new Set(['mho', 'phn']);
// Barangay-scoped staff.
const BARANGAY_ROLES = new Set(['health_supervisor']);
const RESIDENT_ROLES = new Set(['resident', 'resident-limited']);

const VALID_STATUSES = ['Pending', 'Accepted', 'In Progress', 'Completed', 'Cancelled'];
const VALID_PRIORITIES = ['Low', 'Medium', 'High'];

/**
 * The resident columns every referral response embeds.
 *
 * READ and WRITE responses MUST share this list. The create/update/status
 * endpoints used to return `.select('*')` with no embed, so the frontend
 * mapper (which reads `row.resident.first_name`) fell back to a placeholder
 * name and silently overwrote the correct resident name in the table after any
 * edit. One constant keeps the payload identical on every path.
 */
const RESIDENT_EMBED =
  'resident:residents(id, first_name, middle_name, last_name, barangay, sex, birth_date, auth_user_id, municipality_id)';
const REFERRAL_SELECT = `*, ${RESIDENT_EMBED}`;

const text = (v) => String(v ?? '').trim();
const throwOnError = (error, fallback) => {
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
};

const assertWriter = (user) => {
  if (!WRITE_ROLES.has(user?.role)) {
    throw ApiError.forbidden('You are not authorized to manage referrals.');
  }
};

/**
 * Resolve the resident referenced by an operation and confirm it is inside the
 * caller's barangay/municipality scope. Returns the resident row, or throws
 * 404 (so an out-of-scope resident is indistinguishable from a missing one and
 * cannot be probed). Never trusts a client-supplied barangay.
 */
const residentInScope = async (supabase, user, residentId) => {
  const id = text(residentId);
  if (!id) throw ApiError.badRequest('A resident is required for a referral.');
  const { data, error } = await supabase
    .from('residents')
    .select('id, barangay, barangay_id, municipality_id, auth_user_id')
    .eq('id', id)
    .maybeSingle();
  throwOnError(error, 'Could not load resident');
  if (!data) throw ApiError.notFound('Resident record not found.');

  const scope = assignedBarangay(user); // barangay NAME for HS/BHW, else null
  const outOfBarangay = scope && text(data.barangay).toLowerCase() !== text(scope).toLowerCase();
  const outOfMunicipality = user.municipalityId && data.municipality_id && user.municipalityId !== data.municipality_id;
  if (outOfBarangay || outOfMunicipality) throw ApiError.notFound('Resident record not found.');
  return data;
};

/** Resident-facing notification copy (deliberately free of clinical detail). */
const notificationFor = (action, record) => {
  const where = record?.destination_facility ? ` to ${record.destination_facility}` : '';
  switch (action) {
    case 'created':
      return { category: 'information', title: 'Referral created', message: `A health worker referred you${where}.` };
    case 'accepted':
      return { category: 'information', title: 'Referral accepted', message: 'Your referral has been accepted.' };
    case 'completed':
      return { category: 'information', title: 'Referral completed', message: 'Your referral has been completed.' };
    case 'cancelled':
      return { category: 'information', title: 'Referral cancelled', message: 'A referral was cancelled.' };
    default:
      return null;
  }
};

const notifyResident = async (supabase, resident, action, record) => {
  if (!resident?.auth_user_id) return;
  const payload = notificationFor(action, record);
  if (!payload) return;
  const { error } = await supabase.from('notifications').insert({
    recipient_id: resident.auth_user_id,
    category: payload.category,
    title: payload.title,
    message: payload.message,
    related_type: TABLE,
    related_id: record.id,
  });
  // A notification failure must not roll back the referral action itself; it is
  // logged by the caller's error handler only when it is the primary error.
  throwOnError(error, 'Could not create notification');
};

const audit = async (supabase, user, action, entityId, resident, metadata = {}) => {
  const { error } = await supabase.from('health_audit_logs').insert({
    actor_id: user.id,
    action,
    entity_type: TABLE,
    entity_id: entityId,
    municipality_id: resident?.municipality_id || null,
    barangay_id: resident?.barangay_id || null,
    metadata,
  });
  throwOnError(error, 'Could not write audit log');
};

/** Map the resident's own account id -> resident row (for the resident view). */
const ownResident = async (supabase, user) => {
  const { data, error } = await supabase
    .from('residents')
    .select('id, auth_user_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  throwOnError(error, 'Could not load resident record');
  return data || null;
};

/**
 * List referrals visible to the caller. Scope is enforced server-side:
 *   health_supervisor / bhw     -> own barangay
 *   mho / phn / rhu_personnel   -> own municipality
 *   resident                    -> only their own referrals
 */
export const list = async ({ user, residentId = null, status = null, supabase = getServiceClient() }) => {
  let query = supabase.from(TABLE).select(REFERRAL_SELECT).order('created_at', { ascending: false }).limit(200);

  if (RESIDENT_ROLES.has(user?.role)) {
    const mine = await ownResident(supabase, user);
    if (!mine) return [];
    query = query.eq('resident_id', mine.id);
  } else if (BARANGAY_ROLES.has(user?.role)) {
    if (!user.barangayId) return [];
    query = query.eq('barangay_id', user.barangayId);
    if (residentId) { await residentInScope(supabase, user, residentId); query = query.eq('resident_id', residentId); }
  } else if (MUNICIPALITY_ROLES.has(user?.role)) {
    if (!user.municipalityId) return [];
    query = query.eq('municipality_id', user.municipalityId);
    if (residentId) { await residentInScope(supabase, user, residentId); query = query.eq('resident_id', residentId); }
  } else if (user?.role !== 'admin') {
    throw ApiError.forbidden('You are not authorized to view referrals.');
  }

  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  throwOnError(error, 'Could not load referrals');
  return data || [];
};

/** Fetch one referral, enforcing the same scope as list(). */
export const getById = async ({ user, id, supabase = getServiceClient() }) => {
  const { data, error } = await supabase.from(TABLE).select(REFERRAL_SELECT).eq('id', id).maybeSingle();
  throwOnError(error, 'Could not load referral');
  if (!data) throw ApiError.notFound('Referral not found.');

  if (RESIDENT_ROLES.has(user?.role)) {
    if (data.resident?.auth_user_id !== user.id) throw ApiError.notFound('Referral not found.');
  } else if (BARANGAY_ROLES.has(user?.role)) {
    if (!user.barangayId || data.barangay_id !== user.barangayId) throw ApiError.notFound('Referral not found.');
  } else if (MUNICIPALITY_ROLES.has(user?.role)) {
    if (!user.municipalityId || data.municipality_id !== user.municipalityId) throw ApiError.notFound('Referral not found.');
  } else if (user?.role !== 'admin') {
    throw ApiError.forbidden('You are not authorized to view referrals.');
  }
  return data;
};

const sanitizeWrite = (payload = {}) => {
  const row = {};
  if (payload.referring_facility !== undefined) row.referring_facility = text(payload.referring_facility);
  if (payload.reason !== undefined) row.reason = text(payload.reason);
  if (payload.destination_facility !== undefined) row.destination_facility = text(payload.destination_facility);
  if (payload.destination_service !== undefined) row.destination_service = text(payload.destination_service);
  if (payload.priority !== undefined) {
    if (!VALID_PRIORITIES.includes(payload.priority)) throw ApiError.unprocessable('Invalid referral priority.');
    row.priority = payload.priority;
  }
  if (payload.referral_date !== undefined) row.referral_date = payload.referral_date || null;
  if (payload.notes !== undefined) row.notes = text(payload.notes);
  if (payload.resolution_notes !== undefined) row.resolution_notes = text(payload.resolution_notes);
  return row;
};

export const create = async ({ user, payload = {}, supabase = getServiceClient() }) => {
  assertWriter(user);
  const resident = await residentInScope(supabase, user, payload.residentId ?? payload.resident_id);

  const row = sanitizeWrite(payload);
  if (!row.reason) throw ApiError.unprocessable('Referral reason is required.');
  if (!row.destination_facility) throw ApiError.unprocessable('Destination facility is required.');
  if (payload.status !== undefined) {
    if (!VALID_STATUSES.includes(payload.status)) throw ApiError.unprocessable('Invalid referral status.');
    row.status = payload.status;
  }
  row.resident_id = resident.id;
  row.created_by = user.id;
  // municipality_id / barangay_id are set by the DB trigger from the resident.

  const { data, error } = await supabase.from(TABLE).insert(row).select(REFERRAL_SELECT).single();
  throwOnError(error, 'Could not create referral');
  await audit(supabase, user, 'REFERRAL_CREATED', data.id, resident);
  await notifyResident(supabase, resident, 'created', data);
  return data;
};

/** Load an existing referral and confirm it is in the writer's scope. */
const writableReferral = async (supabase, user, id) => {
  assertWriter(user);
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  throwOnError(error, 'Could not load referral');
  if (!data) throw ApiError.notFound('Referral not found.');
  // Re-load the resident through the scope check: this both confirms the
  // caller covers the referral's barangay and yields scope ids for the audit.
  const resident = await residentInScope(supabase, user, data.resident_id);
  return { existing: data, resident };
};

export const update = async ({ user, id, payload = {}, supabase = getServiceClient() }) => {
  const { existing, resident } = await writableReferral(supabase, user, id);
  const row = sanitizeWrite(payload);
  if (Object.prototype.hasOwnProperty.call(payload, 'reason') && !row.reason) {
    throw ApiError.unprocessable('Referral reason is required.');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'destination_facility') && !row.destination_facility) {
    throw ApiError.unprocessable('Destination facility is required.');
  }
  if (payload.status !== undefined) {
    if (!VALID_STATUSES.includes(payload.status)) throw ApiError.unprocessable('Invalid referral status.');
    row.status = payload.status;
  }
  if (Object.keys(row).length === 0) return getById({ user, id, supabase });

  const { data, error } = await supabase.from(TABLE).update(row).eq('id', id).select(REFERRAL_SELECT).single();
  throwOnError(error, 'Could not update referral');
  await audit(supabase, user, 'REFERRAL_UPDATED', id, resident);
  return data;
};

export const updateStatus = async ({ user, id, status, resolutionNotes, supabase = getServiceClient() }) => {
  const { existing, resident } = await writableReferral(supabase, user, id);
  if (!VALID_STATUSES.includes(status)) throw ApiError.unprocessable('Invalid referral status.');

  const row = { status };
  if (resolutionNotes !== undefined) row.resolution_notes = text(resolutionNotes);
  if (status === 'Completed' && !existing.completed_at) row.completed_at = new Date().toISOString();
  if (status !== 'Completed') row.completed_at = existing.completed_at ?? null;

  const { data, error } = await supabase.from(TABLE).update(row).eq('id', id).select(REFERRAL_SELECT).single();
  throwOnError(error, 'Could not update referral status');
  await audit(supabase, user, 'REFERRAL_STATUS_CHANGED', id, resident, { from: existing.status, to: status });

  if (status !== existing.status) {
    if (status === 'Accepted') await notifyResident(supabase, resident, 'accepted', data);
    else if (status === 'Completed') await notifyResident(supabase, resident, 'completed', data);
    else if (status === 'Cancelled') await notifyResident(supabase, resident, 'cancelled', data);
  }
  return data;
};

export const remove = async ({ user, id, supabase = getServiceClient() }) => {
  const { existing, resident } = await writableReferral(supabase, user, id);
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  throwOnError(error, 'Could not delete referral');
  await audit(supabase, user, 'REFERRAL_DELETED', id, resident, { status: existing.status });
  return { id };
};

export default { list, getById, create, update, updateStatus, remove };
