import { getServiceClient, getUserClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';
import { extractExpectedRevision } from '../utils/syncConcurrency.js';
import { assignedBarangay } from '../config/scope.js';
import { resolveHouseholdWorker } from './households.service.js';
import { notifyHealthSupervisorsOnce } from './notifications.service.js';

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
const FOLLOW_UP_PAGE_SIZE = 200;
const PREDEFINED_VACCINES = new Set([
  'BCG', 'Hepatitis B', 'Pentavalent (DPT-HepB-Hib)', 'OPV', 'IPV', 'PCV', 'MMR', 'Measles',
  'Tetanus Toxoid', 'COVID-19', 'Influenza',
]);
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
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

export const normalizeImmunizationVaccine = (payload = {}) => {
  const selection = text(payload.vaccine_selection ?? payload.vaccineSelection);
  const vaccine = text(payload.vaccine);
  const customName = text(payload.custom_vaccine_name ?? payload.customVaccineName);
  const isCustom = selection === 'Other' || (!selection && vaccine === 'Other');
  if (selection && selection !== 'Other' && !PREDEFINED_VACCINES.has(selection)) {
    throw ApiError.unprocessable('Select a valid predefined vaccine or choose Other.');
  }
  if (isCustom && !customName) {
    throw ApiError.unprocessable('Specify the vaccine name when selecting Other.', {
      custom_vaccine_name: 'Enter a vaccine name.',
    });
  }
  if (customName.length > 120) {
    throw ApiError.unprocessable('Vaccine names must be 120 characters or fewer.', {
      custom_vaccine_name: 'Use 120 characters or fewer.',
    });
  }
  const normalizedSelection = isCustom ? 'Other' : selection || vaccine;
  const normalizedVaccine = isCustom ? customName : normalizedSelection;
  return {
    ...payload,
    vaccine: normalizedVaccine,
    vaccine_selection: normalizedSelection,
    custom_vaccine_name: isCustom ? customName : null,
  };
};

const validateImmunization = (row) => {
  if (!text(row.vaccine)) throw ApiError.unprocessable('A vaccine is required.');
  if (row.next_dose && !dateIsDateOnly(row.next_dose)) {
    throw ApiError.unprocessable('The next-dose date is invalid.');
  }
  if (row.administered_date && !dateIsDateOnly(row.administered_date)) {
    throw ApiError.unprocessable('The administered date is invalid.');
  }
  if (text(row.status) === 'Completed' && !row.administered_date) {
    throw ApiError.unprocessable('Date administered is required for a completed immunization.');
  }
  if (!['Due', 'Completed', 'Missed', 'Cancelled'].includes(text(row.status || 'Due'))) {
    throw ApiError.unprocessable('Select a valid immunization status.');
  }
};

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

/** Block saving a follow-up appointment for a time already passed today. */
export const assertFollowUpScheduleNotInPast = (scheduledDate, scheduledTime, { now = new Date() } = {}) => {
  const date = text(scheduledDate);
  const time = text(scheduledTime).slice(0, 5);
  if (!date || !time || date !== manilaDateString(now)) return;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw ApiError.unprocessable('The scheduled time is invalid.');
  }
  const scheduledAt = Date.parse(`${date}T${time}:00+08:00`);
  if (Number.isFinite(scheduledAt) && scheduledAt < now.getTime()) {
    throw ApiError.unprocessable('The selected time has already passed today. Choose a later time or another date.');
  }
};

// Statuses a follow-up may not be completed from.
const COMPLETE_BLOCKERS = new Set(['Pending', 'Cancelled', 'Rejected', 'Missed']);
// Final statuses that can no longer change.
const TERMINAL_STATUSES = new Set(['Completed', 'Cancelled', 'Rejected']);

/**
 * Check a staff status change against the stored follow-up. Throws on an
 * illegal transition; a no-op (same status, or none) passes. Exported so it can
 * be unit-tested on its own.
 */
export const assertFollowUpTransition = (existing = {}, nextStatus, { today = manilaDateString(), now = new Date() } = {}) => {
  const current = text(existing.status) || 'Scheduled';
  const target = text(nextStatus);
  if (!target || target === current) return; // editing other fields / no change

  if (TERMINAL_STATUSES.has(current)) {
    throw ApiError.conflict(`This follow-up is ${current} and can no longer change status.`);
  }

  if (current === 'Missed' && target === 'Ongoing') {
    throw ApiError.conflict('A missed follow-up must be rescheduled before it can be marked Ongoing.');
  }

  if (target === 'Missed') {
    const scheduledDate = text(existing.scheduled_date);
    const scheduledTime = text(existing.scheduled_time).slice(0, 5);
    if (scheduledDate && scheduledDate > today) {
      throw ApiError.unprocessable(`This follow-up is scheduled for ${scheduledDate}; it cannot be marked Missed before then.`);
    }
    if (scheduledDate === today && /^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime)) {
      const scheduledAt = Date.parse(`${scheduledDate}T${scheduledTime}:00+08:00`);
      if (Number.isFinite(scheduledAt) && now.getTime() < scheduledAt) {
        throw ApiError.unprocessable('This follow-up cannot be marked Missed before its scheduled time.');
      }
    }
  }

  if (target === 'Completed') {
    if (COMPLETE_BLOCKERS.has(current)) {
      throw ApiError.conflict(`A ${current} follow-up cannot be marked Completed.`);
    }
    if (['Reschedule Requested', 'Cancellation Requested'].includes(text(existing.schedule_response_status))) {
      throw ApiError.conflict("A resident schedule-change request is awaiting staff review. Review it before completing this follow-up.");
    }
    const sched = text(existing.scheduled_date);
    if (sched && sched > today) {
      throw ApiError.unprocessable(
        `This follow-up is scheduled for ${sched}; it cannot be marked Completed before then (today is ${today}).`,
      );
    }
  }

  if (target === 'Missed') {
    if (!['Scheduled', 'Today', 'Upcoming', 'Ongoing'].includes(current)) {
      throw ApiError.conflict(`A ${current} follow-up cannot be marked Missed.`);
    }
    const sched = text(existing.scheduled_date);
    if (sched && sched > today) {
      throw ApiError.unprocessable(
        `This follow-up is scheduled for ${sched}; it cannot be marked Missed before then (today is ${today}).`,
      );
    }
  }
};

/**
 * Build the resident-facing notification for an operational record change.
 * Notification text deliberately avoids clinical detail — it points the
 * resident to the relevant record without exposing sensitive information.
 */
export const notificationFor = (kind, action, record) => {
  const when = record?.scheduled_date
    ? ` on ${record.scheduled_date}${record.scheduled_time ? ` at ${String(record.scheduled_time).slice(0, 5)}` : ''}`
    : '';
  const isTbProgram = /\btb\b|tuberculosis/i.test(String(record?.program || ''));
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
      return null;
    case 'tcl:created':
      if (isTbProgram) return null;
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

const assertTclAssignment = (user, kind) => {
  if (kind !== 'tcl' || user.role === 'admin') return;
  if (!user.municipalityId) throw ApiError.forbidden('Your account has no municipality assignment.');
  if (user.role === 'health_supervisor' && !user.barangayId) throw ApiError.forbidden('Your account has no barangay assignment.');
};

const residentFor = async (supabase, user, residentId, kind) => {
  const { data, error } = await supabase.from('residents').select('id, barangay, barangay_id, municipality_id, auth_user_id').eq('id', residentId).maybeSingle();
  throwOnError(error, 'Could not load resident');
  if (!data) throw ApiError.notFound('Resident record not found.');
  if (kind === 'tcl') {
    if ((user.municipalityId && data.municipality_id !== user.municipalityId) ||
        (user.role === 'health_supervisor' && data.barangay_id !== user.barangayId)) {
      throw ApiError.notFound('Resident record not found.');
    }
    return data;
  }
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
  if (normalizedKind === 'maternal' || normalizedKind === 'immunizations' || normalizedKind === 'tcl') return `*, ${RESIDENT_EMBED}`;
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
  if (row.weight != null && text(row.weight)
    && (!Number.isFinite(Number(row.weight)) || Number(row.weight) <= 0)) {
    throw ApiError.unprocessable('Visit weight must be a positive number when supplied.');
  }
  if (row.height_cm != null && text(row.height_cm)
    && (!Number.isFinite(Number(row.height_cm)) || Number(row.height_cm) <= 0)) {
    throw ApiError.unprocessable('Visit height must be a positive number when supplied.');
  }
  if (row.gestational_age_weeks != null && text(row.gestational_age_weeks) && Number.isNaN(Number(row.gestational_age_weeks))) {
    throw ApiError.unprocessable('Gestational age weeks must be numeric when supplied.');
  }
  if (row.clinical_data !== undefined) {
    if (!row.clinical_data || typeof row.clinical_data !== 'object' || Array.isArray(row.clinical_data)) {
      throw ApiError.unprocessable('Maternal encounter details must be an object.');
    }
    if (Buffer.byteLength(JSON.stringify(row.clinical_data), 'utf8') > 30000) {
      throw ApiError.unprocessable('Maternal encounter details are too large.');
    }
  }
  return row;
};

const MATERNAL_DATE_FIELDS = new Set([
  'lmp', 'edd', 'date_of_registration', 'iodine_given_date', 'deworming_date',
  'syphilis_screen_date', 'hepb_screen_date', 'hiv_screen_date',
  'gdm_screen_date', 'cbc_screen_date', 'pregnancy_outcome_date',
  'delivery_date', 'pp_checkup_24h', 'pp_checkup_day3', 'pp_checkup_7_14d',
  'pp_checkup_6wk', 'iron_folic_completed_date', 'vitamin_a_given_date',
]);
const MATERNAL_COUNT_FIELDS = new Set(['prenatal_visits', 'gravida', 'para']);
const MATERNAL_BOOLEAN_FIELDS = new Set([
  'fim_status', 'cbc_iron_given', 'smoking_history', 'binge_alcohol',
  'insufficient_physical_activity', 'unhealthy_diet',
]);

export const validateMaternalRecord = (payload = {}) => {
  const row = { ...payload };
  for (const field of MATERNAL_DATE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(row, field) || row[field] == null || row[field] === '') continue;
    if (!dateIsDateOnly(text(row[field]))) {
      throw ApiError.unprocessable(`Maternal record ${field.replaceAll('_', ' ')} must be a valid date.`);
    }
  }
  for (const field of MATERNAL_COUNT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(row, field) || row[field] == null || row[field] === '') continue;
    if (!Number.isInteger(Number(row[field])) || Number(row[field]) < 0) {
      throw ApiError.unprocessable(`Maternal record ${field.replaceAll('_', ' ')} must be a non-negative whole number.`);
    }
    row[field] = Number(row[field]);
  }
  if (Object.prototype.hasOwnProperty.call(row, 'bmi') && row.bmi != null && row.bmi !== '') {
    if (!Number.isFinite(Number(row.bmi)) || Number(row.bmi) <= 0) {
      throw ApiError.unprocessable('Maternal record BMI must be a positive number.');
    }
    row.bmi = Number(row.bmi);
  }
  for (const field of MATERNAL_BOOLEAN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, field) && row[field] != null && typeof row[field] !== 'boolean') {
      throw ApiError.unprocessable(`Maternal record ${field.replaceAll('_', ' ')} must be true or false.`);
    }
  }
  for (const field of ['syphilis_result', 'hepb_result', 'gdm_result', 'cbc_result']) {
    if (Object.prototype.hasOwnProperty.call(row, field) && row[field] != null && row[field] !== ''
      && !['+', '-'].includes(row[field])) {
      throw ApiError.unprocessable(`Maternal record ${field.replaceAll('_', ' ')} must use an existing screening result option.`);
    }
  }
  for (const field of ['tt_td_doses', 'prenatal_micronutrients', 'pp_iron_folic']) {
    if (Object.prototype.hasOwnProperty.call(row, field)
      && (!row[field] || typeof row[field] !== 'object' || Array.isArray(row[field]))) {
      throw ApiError.unprocessable(`Maternal record ${field.replaceAll('_', ' ')} must be an object.`);
    }
  }
  if (row.tt_td_doses) {
    for (const date of Object.values(row.tt_td_doses)) {
      if (date && !dateIsDateOnly(text(date))) {
        throw ApiError.unprocessable('Td/TT dose dates must be valid dates.');
      }
    }
  }
  if (row.prenatal_micronutrients) {
    for (const field of ['iron_folic_tablets', 'calcium_tablets']) {
      const count = row.prenatal_micronutrients[field];
      if (count != null && count !== '' && (!Number.isInteger(Number(count)) || Number(count) < 0)) {
        throw ApiError.unprocessable('Prenatal supplement counts must be non-negative whole numbers.');
      }
    }
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

const withTclWorker = (row) => ({
  ...row,
  assignedBhwId: row.assigned_bhw_id || null,
  assignedBhwName: row.assigned_bhw_name || row.assigned_bhw || '',
});

const normalizeTclWorker = async ({ row, existing = null, user, resident, supabase }) => {
  const supplied = row.assignedBhwId ?? row.assigned_bhw_id ?? row.assigned_bhw;
  delete row.assignedBhwId;
  delete row.assignedBhwName;
  delete row.assigned_bhw_name;
  delete row.assigned_bhw_id;
  delete row.assigned_bhw;
  if (supplied === undefined) return;
  const workerId = text(supplied);
  if (existing && workerId === text(existing.assigned_bhw) && !existing.assigned_bhw_id) return;
  if (!workerId) {
    Object.assign(row, { assigned_bhw_id: null, assigned_bhw_name: '', assigned_bhw: '' });
    return;
  }
  if (!resident.barangay_id) throw ApiError.unprocessable('Record the resident barangay before assigning a BHW.');
  const worker = await resolveHouseholdWorker({ user, workerId, barangayId: resident.barangay_id, supabase });
  if (worker.role !== 'bhw') throw ApiError.unprocessable('The target client must be assigned to an authorized BHW.');
  Object.assign(row, { assigned_bhw_id: worker.id, assigned_bhw_name: worker.name, assigned_bhw: worker.name });
};

export const list = async ({ user, kind, residentId = null, status = null, from = null, to = null, supabase = getServiceClient() }) => {
  const normalizedKind = normalizeKind(kind);
  const tableName = TABLES[normalizedKind] || TABLES[kind];
  if (!tableName && normalizedKind !== 'notifications') throw ApiError.badRequest('Unknown operational record type.');
  if (normalizedKind === 'notifications') {
    const rows = [];
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from('notifications')
        .select('*')
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
      throwOnError(error, 'Could not load notifications');
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return rows;
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
  assertTclAssignment(user, normalizedKind);
  const select = selectFor(normalizedKind);
  let query = supabase.from(tableName).select(select).order('created_at', { ascending: false });
  if (!['followups', 'tcl', 'maternalvisits'].includes(normalizedKind)) query = query.limit(FOLLOW_UP_PAGE_SIZE);
  if (user.role === 'health_supervisor') {
    if (!user.barangayId) return [];
    query = query.eq('barangay_id', user.barangayId);
    if (normalizedKind === 'tcl') query = query.eq('municipality_id', user.municipalityId);
  } else if (user.role === 'phn' || user.role === 'mho') {
    if (!user.municipalityId) return [];
    query = query.eq('municipality_id', user.municipalityId);
  }
  if (residentId) { await residentFor(supabase, user, residentId, normalizedKind); query = query.eq('resident_id', residentId); }
  if (status) query = query.eq('status', status);
  if (normalizedKind === 'followups') {
    if (from) query = query.gte('scheduled_date', from);
    if (to) query = query.lte('scheduled_date', to);
  }
  if (normalizedKind === 'maternalvisits') {
    if (from) query = query.gte('visit_date', from);
    if (to) query = query.lte('visit_date', to);
  }
  if (normalizedKind === 'followups' || normalizedKind === 'tcl' || normalizedKind === 'maternalvisits') {
    if (normalizedKind === 'maternalvisits') {
      query = query.order('visit_date', { ascending: false }).order('id', { ascending: false });
    } else {
      query = query.order('id', { ascending: true });
    }
    const rows = [];
    for (let offset = 0; ; offset += FOLLOW_UP_PAGE_SIZE) {
      const { data, error } = await query.range(offset, offset + FOLLOW_UP_PAGE_SIZE - 1);
      throwOnError(error, `Could not load ${normalizedKind}`);
      rows.push(...(data || []));
      if (!data || data.length < FOLLOW_UP_PAGE_SIZE) break;
    }
    if (normalizedKind === 'followups') return rows.map((row) => withScheduleState(row));
    if (normalizedKind === 'tcl') return rows.map(withTclWorker);
    return rows;
  }
  const { data, error } = await query;
  throwOnError(error, `Could not load ${normalizedKind}`);
  return data || [];
};

const formatOperationalRecord = (normalizedKind, data) => {
  if (!data) return data;
  if (normalizedKind === 'followups') return withScheduleState(data);
  if (normalizedKind === 'tcl') return withTclWorker(data);
  return data;
};

const findOperationalByOperationKey = async ({
  supabase,
  table,
  normalizedKind,
  idempotencyKey,
  user,
  resident,
  expectedMaternalCaseId = null,
}) => {
  const { data, error } = await supabase
    .from(table)
    .select(selectFor(normalizedKind))
    .eq('client_operation_key', idempotencyKey)
    .maybeSingle();
  throwOnError(error, `Could not verify the ${normalizedKind} operation`);
  if (!data) return null;
  if (
    data.created_by !== user.id
    || data.resident_id !== resident.id
    || (normalizedKind === 'maternalvisits' && expectedMaternalCaseId && data.maternal_case_id !== expectedMaternalCaseId)
  ) {
    throw ApiError.conflict(`This Idempotency-Key belongs to another ${normalizedKind} operation.`);
  }
  return formatOperationalRecord(normalizedKind, data);
};

export const verifyRecordScope = async ({ user, kind, id, supabase = getServiceClient() }) => {
  const normalizedKind = normalizeKind(kind);
  const table = TABLES[normalizedKind] || TABLES[kind];
  if (!table || normalizedKind === 'notifications') {
    throw ApiError.badRequest('Unknown operational record type.');
  }
  assertStaff(user);
  assertTclAssignment(user, normalizedKind);
  const { data: existing, error } = await supabase.from(table).select('id, resident_id').eq('id', id).maybeSingle();
  throwOnError(error, `Could not load ${normalizedKind}`);
  if (!existing) throw ApiError.notFound('Operational record not found.');
  await residentFor(supabase, user, existing.resident_id, normalizedKind);
  return existing;
};

/** Follow-ups in these statuses never block scheduling an identical one. */
const DUPLICATE_EXEMPT_FOLLOW_UP_STATUSES = new Set(['Completed', 'Missed', 'Cancelled', 'Rejected']);

/** `9:30`, `09:30:00` and `09:30:00+08` all normalize to `09:30`; blank stays blank. */
const normalizeScheduledTime = (value) => {
  const raw = text(value);
  if (!raw) return '';
  const match = /^(\d{1,2}):(\d{2})/.exec(raw);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : raw.slice(0, 5).toLowerCase();
};

/**
 * Reject a follow-up that duplicates an OPEN one for the same resident, date,
 * time and purpose. Candidates are fetched with equality filters only and the
 * remaining rules are applied in JS (case/whitespace-insensitive purpose, time
 * normalization, status exemption). The message carries no names or ids.
 */
const assertNoDuplicateFollowUp = async ({ supabase, residentId, row }) => {
  const scheduledDate = text(row.scheduled_date);
  const purpose = text(row.purpose).toLowerCase();
  if (!scheduledDate || !purpose) return;
  const { data, error } = await supabase
    .from('follow_ups')
    .select('id, purpose, scheduled_time, status')
    .eq('resident_id', residentId)
    .eq('scheduled_date', scheduledDate);
  throwOnError(error, 'Could not check for duplicate follow-ups');
  const wantedTime = normalizeScheduledTime(row.scheduled_time);
  const duplicate = (data || []).some((candidate) =>
    !DUPLICATE_EXEMPT_FOLLOW_UP_STATUSES.has(text(candidate.status))
    && text(candidate.purpose).toLowerCase() === purpose
    && normalizeScheduledTime(candidate.scheduled_time) === wantedTime);
  if (duplicate) {
    throw ApiError.duplicate('A matching follow-up is already scheduled for this resident at that date and time.');
  }
};

export const create = async ({ user, kind, payload = {}, idempotencyKey = null, isSync = false, supabase = null }) => {
  const normalizedKind = normalizeKind(kind);
  assertStaff(user);
  assertTclAssignment(user, normalizedKind);
  const serviceSupabase = supabase || getServiceClient();
  const recordSupabase = normalizedKind === 'followups'
    ? supabase || (user?.accessToken ? getUserClient(user.accessToken) : null)
    : serviceSupabase;
  if (!recordSupabase) throw ApiError.unauthorized('A verified user session is required to create a follow-up.');
  const table = TABLES[normalizedKind] || TABLES[kind];
  const maternalRecordPatch = payload.maternal_record_patch || payload.maternalRecordPatch || null;
  const atomicMaternalEncounter = normalizedKind === 'maternalvisits' && maternalRecordPatch !== null;
  if (!table || normalizedKind === 'notifications') throw ApiError.badRequest('Unknown operational record type.');
  const opKey = idempotencyKey == null ? null : text(idempotencyKey);
  if (idempotencyKey !== null && idempotencyKey !== undefined && (!opKey || opKey.length > 200)) {
    throw ApiError.badRequest('Invalid Idempotency-Key.');
  }
  if (isSync && !opKey) {
    throw ApiError.badRequest('Synchronization create requires an Idempotency-Key.').withCode('IDEMPOTENCY_KEY_REQUIRED');
  }
  const resident = await residentFor(recordSupabase, user, payload.residentId || payload.resident_id, normalizedKind);
  const followUpId = normalizedKind === 'immunizations' ? text(payload.followUpId || payload.follow_up_id) : '';
  const row = { ...payload, resident_id: resident.id, created_by: user.id };
  delete row.residentId;
  delete row.consultationId;
  delete row.id;
  delete row.client_operation_key;
  delete row.revision;
  delete row.expected_revision;
  delete row.expectedRevision;
  delete row.baseRevision;
  delete row.created_at;
  delete row.updated_at;
  delete row.municipality_id;
  delete row.barangay_id;
  delete row.followUpId;
  delete row.follow_up_id;
  delete row.maternal_record_patch;
  delete row.maternalRecordPatch;
  delete row.vaccineSelection;
  delete row.customVaccineName;

  if (normalizedKind === 'immunizations') {
    Object.assign(row, normalizeImmunizationVaccine(row));
    validateImmunization(row);
  }

  if (followUpId) {
    const { data: followUp, error: followUpError } = await recordSupabase.from('follow_ups')
      .select('id,resident_id,status,linked_service_id').eq('id', followUpId).maybeSingle();
    throwOnError(followUpError, 'Could not verify the source follow-up');
    if (!followUp || followUp.resident_id !== resident.id) throw ApiError.unprocessable('The selected follow-up does not belong to this resident.');
    if (followUp.linked_service_id) throw ApiError.conflict('This follow-up is already linked to a healthcare record.');
    if (['Completed', 'Cancelled', 'Missed', 'Rejected'].includes(followUp.status)) throw ApiError.conflict('This follow-up is already closed.');
  }

  const linkImmunization = async (recordId, status) => {
    if (!followUpId || !recordId) return;
    const completed = status === 'Completed';
    const { error } = await serviceSupabase.from('follow_ups').update({
      linked_service_type: 'immunization', linked_service_id: String(recordId),
      status: completed ? 'Completed' : 'Ongoing', completed_at: completed ? new Date().toISOString() : null,
    }).eq('id', followUpId).eq('resident_id', resident.id).eq('linked_service_id', '');
    throwOnError(error, 'Could not link the immunization to its follow-up');
  };

  if (normalizedKind === 'tcl') await normalizeTclWorker({ row, user, resident, supabase: serviceSupabase });

  if (normalizedKind === 'maternal') Object.assign(row, validateMaternalRecord(row));

  if (normalizedKind === 'maternalvisits') {
    const maternalCaseId = text(row.maternal_case_id || row.maternalCaseId || row.maternal_record_id || row.maternalRecordId);
    if (!maternalCaseId) {
      throw ApiError.unprocessable('A maternal case is required for each visit.');
    }
    const { data: maternalCase, error: maternalError } = await serviceSupabase
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

  if (opKey) {
    const existing = await findOperationalByOperationKey({
      supabase: recordSupabase,
      table,
      normalizedKind,
      idempotencyKey: opKey,
      user,
      resident,
      expectedMaternalCaseId: row.maternal_case_id || null,
    });
    if (existing) { await linkImmunization(existing.id, existing.status); return existing; }
    if (!atomicMaternalEncounter) row.client_operation_key = opKey;
  }

  // Follow-ups are confirmed by default. Residents can still explicitly
  // confirm attendance or submit schedule-change requests through the separate
  // schedule-request workflow. Never trust client-supplied response fields.
  if (normalizedKind === 'followups') {
    // This field is accepted only when updating a schedule so it can be
    // included in the audit entry; it is not a follow_ups table column.
    delete row.schedule_change_reason;
    const consultationId = text(payload.consultation_id);
    delete row.consultation_id;
    if (consultationId) {
      const { data: consultation, error: consultationError } = await recordSupabase
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
    delete row.requiresResidentResponse;
    delete row.resident_decision;
    delete row.resident_decision_at;
    delete row.resident_decision_reason;
    row.requires_resident_response = false;
    row.schedule_response_status = 'Default Confirmed';
    const initialStatus = text(row.status);
    if (['Completed', 'Missed'].includes(initialStatus)) {
      throw ApiError.unprocessable('A new follow-up cannot be created as Completed or Missed; it must be scheduled first.');
    }
    const sched = text(row.scheduled_date);
    if (!dateIsDateOnly(sched)) {
      throw ApiError.unprocessable('A valid scheduled date is required.');
    }
    assertFollowUpScheduleNotInPast(sched, row.scheduled_time);
    await assertNoDuplicateFollowUp({ supabase: recordSupabase, residentId: resident.id, row });
  }
  let data;
  if (atomicMaternalEncounter) {
    const validatedPatch = validateMaternalRecord(maternalRecordPatch);
    const { data: savedVisit, error } = await serviceSupabase.rpc('save_maternal_encounter', {
      p_maternal_record_id: row.maternal_case_id,
      p_resident_id: resident.id,
      p_actor_id: user.id,
      p_idempotency_key: opKey,
      p_record_patch: validatedPatch,
      p_encounter: {
        visit_date: row.visit_date,
        visit_type: row.visit_type,
        blood_pressure: row.blood_pressure,
        weight: row.weight,
        height_cm: row.height_cm,
        provider: row.provider,
        notes: row.notes,
        clinical_data: row.clinical_data,
      },
    });
    if (error) {
      if (error.code === '23505' && opKey) {
        const existing = await findOperationalByOperationKey({
          supabase: serviceSupabase,
          table,
          normalizedKind,
          idempotencyKey: opKey,
          user,
          resident,
          expectedMaternalCaseId: row.maternal_case_id,
        });
        if (existing) return existing;
      }
      console.error('[operational] Atomic maternal encounter save failed.', { code: error.code || 'UNKNOWN' });
      throw new ApiError(500, 'Could not save the maternal encounter. Please try again.');
    }
    data = Array.isArray(savedVisit) ? savedVisit[0] : savedVisit;
    if (!data) throw new ApiError(500, 'Could not confirm the maternal encounter was saved.');
  } else {
    const { data: inserted, error } = await recordSupabase.from(table).insert(row).select(selectFor(normalizedKind)).single();
    if (error?.code === '23505' && opKey) {
      const existing = await findOperationalByOperationKey({
        supabase: recordSupabase,
        table,
        normalizedKind,
        idempotencyKey: opKey,
        user,
        resident,
        expectedMaternalCaseId: row.maternal_case_id || null,
      });
      if (existing) { await linkImmunization(existing.id, existing.status); return existing; }
    }
    throwOnError(error, `Could not create ${normalizedKind}`);
    data = inserted;
  }
  await linkImmunization(data.id, data.status);
  if (!atomicMaternalEncounter) {
    await audit(serviceSupabase, user, `${normalizedKind.toUpperCase()}_CREATED`, table, data.id, resident);
  }
  await notifyResident(serviceSupabase, resident, normalizedKind, 'created', data);
  if (normalizedKind === 'followups') {
    await notifyHealthSupervisorsOnce({
      barangayId: resident.barangay_id,
      municipalityId: resident.municipality_id,
      actorId: user.id,
      title: 'Follow-up assigned',
      message: `A follow-up was scheduled for a resident in your assigned barangay.`,
      relatedType: 'follow_up_assigned',
      relatedId: data.id,
      eventKey: `follow_up_assigned:${data.id}`,
      supabase: serviceSupabase,
    });
  }
  return formatOperationalRecord(normalizedKind, data);
};

export const update = async ({
  user,
  kind,
  id,
  payload = {},
  consultationId = null,
  expectedUpdatedAt = undefined,
  expectedRevision = undefined,
  isSync = false,
  supabase = getServiceClient(),
}) => {
  const normalizedKind = normalizeKind(kind);
  // Notifications are owned by their recipient (any role), not scoped like the
  // staff operational records. Dispatch BEFORE the table/staff checks: a
  // notification "update" is only ever a recipient marking their own row read.
  // (`TABLES.notifications` is a truthy table name, so this must be handled
  // explicitly rather than relying on an `if (!table)` fallthrough.)
  if (normalizedKind === 'notifications') {
    return markNotificationRead({ user, id, supabase });
  }
  const table = TABLES[normalizedKind] || TABLES[kind];
  if (!table) {
    throw ApiError.badRequest('Unknown operational record type.');
  }
  assertStaff(user);
  assertTclAssignment(user, normalizedKind);
  const precondition = extractExpectedRevision({
    ifMatch: expectedUpdatedAt ?? payload?.expected_updated_at,
    bodyRevision: expectedRevision ?? payload?.expected_revision ?? payload?.expectedRevision ?? payload?.baseRevision,
    isSync,
    allowLegacyTimestamp: normalizedKind === 'followups',
    entityLabel: normalizedKind,
  });

  const { data: existing, error: readError } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  throwOnError(readError, `Could not load ${normalizedKind}`);
  if (!existing) throw ApiError.notFound('Operational record not found.');
  const resident = await residentFor(supabase, user, existing.resident_id, normalizedKind);

  const staleMessage = normalizedKind === 'followups'
    ? 'This follow-up changed on the server. Reload it before applying the queued changes.'
    : 'This clinical record changed on the server. Reload it before applying the queued changes.';

  if (precondition.expectedRevision !== null) {
    const currentRevision = Number(existing.revision ?? 1);
    if (currentRevision !== precondition.expectedRevision) {
      throw ApiError.staleRevision(staleMessage, { currentRevision });
    }
  }
  if (precondition.expectedUpdatedAt) {
    const expectedMs = Date.parse(precondition.expectedUpdatedAt);
    if (!Number.isFinite(expectedMs)) throw ApiError.badRequest('The follow-up revision is invalid.');
    if (expectedMs !== Date.parse(existing.updated_at)) throw ApiError.staleRevision(staleMessage);
  }
  const row = { ...payload };
  const scheduleChangeReason = text(row.schedule_change_reason);
  delete row.schedule_change_reason;
  delete row.residentId;
  delete row.resident_id;
  delete row.id;
  delete row.barangay_id;
  delete row.municipality_id;
  delete row.created_by;
  delete row.created_at;
  delete row.updated_at;
  delete row.client_operation_key;
  delete row.revision;
  delete row.expected_revision;
  delete row.expected_updated_at;
  delete row.expectedRevision;
  delete row.baseRevision;
  delete row.consultation_id;
  delete row.consultationId;
  delete row.vaccineSelection;
  delete row.customVaccineName;
  if (normalizedKind === 'immunizations' && (
    Object.prototype.hasOwnProperty.call(payload, 'vaccine')
    || Object.prototype.hasOwnProperty.call(payload, 'vaccine_selection')
    || Object.prototype.hasOwnProperty.call(payload, 'vaccineSelection')
    || Object.prototype.hasOwnProperty.call(payload, 'custom_vaccine_name')
    || Object.prototype.hasOwnProperty.call(payload, 'customVaccineName')
  )) {
    Object.assign(row, normalizeImmunizationVaccine(row));
  }
  if (normalizedKind === 'immunizations') validateImmunization({ ...existing, ...row });
  if (normalizedKind === 'tcl') await normalizeTclWorker({ row, existing, user, resident, supabase });
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
  if (normalizedKind === 'followups' && (
    Object.prototype.hasOwnProperty.call(payload, 'scheduled_date')
    || Object.prototype.hasOwnProperty.call(payload, 'scheduled_time')
  )) {
    assertFollowUpScheduleNotInPast(
      row.scheduled_date ?? existing.scheduled_date,
      row.scheduled_time ?? existing.scheduled_time,
    );
  }
  const requestedScheduleChange = normalizedKind === 'followups' && (
    (Object.prototype.hasOwnProperty.call(payload, 'scheduled_date') && text(existing.scheduled_date) !== text(row.scheduled_date ?? existing.scheduled_date))
    || (Object.prototype.hasOwnProperty.call(payload, 'scheduled_time') && text(existing.scheduled_time).slice(0, 5) !== text(row.scheduled_time ?? existing.scheduled_time).slice(0, 5))
  );
  if (requestedScheduleChange && !scheduleChangeReason) {
    throw ApiError.unprocessable('A reason is required when directly changing a follow-up schedule.');
  }
  delete row.resident_decision;
  delete row.resident_decision_at;
  delete row.resident_decision_reason;
  delete row.requires_resident_response;
  delete row.requiresResidentResponse;
  delete row.schedule_response_status;
  if (normalizedKind === 'maternal') Object.assign(row, validateMaternalRecord(row));
  if (normalizedKind === 'followups' && text(row.status) === 'Completed' && !existing.completed_at) {
    row.completed_at = new Date().toISOString();
  }
  if (normalizedKind === 'followups' && Object.prototype.hasOwnProperty.call(payload, 'status')) {
    assertFollowUpTransition(existing, payload.status);
    if (text(payload.status) === 'Completed' && !existing.linked_service_id && !existing.consultation_id) {
      throw ApiError.conflict('Complete this follow-up through its linked consultation, immunization, or health-service workflow.');
    }
  }
  let updateQuery = supabase.from(table).update(row).eq('id', id);
  const hasCas = precondition.expectedRevision !== null || Boolean(precondition.expectedUpdatedAt);
  if (precondition.expectedRevision !== null) updateQuery = updateQuery.eq('revision', precondition.expectedRevision);
  if (precondition.expectedUpdatedAt) updateQuery = updateQuery.eq('updated_at', existing.updated_at);
  const updateSelect = updateQuery.select(selectFor(normalizedKind));
  const { data, error } = await (hasCas ? updateSelect.maybeSingle() : updateSelect.single());
  throwOnError(error, `Could not update ${normalizedKind}`);
  if (hasCas && !data) {
    const { data: latest } = await supabase.from(table).select('revision').eq('id', id).maybeSingle();
    throw ApiError.staleRevision(
      staleMessage,
      latest?.revision !== undefined ? { currentRevision: latest.revision } : undefined,
    );
  }
  await audit(supabase, user, `${normalizedKind.toUpperCase()}_UPDATED`, table, id, resident);

  if (normalizedKind === 'immunizations' && ['Completed', 'Missed'].includes(text(data.status))) {
    const { data: linkedFollowUp, error: linkedFollowUpError } = await supabase.from('follow_ups')
      .select('id,status').eq('linked_service_type', 'immunization').eq('linked_service_id', String(data.id)).maybeSingle();
    throwOnError(linkedFollowUpError, 'Could not load the linked follow-up');
    if (linkedFollowUp && linkedFollowUp.status !== 'Completed' && linkedFollowUp.status !== 'Cancelled') {
      const completed = text(data.status) === 'Completed';
      const { error: progressError } = await supabase.from('follow_ups').update({
        status: completed ? 'Completed' : 'Missed', completed_at: completed ? new Date().toISOString() : null,
      }).eq('id', linkedFollowUp.id);
      throwOnError(progressError, 'Could not update follow-up progress');
    }
  }

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
      const { error: scheduleAuditError } = await supabase.from('health_audit_logs').insert({
        actor_id: user.id, action: 'FOLLOWUP_SCHEDULE_CHANGED', entity_type: 'follow_ups', entity_id: id,
        municipality_id: resident.municipality_id || null, barangay_id: resident.barangay_id || null,
        metadata: {
          reason: scheduleChangeReason,
          from: { date: existing.scheduled_date, time: existing.scheduled_time },
          to: { date: data.scheduled_date, time: data.scheduled_time },
        },
      });
      throwOnError(scheduleAuditError, 'Could not record follow-up schedule history');
      await notifyResident(supabase, resident, 'followups', 'rescheduled', data);
    }
    if (newStatus !== text(existing.status) || scheduleChanged) {
      const versionKey = data.revision || data.updated_at || `${newStatus}:${data.scheduled_date}:${data.scheduled_time}`;
      await notifyHealthSupervisorsOnce({
        barangayId: resident.barangay_id,
        municipalityId: resident.municipality_id,
        actorId: user.id,
        title: scheduleChanged ? 'Follow-up schedule updated' : 'Follow-up status updated',
        message: `A follow-up was updated for a resident in your assigned barangay.`,
        relatedType: 'follow_up_updated',
        relatedId: id,
        eventKey: `follow_up_updated:${id}:${versionKey}`,
        supabase,
      });
    }
  }
  return normalizedKind === 'followups' ? withScheduleState(data) : normalizedKind === 'tcl' ? withTclWorker(data) : data;
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
  const { data, error } = await supabase.rpc('mark_owned_notification_read', {
    p_recipient_id: user.id,
    p_notification_id: id,
  });
  throwOnError(error, 'Could not update notification');
  if (!data) throw ApiError.notFound('Notification not found.');
  return data;
};

/**
 * Recipient marks all of their own unread notifications read in one atomic
 * statement. Scoped to `recipient_id = user.id` so a caller can never affect
 * another user's rows, and limited to currently-unread rows (`read_at is null`)
 * so already-read timestamps are preserved. Returns how many rows changed.
 */
export const markAllNotificationsRead = async ({ user, supabase = getServiceClient() }) => {
  const { data, error } = await supabase.rpc('mark_all_owned_notifications_read', {
    p_recipient_id: user.id,
  });
  throwOnError(error, 'Could not update notifications');
  return { updated: Number(data || 0) };
};

export default { list, create, update, remove, markNotificationRead, markAllNotificationsRead, verifyRecordScope, withScheduleState };
