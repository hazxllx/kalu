/**
 * Resident visit-plan service.
 *
 * Backs public.visit_plans + a read-only health-service directory for the
 * resident portal (migration
 * supabase/migrations/20261014010000_resident_visit_plans.sql).
 *
 * This is deliberately a THIN, separate concept from the barangay appointment
 * system (public.appointments). A visit plan is a resident's intent to come on
 * a given day — a soft signal to the barangay health worker. There is no slot
 * capacity, no approve/decline/reschedule workflow and no resident-visible
 * status. Internally a plan is only ever Planned or Cancelled; removing a plan
 * sets it to Cancelled.
 *
 * Scope is derived from the authenticated session, never from client input:
 *   - a resident only ever sees/acts on their OWN visit plans;
 *   - a service is offered to a resident when it is active in the resident's
 *     municipality AND either belongs to the resident's own barangay (delivered
 *     at the Barangay Health Center) or has no barangay (municipality-wide,
 *     delivered at the Rural Health Unit).
 * Supabase RLS mirrors the same visibility boundary independently.
 *
 * `supabase` is injectable so the unit tests can drive it without a live DB.
 * Availability reuses the existing appointment_schedules / appointment_blackouts
 * tables (operating weekdays, hours and closures) rather than duplicating them.
 */
import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';
import { notifyResident } from './notifications.service.js';

const SERVICE_TABLE = 'health_services';
const SCHEDULE_TABLE = 'appointment_schedules';
const BLACKOUT_TABLE = 'appointment_blackouts';
const PLAN_TABLE = 'visit_plans';
const ATTENDANCE_TABLE = 'health_service_attendance';

const PLAN_WINDOW_DAYS = 14; // the resident may plan a visit within the next two weeks

const text = (v) => String(v ?? '').trim();
const throwOnError = (error, fallback) => {
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
};
const hhmm = (value) => (value ? String(value).slice(0, 5) : '');

/** Strip control characters and clamp a resident note to 140 characters. */
const sanitizeNote = (value) => {
  const cleaned = String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 140);
};

// --- date helpers (UTC calendar dates, matching the appointment service) ----
const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const todayISO = (now = new Date()) =>
  `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
const parseISO = (value) => {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
};
const weekdayOf = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const addDaysISO = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return toISO(date);
};

// ---------------------------------------------------------------------------
// Resolve the authenticated caller's own resident record.
// ---------------------------------------------------------------------------
const ownResident = async (supabase, user) => {
  const { data, error } = await supabase
    .from('residents')
    .select('id, auth_user_id, barangay_id, municipality_id, barangay, first_name, middle_name, last_name')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  throwOnError(error, 'Could not load your resident record');
  if (!data) throw ApiError.notFound('No resident record is linked to your account.');
  return data;
};

const residentFullName = (r) =>
  [r?.first_name, r?.middle_name, r?.last_name].filter(Boolean).join(' ').trim() || 'A resident';

/** The service belongs to the resident's barangay (BHC) or is RHU-wide. */
const serviceInScope = (service, resident) =>
  (service.municipality_id === null || service.municipality_id === resident.municipality_id)
  && (service.barangay_id === null || service.barangay_id === resident.barangay_id);

const facilityTypeOf = (service, resident) =>
  service.barangay_id && service.barangay_id === resident.barangay_id ? 'BHC' : 'RHU';

// ---------------------------------------------------------------------------
// Facility names
// ---------------------------------------------------------------------------
const rhuName = async (supabase, resident) => {
  if (!resident.municipality_id) return 'Rural Health Unit';
  const { data } = await supabase
    .from('facilities')
    .select('name, type, municipality_id')
    .eq('municipality_id', resident.municipality_id)
    .eq('type', 'rhu')
    .order('name')
    .limit(1);
  const row = Array.isArray(data) ? data[0] : data;
  return row?.name || 'Rural Health Unit';
};

// ---------------------------------------------------------------------------
// Availability (reuses appointment_schedules + appointment_blackouts).
// ---------------------------------------------------------------------------
/** Active, in-scope schedule rows for a set of service ids. */
const loadSchedules = async (supabase, serviceIds, resident) => {
  if (serviceIds.length === 0) return [];
  const { data, error } = await supabase
    .from(SCHEDULE_TABLE)
    .select('service_id, weekday, start_time, end_time, barangay_id, active')
    .in('service_id', serviceIds)
    .eq('active', true);
  throwOnError(error, 'Could not load service schedules');
  return (data || []).filter((s) => s.barangay_id === null || s.barangay_id === resident.barangay_id);
};

/** Blackout dates for a set of service ids within [from, to]. */
const loadBlackouts = async (supabase, serviceIds, resident, from, to) => {
  if (serviceIds.length === 0) return [];
  const { data, error } = await supabase
    .from(BLACKOUT_TABLE)
    .select('service_id, blackout_date, barangay_id')
    .in('service_id', serviceIds)
    .gte('blackout_date', from)
    .lte('blackout_date', to);
  throwOnError(error, 'Could not load closures');
  return (data || []).filter((b) => b.barangay_id === null || b.barangay_id === resident.barangay_id);
};

/** Summarize a service's schedule into weekdays + an aggregate time window. */
const summarizeSchedule = (scheduleRows) => {
  const weekdays = [...new Set(scheduleRows.map((s) => s.weekday))].sort((a, b) => a - b);
  if (weekdays.length === 0) return { weekdays: [], windowStart: '', windowEnd: '' };
  let start = null;
  let end = null;
  for (const s of scheduleRows) {
    const st = hhmm(s.start_time);
    const en = hhmm(s.end_time);
    if (start === null || st < start) start = st;
    if (end === null || en > end) end = en;
  }
  return { weekdays, windowStart: start || '', windowEnd: end || '' };
};

/** Does the service have an open day within the plan window? */
const hasUpcomingDay = (weekdays, blackoutDates, now = new Date()) => {
  if (weekdays.length === 0) return false;
  const weekdaySet = new Set(weekdays);
  const start = todayISO(now);
  for (let i = 0; i < PLAN_WINDOW_DAYS; i += 1) {
    const iso = addDaysISO(start, i);
    if (weekdaySet.has(weekdayOf(iso)) && !blackoutDates.has(iso)) return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Directory listing — services grouped by facility.
// ---------------------------------------------------------------------------
/**
 * Map a staff-recorded health_service_attendance status to the resident-facing
 * registration status. A plan with no attendance record yet is simply
 * "Registered"; staff never "auto-attend" a resident just for registering.
 */
const residentStatusFor = (attendanceStatus) => {
  switch (attendanceStatus) {
    case 'attended':
    case 'walk_in':
      return 'Attended';
    case 'absent':
      return 'Missed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Registered';
  }
};

const toServiceView = (service, resident, scheduleRows, blackoutDates, facilityName, plan, attendanceStatus = null) => {
  const { weekdays, windowStart, windowEnd } = summarizeSchedule(scheduleRows);
  return {
    id: service.id,
    name: service.name,
    description: service.description || '',
    facilityType: facilityTypeOf(service, resident),
    facilityName,
    visitPolicy: service.visit_policy === 'by_notice' ? 'by_notice' : 'walk_in',
    weekdays,
    windowStart,
    windowEnd,
    // The concrete one-off service window (set on the service record itself),
    // so the resident sees the actual date/time before registering.
    schedule: {
      startDate: service.start_date || null,
      startTime: hhmm(service.start_time),
      endDate: service.end_date || null,
      endTime: hhmm(service.end_time),
      registrationDeadline: service.registration_deadline || null,
    },
    hasUpcoming: hasUpcomingDay(weekdays, blackoutDates),
    plan: plan
      ? {
          id: plan.id,
          plannedDate: plan.planned_date,
          note: plan.note || '',
          status: residentStatusFor(attendanceStatus),
          attendanceStatus: attendanceStatus || null,
        }
      : null,
  };
};

/**
 * Every active service offered to the resident's barangay (BHC) and the
 * covering RHU, grouped by facility. Sections with no active services are
 * omitted. Each service carries its schedule summary, availability flag and the
 * resident's own active plan (if any) so the card can render inline.
 */
export const listDirectory = async ({ user, supabase = getServiceClient(), now = new Date() }) => {
  const resident = await ownResident(supabase, user);
  if (!resident.municipality_id) return { facilities: [] };

  const { data: services, error } = await supabase
    .from(SERVICE_TABLE)
    .select('id, name, description, municipality_id, barangay_id, active, visit_policy, start_date, start_time, end_date, end_time, registration_deadline')
    .eq('municipality_id', resident.municipality_id)
    .eq('active', true)
    .order('name');
  throwOnError(error, 'Could not load services');

  const inScope = (services || []).filter((s) => serviceInScope(s, resident));
  if (inScope.length === 0) return { facilities: [] };

  const ids = inScope.map((s) => s.id);
  const from = todayISO(now);
  const to = addDaysISO(from, PLAN_WINDOW_DAYS - 1);

  const [schedules, blackouts, plansRes, attendanceRes, rhu] = await Promise.all([
    loadSchedules(supabase, ids, resident),
    loadBlackouts(supabase, ids, resident, from, to),
    supabase
      .from(PLAN_TABLE)
      .select('id, service_id, planned_date, note, status')
      .eq('resident_id', resident.id)
      .eq('status', 'Planned')
      .gte('planned_date', from),
    supabase
      .from(ATTENDANCE_TABLE)
      .select('service_id, attendance_status, scheduled_date')
      .eq('resident_id', resident.id)
      .in('service_id', ids)
      .order('scheduled_date', { ascending: false }),
    rhuName(supabase, resident),
  ]);
  throwOnError(plansRes.error, 'Could not load your visit plans');

  const schedulesByService = new Map();
  for (const s of schedules) {
    if (!schedulesByService.has(s.service_id)) schedulesByService.set(s.service_id, []);
    schedulesByService.get(s.service_id).push(s);
  }
  const blackoutByService = new Map();
  for (const b of blackouts) {
    if (!blackoutByService.has(b.service_id)) blackoutByService.set(b.service_id, new Set());
    blackoutByService.get(b.service_id).add(b.blackout_date);
  }
  const planByService = new Map();
  for (const p of plansRes.data || []) {
    // Keep the earliest upcoming plan per service for the inline line.
    const existing = planByService.get(p.service_id);
    if (!existing || p.planned_date < existing.planned_date) planByService.set(p.service_id, p);
  }
  // Most recent attendance status per service (attendance is best-effort: a
  // query error must not blank the directory, so it is read without throwing).
  const attendanceByService = new Map();
  for (const a of attendanceRes?.data || []) {
    if (!attendanceByService.has(a.service_id)) attendanceByService.set(a.service_id, a.attendance_status);
  }

  const bhcName = resident.barangay || 'Barangay Health Center';
  const rhuDisplay = rhu;

  const bhc = [];
  const rhuServices = [];
  for (const service of inScope) {
    const type = facilityTypeOf(service, resident);
    const view = toServiceView(
      service,
      resident,
      schedulesByService.get(service.id) || [],
      blackoutByService.get(service.id) || new Set(),
      type === 'BHC' ? bhcName : rhuDisplay,
      planByService.get(service.id) || null,
      attendanceByService.get(service.id) || null,
    );
    (type === 'BHC' ? bhc : rhuServices).push(view);
  }

  const facilities = [];
  if (bhc.length) facilities.push({ type: 'BHC', name: bhcName, services: bhc });
  if (rhuServices.length) facilities.push({ type: 'RHU', name: rhuDisplay, services: rhuServices });
  return { facilities };
};

// ---------------------------------------------------------------------------
// Service availability — selectable days for the plan modal.
// ---------------------------------------------------------------------------
const loadScopedService = async (supabase, resident, serviceId) => {
  const { data, error } = await supabase
    .from(SERVICE_TABLE)
    .select('id, name, description, municipality_id, barangay_id, active, visit_policy')
    .eq('id', serviceId)
    .maybeSingle();
  throwOnError(error, 'Could not load the service');
  if (!data || data.active !== true) throw ApiError.notFound('Health service not found.');
  if (!serviceInScope(data, resident)) {
    throw ApiError.forbidden('This service is not offered at your barangay health center or RHU.');
  }
  return data;
};

/**
 * The selectable days for a service within the plan window: the next 14 days
 * filtered to the service's active weekdays, minus unavailable (blackout) dates
 * and past days. `from`/`to` narrow the window but are clamped to [today,
 * today + 13 days] so a resident can never plan outside the two-week horizon.
 */
export const serviceAvailability = async ({ user, serviceId, from, to, supabase = getServiceClient(), now = new Date() }) => {
  const resident = await ownResident(supabase, user);
  const service = await loadScopedService(supabase, resident, serviceId);

  const windowStart = todayISO(now);
  const windowEnd = addDaysISO(windowStart, PLAN_WINDOW_DAYS - 1);
  const reqFrom = parseISO(from) ? from : windowStart;
  const reqTo = parseISO(to) ? to : windowEnd;
  const rangeFrom = reqFrom < windowStart ? windowStart : reqFrom;
  const rangeTo = reqTo > windowEnd ? windowEnd : reqTo;

  const [schedules, blackouts] = await Promise.all([
    loadSchedules(supabase, [service.id], resident),
    loadBlackouts(supabase, [service.id], resident, rangeFrom, rangeTo),
  ]);
  const { weekdays, windowStart: wStart, windowEnd: wEnd } = summarizeSchedule(schedules);
  const weekdaySet = new Set(weekdays);
  const blackoutDates = new Set(blackouts.map((b) => b.blackout_date));

  const dates = [];
  if (weekdays.length) {
    for (let iso = rangeFrom; iso <= rangeTo; iso = addDaysISO(iso, 1)) {
      if (weekdaySet.has(weekdayOf(iso)) && !blackoutDates.has(iso)) {
        dates.push({ date: iso, weekday: weekdayOf(iso) });
      }
    }
  }

  return {
    serviceId: service.id,
    serviceName: service.name,
    facilityType: facilityTypeOf(service, resident),
    visitPolicy: service.visit_policy === 'by_notice' ? 'by_notice' : 'walk_in',
    weekdays,
    windowStart: wStart,
    windowEnd: wEnd,
    from: rangeFrom,
    to: rangeTo,
    dates,
    unavailableDates: [...blackoutDates],
    available: dates.length > 0,
  };
};

// ---------------------------------------------------------------------------
// Visit plans
// ---------------------------------------------------------------------------
const toPlan = (row) => ({
  id: row.id,
  serviceId: row.service_id,
  facilityType: row.facility_type,
  plannedDate: row.planned_date,
  note: row.note || '',
  status: row.status,
});

/** Notify the resident's barangay health worker(s). Best-effort, no PII leak. */
const notifyBarangayHealthWorker = async (supabase, resident, { serviceName, plannedDate }) => {
  if (!resident.barangay_id) return;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, barangay_id, status')
    .eq('role', 'bhw')
    .eq('barangay_id', resident.barangay_id)
    .eq('status', 'active');
  if (error) return; // best-effort
  const name = residentFullName(resident);
  await Promise.all(
    (data || [])
      .map((p) => p.id)
      .filter(Boolean)
      .map((recipient) =>
        notifyResident({
          recipientAuthUserId: recipient,
          category: 'information',
          title: 'Resident plans a visit',
          message: `${name} plans to visit ${serviceName} on ${plannedDate}.`,
          relatedType: PLAN_TABLE,
          relatedId: null,
        }),
      ),
  );
};

/** Create a visit plan. Validates scope, weekday and closures server-side. */
export const createPlan = async ({ user, serviceId, plannedDate, note = '', supabase = getServiceClient(), now = new Date() }) => {
  const resident = await ownResident(supabase, user);
  const service = await loadScopedService(supabase, resident, serviceId);

  const date = parseISO(plannedDate);
  if (!date) throw ApiError.unprocessable('Select a valid date.');
  const iso = plannedDate;
  const todayStr = todayISO(now);
  const windowEnd = addDaysISO(todayStr, PLAN_WINDOW_DAYS - 1);
  if (iso < todayStr) throw ApiError.unprocessable('The visit date cannot be in the past.');
  if (iso > windowEnd) throw ApiError.unprocessable('You can only plan a visit within the next two weeks.');

  const [schedules, blackouts] = await Promise.all([
    loadSchedules(supabase, [service.id], resident),
    loadBlackouts(supabase, [service.id], resident, iso, iso),
  ]);
  const { weekdays } = summarizeSchedule(schedules);
  if (!weekdays.includes(weekdayOf(iso))) {
    throw ApiError.unprocessable('This service is not offered on the selected day.');
  }
  if (blackouts.length > 0) {
    throw ApiError.unprocessable('The health center is closed on the selected day. Please choose another day.');
  }

  // One active plan per service: the card hides the action when a plan exists,
  // but the backend rejects a duplicate defensively.
  const { data: existing, error: existingErr } = await supabase
    .from(PLAN_TABLE)
    .select('id, planned_date')
    .eq('resident_id', resident.id)
    .eq('service_id', service.id)
    .eq('status', 'Planned')
    .gte('planned_date', todayStr)
    .limit(1);
  throwOnError(existingErr, 'Could not check your existing plans');
  if ((existing || []).length > 0) {
    throw ApiError.conflict('You already have a visit plan for this service.');
  }

  const { data, error } = await supabase
    .from(PLAN_TABLE)
    .insert({
      resident_id: resident.id,
      barangay_id: resident.barangay_id,
      service_id: service.id,
      facility_type: facilityTypeOf(service, resident),
      planned_date: iso,
      note: sanitizeNote(note) || null,
      status: 'Planned',
    })
    .select('*')
    .single();
  throwOnError(error, 'Could not save your visit plan');

  await notifyBarangayHealthWorker(supabase, resident, { serviceName: service.name, plannedDate: iso }).catch(() => {});

  return {
    plan: toPlan(data),
    message: 'Visit plan saved. Your barangay health center has been notified.',
  };
};

/**
 * Remove (cancel) the caller's own plan. Only a future-dated Planned plan may
 * be removed — a plan whose date has passed is kept as a record. Removal is a
 * soft Planned -> Cancelled transition (the only state change a resident can
 * cause), so the barangay signal and history stay coherent.
 */
export const removePlan = async ({ user, id, supabase = getServiceClient(), now = new Date() }) => {
  const resident = await ownResident(supabase, user);
  const { data: row, error } = await supabase
    .from(PLAN_TABLE)
    .select('id, resident_id, planned_date, status')
    .eq('id', id)
    .maybeSingle();
  throwOnError(error, 'Could not load the visit plan');
  if (!row || row.resident_id !== resident.id) throw ApiError.notFound('Visit plan not found.');
  if (row.status !== 'Planned') throw ApiError.conflict('This visit plan has already been removed.');
  if (row.planned_date < todayISO(now)) {
    throw ApiError.conflict('A past visit plan can no longer be removed.');
  }

  const { data: updated, error: updErr } = await supabase
    .from(PLAN_TABLE)
    .update({ status: 'Cancelled' })
    .eq('id', id)
    .select('*')
    .single();
  throwOnError(updErr, 'Could not remove the visit plan');
  return { plan: toPlan(updated), removed: true };
};

/** The caller's own active (future) plans, optionally for one service. */
export const listOwnPlans = async ({ user, serviceId = '', supabase = getServiceClient(), now = new Date() }) => {
  const resident = await ownResident(supabase, user);
  let request = supabase
    .from(PLAN_TABLE)
    .select('id, service_id, facility_type, planned_date, note, status')
    .eq('resident_id', resident.id)
    .eq('status', 'Planned')
    .gte('planned_date', todayISO(now))
    .order('planned_date', { ascending: true });
  const svc = text(serviceId);
  if (svc) request = request.eq('service_id', svc);
  const { data, error } = await request;
  throwOnError(error, 'Could not load your visit plans');
  return (data || []).map(toPlan);
};

export default {
  listDirectory,
  serviceAvailability,
  createPlan,
  removePlan,
  listOwnPlans,
};
