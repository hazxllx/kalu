import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';
import { assignedBarangay } from '../config/scope.js';

const TABLES = Object.freeze({
  followups: 'follow_ups',
  tcl: 'tcl_entries',
  maternal: 'maternal_records',
  maternalvisits: 'maternal_visits',
  'maternal-visits': 'maternal_visits',
  'maternalVisits': 'maternal_visits',
  immunizations: 'immunizations',
  notifications: 'notifications',
});
const STAFF = new Set(['health_supervisor', 'phn', 'mho']);
const text = (v) => String(v ?? '').trim();
const normalizeKind = (kind) => {
  const candidate = String(kind ?? '').trim().toLowerCase();
  if (!candidate) return '';
  const compact = candidate.replace(/[-_\s]+/g, '');
  if (compact === 'maternalvisits' || compact === 'maternalvisit') return 'maternalvisits';
  if (compact === 'followups' || compact === 'followup') return 'followups';
  if (compact === 'tclentries' || compact === 'tclentry') return 'tcl';
  if (compact === 'immunizations' || compact === 'immunization') return 'immunizations';
  if (compact === 'notifications' || compact === 'notification') return 'notifications';
  return candidate;
};
const throwOnError = (error, fallback) => { if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error }); };

/** Local "YYYY-MM-DD" format check (same rule the health-services validator uses). */
const dateIsDateOnly = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));

/**
 * Follow-up lifecycle guard (enforced on the server).
 *
 * The status names are loose across the app (staff screens use
 * 'Scheduled'/'Today'/'Upcoming', the resident flow uses
 * 'Pending' -> 'Scheduled'/'Cancelled'), so instead of matching names we
 * enforce the rules that must never break:
 *   - a Completed / Cancelled / Rejected follow-up is final and cannot change;
 *   - a follow-up that is still pending, rejected, cancelled or missed cannot
 *     be marked Completed (a missed one must be rescheduled first);
 *   - a follow-up scheduled for a future date cannot be completed early.
 *
 * Dates are compared on the Philippine calendar date (Asia/Manila, UTC+8) so a
 * late-evening UTC "now" does not roll over to the wrong day.
 */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

// Today's date (YYYY-MM-DD) on the Philippine calendar.
export const manilaDateString = (d = new Date()) =>
  new Date(d.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);

// Statuses a follow-up may not be completed from.
const COMPLETE_BLOCKERS = new Set(['Pending', 'Cancelled', 'Rejected', 'Missed']);
// Final statuses that can no longer change.
const TERMINAL_STATUSES = new Set(['Completed', 'Cancelled', 'Rejected']);

/**
 * Check a staff status change against the stored follow-up. Throws on an
 * illegal transition; a no-op (same status, or none) passes. Exported so it can
 * be unit-tested on its own.
 */
export const assertFollowUpTransition = (existing = {}, nextStatus, { today = manilaDateString() } = {}) => {
  const current = text(existing.status) || 'Scheduled';
  const target = text(nextStatus);
  if (!target || target === current) return; // editing other fields / no change

  if (TERMINAL_STATUSES.has(current)) {
    throw ApiError.conflict(`This follow-up is ${current} and can no longer change status.`);
  }

  if (target === 'Completed') {
    if (COMPLETE_BLOCKERS.has(current)) {
      throw ApiError.conflict(`A ${current} follow-up cannot be marked Completed.`);
    }
    if (existing.requires_resident_response && text(existing.resident_decision) !== 'approved') {
      throw ApiError.conflict("This follow-up is still awaiting the resident's confirmation and cannot be completed.");
    }
    const sched = text(existing.scheduled_date);
    if (sched && sched > today) {
      throw ApiError.unprocessable(
        `This follow-up is scheduled for ${sched}; it cannot be marked Completed before then (today is ${today}).`,
      );
    }
  }
};

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
    case 'followups:awaiting_response':
      return { category: 'reminder', title: 'New follow-up requires your response', message: `A health worker requested a follow-up${when}. Please review it and confirm or reject it in your Follow-ups.` };
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

// Records that render a resident name embed the CURRENT resident row (already
// authorized by the scope filters + RLS), so the UI shows the live name instead
// of a create-time placeholder.
//
// READ and WRITE responses MUST use the same select. create()/update()
// previously returned `.select('*')` with no embed, so the frontend mappers
// (which read `row.resident.first_name`) fell back to the literal string
// "Resident" and overwrote the correct name after any edit.
const RESIDENT_EMBED = 'resident:residents(id, first_name, middle_name, last_name, barangay, sex, birth_date, cellphone_no)';
const MATERNAL_CASE_EMBED = 'maternal_case:maternal_records(id, resident_id, lmp, edd, status, provider, created_at)';
const CONSULTATION_EMBED = 'consultation:visits!follow_ups_consultation_id_fkey(id, visit_date, chief_complaint, status)';
const selectFor = (kind) => {
  const normalizedKind = normalizeKind(kind);
  if (normalizedKind === 'followups') return `*, ${RESIDENT_EMBED}, ${CONSULTATION_EMBED}`;
  if (normalizedKind === 'maternalvisits') return `*, ${RESIDENT_EMBED}, ${MATERNAL_CASE_EMBED}`;
  if (normalizedKind === 'maternal' || normalizedKind === 'immunizations') return `*, ${RESIDENT_EMBED}`;
  return '*';
};

export const validateMaternalVisit = (payload = {}) => {
  const row = { ...payload };
  const visitType = text(row.visit_type || row.type || 'prenatal');
  const validTypes = new Set(['prenatal', 'intrapartum', 'postpartum']);
  if (!row.visit_date && !row.visitDate) {
    throw ApiError.unprocessable('Maternal visit date is required.');
  }
  const visitDate = text(row.visit_date || row.visitDate);
  if (!visitDate || !dateIsDateOnly(visitDate)) {
    throw ApiError.unprocessable('Maternal visit date is invalid.');
  }
  if (!validTypes.has(visitType.toLowerCase())) {
    throw ApiError.unprocessable('Maternal visit type must be prenatal, intrapartum, or postpartum.');
  }
  row.visit_type = visitType.toLowerCase();
  row.visit_date = visitDate;
  if (row.blood_pressure != null && text(row.blood_pressure) && !/^\d{2,3}\/\d{2,3}$/.test(text(row.blood_pressure))) {
    throw ApiError.unprocessable('Blood pressure must be in the format SYSTOLIC/DIASTOLIC.');
  }
  if (row.weight != null && text(row.weight) && Number.isNaN(Number(row.weight))) {
    throw ApiError.unprocessable('Visit weight must be numeric when supplied.');
  }
  if (row.gestational_age_weeks != null && text(row.gestational_age_weeks) && Number.isNaN(Number(row.gestational_age_weeks))) {
    throw ApiError.unprocessable('Gestational age weeks must be numeric when supplied.');
  }
  return row;
};

export const buildMaternalVisitTable = ({ maternalRecord = {}, visits = [] } = {}) => {
  const ordered = [...visits]
    .map((visit) => ({ ...visit, visit_date: visit.visit_date || visit.visitDate || '' }))
    .filter((visit) => visit.visit_date)
    .sort((a, b) => new Date(a.visit_date) - new Date(b.visit_date));

  return ordered.map((visit, index) => ({
    row_number: index + 1,
    visit_date: visit.visit_date,
    visit_type: visit.visit_type || 'prenatal',
    blood_pressure: visit.blood_pressure || '',
    weight: visit.weight ?? '',
    fundal_height: visit.fundal_height || '',
    fetal_heart_tone: visit.fetal_heart_tone || '',
    gestational_age_weeks: visit.gestational_age_weeks ?? '',
    provider: visit.provider || maternalRecord.provider || '',
    notes: visit.notes || '',
  }));
};

/** Statuses a follow-up can no longer leave. */
const CLOSED_FOLLOW_UP_STATUSES = new Set(['Completed', 'Cancelled', 'Rejected', 'Missed']);

/**
 * Derive the scheduling facts a follow-up list needs to show its current state
 * at a glance. `isOverdue` is intentionally DERIVED, not a stored status: the
 * `follow_ups.status` vocabulary is fixed by the table's CHECK constraint
 * (Scheduled, Pending, Today, Upcoming, Ongoing, Completed, Missed, Cancelled)
 * and adding an 'Overdue' value would let a stale flag outlive its date. A row
 * is overdue when its scheduled date has passed and it is still open.
 */
export const withScheduleState = (row, today = manilaDateString()) => {
  if (!row) return row;
  const scheduledDate = text(row.scheduled_date);
  const open = !CLOSED_FOLLOW_UP_STATUSES.has(text(row.status));
  return {
    ...row,
    is_due_today: scheduledDate === today,
    is_overdue: Boolean(scheduledDate) && scheduledDate < today && open,
  };
};

export const list = async ({ user, kind, residentId = null, status = null, from = null, to = null, supabase = getServiceClient() }) => {
  const normalizedKind = normalizeKind(kind);
  const tableName = TABLES[normalizedKind] || TABLES[kind];
  if (!tableName && normalizedKind !== 'notifications') throw ApiError.badRequest('Unknown operational record type.');
  if (normalizedKind === 'notifications') {
    const { data, error } = await supabase.from('notifications').select('*').eq('recipient_id', user.id).order('created_at', { ascending: false }).limit(100);
    throwOnError(error, 'Could not load notifications');
    return data || [];
  }
  const hasRange = Boolean(from) || Boolean(to);
  if (hasRange && !(normalizedKind === 'followups')) {
    // Silently ignore date filters for non-scheduled kinds.
  }
  if (from && normalizedKind === 'followups' && !dateIsDateOnly(from)) {
    throw ApiError.badRequest('Invalid "from" date for follow-ups.');
  }
  if (to && normalizedKind === 'followups' && !dateIsDateOnly(to)) {
    throw ApiError.badRequest('Invalid "to" date for follow-ups.');
  }
  if (!STAFF.has(user?.role)) {
    if (!['resident', 'resident-limited'].includes(user?.role) || normalizedKind !== 'followups') {
      throw ApiError.forbidden('You are not authorized to view this operational record.');
    }
    const { data: ownResident, error: ownResidentError } = await supabase.from('residents').select('id').eq('auth_user_id', user.id).maybeSingle();
    throwOnError(ownResidentError, 'Could not load resident record');
    if (!ownResident) return [];
    residentId = ownResident.id;
  }
  const select = selectFor(normalizedKind);
  let query = supabase.from(tableName).select(select).order('created_at', { ascending: false }).limit(200);
  if (user.role === 'health_supervisor') {
    if (!user.barangayId) return [];
    query = query.eq('barangay_id', user.barangayId);
  } else if (user.role === 'phn' || user.role === 'mho') {
    if (!user.municipalityId) return [];
    query = query.eq('municipality_id', user.municipalityId);
  }
  if (residentId) { await residentFor(supabase, user, residentId); query = query.eq('resident_id', residentId); }
  if (status) query = query.eq('status', status);
  if (normalizedKind === 'followups') {
    if (from) query = query.gte('scheduled_date', from);
    if (to) query = query.lte('scheduled_date', to);
  }
  if (normalizedKind === 'maternalvisits') {
    if (from) query = query.gte('visit_date', from);
    if (to) query = query.lte('visit_date', to);
  }
  const { data, error } = await query;
  throwOnError(error, `Could not load ${normalizedKind}`);
  if (normalizedKind === 'followups') return (data || []).map((row) => withScheduleState(row));
  return data || [];
};

export const create = async ({ user, kind, payload = {}, supabase = getServiceClient() }) => {
  const normalizedKind = normalizeKind(kind);
  assertStaff(user);
  const table = TABLES[normalizedKind] || TABLES[kind];
  if (!table) throw ApiError.badRequest('Unknown operational record type.');
  const resident = await residentFor(supabase, user, payload.residentId || payload.resident_id);
  const row = { ...payload, resident_id: resident.id, created_by: user.id };
  delete row.residentId;
  delete row.resident_id;
  delete row.consultationId;
  delete row.id;

  if (normalizedKind === 'maternalvisits') {
    const maternalCaseId = text(row.maternal_case_id || row.maternalCaseId || row.maternal_record_id || row.maternalRecordId);
    if (!maternalCaseId) {
      throw ApiError.unprocessable('A maternal case is required for each visit.');
    }
    const { data: maternalCase, error: maternalError } = await supabase
      .from('maternal_records')
      .select('id, resident_id')
      .eq('id', maternalCaseId)
      .maybeSingle();
    throwOnError(maternalError, 'Could not verify maternal case');
    if (!maternalCase || maternalCase.resident_id !== resident.id) {
      throw ApiError.unprocessable('The selected maternal case does not belong to this resident.');
    }
    row.maternal_case_id = maternalCase.id;
    delete row.maternalCaseId;
    delete row.maternal_record_id;
    delete row.maternalRecordId;
    Object.assign(row, validateMaternalVisit(row));
  }

  // A follow-up may require the resident to confirm (approve) or reject it
  // before it becomes an approved/scheduled calendar event. When requested it
  // is created in the 'Pending' lifecycle status with a pending resident
  // decision; the resident is notified to respond. The client-supplied
  // decision fields are never trusted — they are set here from the workflow.
  let followUpAwaitsResident = false;
  if (normalizedKind === 'followups') {
    const consultationId = text(payload.consultation_id);
    delete row.consultation_id;
    if (consultationId) {
      const { data: consultation, error: consultationError } = await supabase
        .from('visits')
        .select('id, resident_id')
        .eq('id', consultationId)
        .maybeSingle();
      throwOnError(consultationError, 'Could not verify consultation');
      if (!consultation || consultation.resident_id !== resident.id) {
        throw ApiError.unprocessable('The selected consultation does not belong to this resident.');
      }
      row.consultation_id = consultation.id;
    }
    followUpAwaitsResident = Boolean(row.requiresResidentResponse ?? row.requires_resident_response);
    delete row.requiresResidentResponse;
    delete row.resident_decision;
    delete row.resident_decision_at;
    delete row.resident_decision_reason;
    if (followUpAwaitsResident) {
      row.requires_resident_response = true;
      row.resident_decision = 'pending';
      row.resident_decision_at = null;
      row.resident_decision_reason = '';
      row.status = 'Pending';
    } else {
      row.requires_resident_response = false;
    }
    const initialStatus = text(row.status);
    if (['Completed', 'Missed'].includes(initialStatus)) {
      throw ApiError.unprocessable('A new follow-up cannot be created as Completed or Missed; it must be scheduled first.');
    }
    const sched = text(row.scheduled_date);
    if (sched && Number.isNaN(Date.parse(sched))) {
      throw ApiError.unprocessable('The scheduled date is invalid.');
    }
  }
  const { data, error } = await supabase.from(table).insert(row).select(selectFor(normalizedKind)).single();
  throwOnError(error, `Could not create ${normalizedKind}`);
  await audit(supabase, user, `${normalizedKind.toUpperCase()}_CREATED`, table, data.id, resident);
  await notifyResident(supabase, resident, normalizedKind, followUpAwaitsResident ? 'awaiting_response' : 'created', data);
  return normalizedKind === 'followups' ? withScheduleState(data) : data;
};

export const update = async ({ user, kind, id, payload = {}, consultationId = null, supabase = getServiceClient() }) => {
  const normalizedKind = normalizeKind(kind);
  const table = TABLES[normalizedKind] || TABLES[kind];
  if (!table) {
    if (normalizedKind === 'notifications') return markNotificationRead({ user, id });
    throw ApiError.badRequest('Unknown operational record type.');
  }
  assertStaff(user);
  const { data: existing, error: readError } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  throwOnError(readError, `Could not load ${normalizedKind}`);
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
  delete row.consultation_id;
  delete row.consultationId;
  if (normalizedKind === 'maternalvisits') {
    const maternalCaseId = text(row.maternal_case_id || row.maternalCaseId || row.maternal_record_id || row.maternalRecordId);
    if (maternalCaseId) {
      const { data: maternalCase, error: maternalError } = await supabase
        .from('maternal_records')
        .select('id, resident_id')
        .eq('id', maternalCaseId)
        .maybeSingle();
      throwOnError(maternalError, 'Could not verify maternal case');
      if (!maternalCase || maternalCase.resident_id !== existing.resident_id) {
        throw ApiError.unprocessable('The selected maternal case does not belong to this resident.');
      }
      row.maternal_case_id = maternalCase.id;
      delete row.maternalCaseId;
      delete row.maternal_record_id;
      delete row.maternalRecordId;
    }
    Object.assign(row, validateMaternalVisit({ ...existing, ...row }));
  }
  if (normalizedKind === 'followups' && consultationId) {
    const { data: consultation, error: consultationError } = await supabase
      .from('visits')
      .select('id, resident_id')
      .eq('id', consultationId)
      .maybeSingle();
    throwOnError(consultationError, 'Could not verify consultation');
    if (!consultation || consultation.resident_id !== existing.resident_id) {
      throw ApiError.unprocessable('The selected consultation does not belong to this resident.');
    }
    row.consultation_id = consultation.id;
  }
  delete row.resident_decision;
  delete row.resident_decision_at;
  delete row.resident_decision_reason;
  delete row.requires_resident_response;
  delete row.requiresResidentResponse;
  if (normalizedKind === 'followups' && text(row.status) === 'Completed' && !existing.completed_at) {
    row.completed_at = new Date().toISOString();
  }
  if (normalizedKind === 'followups' && Object.prototype.hasOwnProperty.call(payload, 'status')) {
    assertFollowUpTransition(existing, payload.status);
  }
  const { data, error } = await supabase.from(table).update(row).eq('id', id).select(selectFor(normalizedKind)).single();
  throwOnError(error, `Could not update ${normalizedKind}`);
  await audit(supabase, user, `${normalizedKind.toUpperCase()}_UPDATED`, table, id, resident);

  if (normalizedKind === 'followups') {
    const newStatus = text(data.status);
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
  return normalizedKind === 'followups' ? withScheduleState(data) : data;
};

/**
 * Delete a maternal record (spec PART 13). Hard delete, following the existing
 * operational-record conventions: staff only, re-checks the record's resident
 * is inside the caller's barangay/municipality scope BEFORE deleting, and
 * writes an audit log. Supabase RLS (maternal_records_delete) mirrors the same
 * boundary for any direct token access. Only `maternal` is deletable here;
 * other operational kinds keep their append-only history.
 */
export const remove = async ({ user, kind, id, supabase = getServiceClient() }) => {
  const normalizedKind = normalizeKind(kind);
  const table = TABLES[normalizedKind] || TABLES[kind];
  if (!table) throw ApiError.badRequest('Unknown operational record type.');
  if (!['maternal', 'maternalvisits'].includes(normalizedKind)) throw ApiError.forbidden('This record type cannot be deleted.');
  assertStaff(user);
  const { data: existing, error: readError } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  throwOnError(readError, `Could not load ${normalizedKind}`);
  if (!existing) throw ApiError.notFound('Operational record not found.');
  const resident = await residentFor(supabase, user, existing.resident_id);
  const { error } = await supabase.from(table).delete().eq('id', id);
  throwOnError(error, `Could not delete ${normalizedKind}`);
  await audit(supabase, user, `${normalizedKind.toUpperCase()}_DELETED`, table, id, resident);
  return { id };
};

/** Recipient marks one of their own notifications read. */
export const markNotificationRead = async ({ user, id, supabase = getServiceClient() }) => {
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

export default { list, create, update, remove, markNotificationRead, withScheduleState };