import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';
import { assignedBarangay } from '../config/scope.js';

const TABLES = Object.freeze({ followups: 'follow_ups', tcl: 'tcl_entries', maternal: 'maternal_records', immunizations: 'immunizations' });
const STAFF = new Set(['health_supervisor', 'phn', 'mho']);
const text = (v) => String(v ?? '').trim();
const throwOnError = (error, fallback) => { if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error }); };

/**
 * Build the resident-facing notification for an operational record change.
 * Notification text deliberately avoids clinical detail — it points the
 * resident to the relevant record without exposing sensitive information.
 */
const notificationFor = (kind, action, record) => {
  const when = record?.scheduled_date
    ? ` on ${record.scheduled_date}${record.scheduled_time ? ` at ${String(record.scheduled_time).slice(0, 5)}` : ''}`
    : '';
  switch (`${kind}:${action}`) {
    case 'followups:created':
      return { category: 'reminder', title: 'Follow-up scheduled', message: `A health worker scheduled a follow-up${when}.` };
    case 'followups:rescheduled':
      return { category: 'reminder', title: 'Follow-up rescheduled', message: `Your follow-up was moved${when}.` };
    case 'followups:completed':
      return { category: 'information', title: 'Follow-up completed', message: 'Your follow-up has been marked completed.' };
    case 'followups:missed':
      return { category: 'information', title: 'Follow-up missed', message: 'A scheduled follow-up was marked as missed.' };
    case 'maternal:created':
      return { category: 'information', title: 'Maternal record added', message: 'A maternal health record was added to your account.' };
    case 'immunizations:created':
      return { category: 'information', title: 'Immunization recorded', message: 'A new immunization record was added to your account.' };
    case 'tcl:created':
      return { category: 'information', title: 'Health program update', message: 'You were added to a health monitoring program.' };
    default:
      return null;
  }
};

const notifyResident = async (supabase, resident, kind, action, record) => {
  if (!resident?.auth_user_id) return;
  const payload = notificationFor(kind, action, record);
  if (!payload) return;
  await supabase.from('notifications').insert({
    recipient_id: resident.auth_user_id,
    category: payload.category,
    title: payload.title,
    message: payload.message,
    related_type: TABLES[kind],
    related_id: record.id,
  });
};

const assertStaff = (user) => {
  if (!STAFF.has(user?.role)) throw ApiError.forbidden('You are not authorized to manage operational health records.');
};

const residentFor = async (supabase, user, residentId) => {
  const { data, error } = await supabase.from('residents').select('id, barangay, barangay_id, municipality_id, auth_user_id').eq('id', residentId).maybeSingle();
  throwOnError(error, 'Could not load resident');
  if (!data) throw ApiError.notFound('Resident record not found.');
  const scope = assignedBarangay(user);
  if ((scope && text(data.barangay).toLowerCase() !== text(scope).toLowerCase()) || (user.municipalityId && data.municipality_id && user.municipalityId !== data.municipality_id)) {
    throw ApiError.notFound('Resident record not found.');
  }
  return data;
};

const audit = async (supabase, user, action, entityType, entityId, resident) => {
  const { error } = await supabase.from('health_audit_logs').insert({
    actor_id: user.id, action, entity_type: entityType, entity_id: entityId,
    municipality_id: resident?.municipality_id || null, barangay_id: resident?.barangay_id || null,
  });
  throwOnError(error, 'Could not write audit log');
};

export const list = async ({ user, kind, residentId = null, status = null }) => {
  const supabase = getServiceClient();
  if (!TABLES[kind] && kind !== 'notifications') throw ApiError.badRequest('Unknown operational record type.');
  if (kind === 'notifications') {
    const { data, error } = await supabase.from('notifications').select('*').eq('recipient_id', user.id).order('created_at', { ascending: false }).limit(100);
    throwOnError(error, 'Could not load notifications');
    return data || [];
  }
  if (!STAFF.has(user?.role)) {
    if (!['resident', 'resident-limited'].includes(user?.role) || kind !== 'followups') {
      throw ApiError.forbidden('You are not authorized to view this operational record.');
    }
    const { data: ownResident, error: ownResidentError } = await supabase.from('residents').select('id').eq('auth_user_id', user.id).maybeSingle();
    throwOnError(ownResidentError, 'Could not load resident record');
    if (!ownResident) return [];
    residentId = ownResident.id;
  }
  const select = kind === 'followups'
    ? '*, resident:residents(id, first_name, middle_name, last_name, barangay, sex, birth_date, cellphone_no)'
    : '*';
  let query = supabase.from(TABLES[kind]).select(select).order('created_at', { ascending: false }).limit(200);
  if (residentId) { await residentFor(supabase, user, residentId); query = query.eq('resident_id', residentId); }
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  throwOnError(error, `Could not load ${kind}`);
  return data || [];
};

export const create = async ({ user, kind, payload = {} }) => {
  assertStaff(user);
  const supabase = getServiceClient();
  const resident = await residentFor(supabase, user, payload.residentId);
  const table = TABLES[kind];
  if (!table) throw ApiError.badRequest('Unknown operational record type.');
  const row = { ...payload, resident_id: resident.id, created_by: user.id };
  delete row.residentId;
  delete row.id;
  const { data, error } = await supabase.from(table).insert(row).select('*').single();
  throwOnError(error, `Could not create ${kind}`);
  await audit(supabase, user, `${kind.toUpperCase()}_CREATED`, table, data.id, resident);
  await notifyResident(supabase, resident, kind, 'created', data);
  return data;
};

export const update = async ({ user, kind, id, payload = {} }) => {
  const supabase = getServiceClient();
  const table = TABLES[kind];
  if (!table) {
    if (kind === 'notifications') return markNotificationRead({ user, id });
    throw ApiError.badRequest('Unknown operational record type.');
  }
  assertStaff(user);
  const { data: existing, error: readError } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  throwOnError(readError, `Could not load ${kind}`);
  if (!existing) throw ApiError.notFound('Operational record not found.');
  const resident = await residentFor(supabase, user, existing.resident_id);
  const row = { ...payload };
  delete row.residentId;
  delete row.resident_id;
  delete row.id;
  delete row.barangay_id;
  delete row.municipality_id;
  delete row.created_by;
  delete row.created_at;
  // Completing a follow-up stamps completed_at server-side.
  if (kind === 'followups' && text(row.status) === 'Completed' && !existing.completed_at) {
    row.completed_at = new Date().toISOString();
  }
  const { data, error } = await supabase.from(table).update(row).eq('id', id).select('*').single();
  throwOnError(error, `Could not update ${kind}`);
  await audit(supabase, user, `${kind.toUpperCase()}_UPDATED`, table, id, resident);

  // Resident-facing notifications for meaningful follow-up transitions.
  if (kind === 'followups') {
    const newStatus = text(data.status);
    // Only treat a schedule change as a reschedule when the caller actually
    // sent a new date/time and it differs from the stored value (compare on
    // the date and the HH:mm prefix to avoid time-format false positives).
    const dateSent = Object.prototype.hasOwnProperty.call(payload, 'scheduled_date');
    const timeSent = Object.prototype.hasOwnProperty.call(payload, 'scheduled_time');
    const scheduleChanged =
      (dateSent && text(existing.scheduled_date) !== text(data.scheduled_date)) ||
      (timeSent && text(existing.scheduled_time).slice(0, 5) !== text(data.scheduled_time).slice(0, 5));
    if (newStatus === 'Completed' && text(existing.status) !== 'Completed') {
      await notifyResident(supabase, resident, 'followups', 'completed', data);
    } else if (newStatus === 'Missed' && text(existing.status) !== 'Missed') {
      await notifyResident(supabase, resident, 'followups', 'missed', data);
    } else if (scheduleChanged) {
      await notifyResident(supabase, resident, 'followups', 'rescheduled', data);
    }
  }
  return data;
};

/** Recipient marks one of their own notifications read. */
export const markNotificationRead = async ({ user, id }) => {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('recipient_id', user.id)
    .select('*')
    .maybeSingle();
  throwOnError(error, 'Could not update notification');
  if (!data) throw ApiError.notFound('Notification not found.');
  return data;
};

export default { list, create, update, markNotificationRead };