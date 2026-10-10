/**
 * Resident appointment booking service.
 *
 * Backs public.appointments + public.appointment_schedules +
 * public.appointment_blackouts (migration
 * supabase/migrations/20261013000000_resident_appointment_booking.sql).
 *
 * One consistent lifecycle across resident + staff:
 *   pending -> approved | reschedule_proposed | declined | cancelled
 *   reschedule_proposed -> approved | declined | cancelled
 *   approved -> completed | missed | cancelled
 * Residents may only ever book, cancel their own still-pending request, and
 * accept/decline a staff proposal. They can never set approved/completed/missed.
 *
 * Scope is derived from the authenticated session (never from client input):
 *   - a resident only ever sees/acts on their OWN appointments
 *     (residents.auth_user_id = auth.uid());
 *   - barangay-scoped staff (health_supervisor / bhw) are confined to their
 *     assigned barangay; municipality-wide staff (phn / mho) to their
 *     municipality.
 * Supabase RLS mirrors the same visibility boundary independently.
 *
 * `supabase` is injectable so the unit tests can drive it without a live DB.
 */
import { getServiceClient } from '../config/supabase.js';
import { ROLES } from '../config/roles.js';
import ApiError from '../utils/apiError.js';
import { notifyResident } from './notifications.service.js';

const TABLE = 'appointments';
const SCHEDULE_TABLE = 'appointment_schedules';
const BLACKOUT_TABLE = 'appointment_blackouts';
const SERVICE_TABLE = 'health_services';
const ASSIGN_TABLE = 'health_service_assignments';

export const ACTIVE_STATUSES = Object.freeze(['pending', 'approved', 'reschedule_proposed']);
const BARANGAY_SCOPED = new Set([ROLES.HEALTH_SUPERVISOR, ROLES.BHW]);
const MUNICIPALITY_WIDE = new Set([ROLES.MHO, ROLES.PHN, ROLES.RHU_PERSONNEL]);
const MANAGE_ROLES = new Set([ROLES.BHW, ROLES.HEALTH_SUPERVISOR, ROLES.PHN, ROLES.MHO]);

const text = (v) => String(v ?? '').trim();
const throwOnError = (error, fallback) => {
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
};
const hhmm = (value) => (value ? String(value).slice(0, 5) : '');

const SERVICE_EMBED = 'service:health_services(id, name, category, description)';
const BARANGAY_EMBED = 'barangay:barangays(name)';
const RESIDENT_EMBED = 'resident:residents(id, first_name, middle_name, last_name, barangay)';
const BASE_SELECT = `*, ${SERVICE_EMBED}, ${BARANGAY_EMBED}`;
const STAFF_SELECT = `${BASE_SELECT}, ${RESIDENT_EMBED}`;

const residentFullName = (r) =>
  r ? [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' ').trim() : '';

/** camelCase view model. `includeResident` adds the resident's display name. */
const toAppointment = (row, { includeResident = false } = {}) => {
  if (!row) return null;
  const out = {
    id: row.id,
    reference: row.reference,
    serviceId: row.service_id,
    service: row.service?.name || '',
    serviceCategory: row.service?.category || '',
    serviceDescription: row.service?.description || '',
    barangayId: row.barangay_id || null,
    barangay: row.barangay?.name || '',
    requestedDate: row.requested_date || '',
    requestedTime: hhmm(row.requested_time),
    confirmedDate: row.confirmed_date || '',
    confirmedTime: hhmm(row.confirmed_time),
    proposedDate: row.proposed_date || '',
    proposedTime: hhmm(row.proposed_time),
    status: row.status,
    reason: row.reason || '',
    decisionReason: row.decision_reason || '',
    decidedAt: row.decided_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
  if (includeResident) {
    out.residentId = row.resident_id;
    out.resident = residentFullName(row.resident) || 'Resident';
    out.residentBarangay = row.resident?.barangay || out.barangay;
  }
  return out;
};

// ---------------------------------------------------------------------------
// Resolve the authenticated caller's own resident record.
// ---------------------------------------------------------------------------
const ownResident = async (supabase, user) => {
  const { data, error } = await supabase
    .from('residents')
    .select('id, auth_user_id, barangay_id, municipality_id, barangay')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  throwOnError(error, 'Could not load your resident record');
  if (!data) throw ApiError.notFound('No resident record is linked to your account.');
  return data;
};

const residentAuthUser = async (supabase, residentId) => {
  const { data, error } = await supabase
    .from('residents')
    .select('auth_user_id')
    .eq('id', residentId)
    .maybeSingle();
  throwOnError(error, 'Could not load the resident');
  return data?.auth_user_id || null;
};

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------
const toMinutes = (t) => {
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};
const fromMinutes = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

const generateTimes = (startTime, endTime, slotMinutes) => {
  const out = [];
  const end = toMinutes(endTime);
  for (let cur = toMinutes(startTime); cur + slotMinutes <= end; cur += slotMinutes) {
    out.push(fromMinutes(cur));
  }
  return out;
};

const weekdayOf = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** Services (active, with at least one active schedule) a resident may book. */
export const listAvailableServices = async ({ user, supabase = getServiceClient() }) => {
  const resident = await ownResident(supabase, user);
  if (!resident.municipality_id) return [];

  const { data: services, error } = await supabase
    .from(SERVICE_TABLE)
    .select('id, name, category, description, municipality_id, barangay_id, active')
    .eq('municipality_id', resident.municipality_id)
    .eq('active', true)
    .order('name');
  throwOnError(error, 'Could not load services');

  const inScope = (services || []).filter(
    (s) => s.barangay_id === null || s.barangay_id === resident.barangay_id,
  );
  if (inScope.length === 0) return [];

  const ids = inScope.map((s) => s.id);
  const { data: schedules, error: schedErr } = await supabase
    .from(SCHEDULE_TABLE)
    .select('service_id, barangay_id, active')
    .in('service_id', ids)
    .eq('active', true);
  throwOnError(schedErr, 'Could not load schedules');

  const bookable = new Set(
    (schedules || [])
      .filter((s) => s.barangay_id === null || s.barangay_id === resident.barangay_id)
      .map((s) => s.service_id),
  );

  return inScope
    .filter((s) => bookable.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, category: s.category || 'Other', description: s.description || '' }));
};

/** Capacity + taken count for one (service, barangay, date, time) slot. */
const slotTaken = (appointments, dateStr) => {
  const map = new Map();
  for (const a of appointments || []) {
    const d = a.confirmed_date || a.requested_date;
    if (d !== dateStr) continue;
    const t = hhmm(a.confirmed_time || a.requested_time);
    map.set(t, (map.get(t) || 0) + 1);
  }
  return map;
};

/** Available dates/time slots for a service on a given date, for the resident. */
export const availability = async ({ user, serviceId, date, supabase = getServiceClient() }) => {
  const resident = await ownResident(supabase, user);

  const { data: service, error: svcErr } = await supabase
    .from(SERVICE_TABLE)
    .select('id, name, municipality_id, barangay_id, active')
    .eq('id', serviceId)
    .maybeSingle();
  throwOnError(svcErr, 'Could not load the service');
  if (!service || service.active !== true) {
    return { date, slots: [], available: false, message: 'This service is not available for booking.' };
  }
  const scopeOk =
    (service.municipality_id === null || service.municipality_id === resident.municipality_id)
    && (service.barangay_id === null || service.barangay_id === resident.barangay_id);
  if (!scopeOk) {
    return { date, slots: [], available: false, message: 'This service is not offered in your barangay.' };
  }

  const weekday = weekdayOf(date);

  const [{ data: schedules, error: schedErr }, { data: blackouts, error: blackErr }, { data: appts, error: apptErr }] =
    await Promise.all([
      supabase
        .from(SCHEDULE_TABLE)
        .select('weekday, start_time, end_time, slot_minutes, capacity_per_slot, barangay_id, active')
        .eq('service_id', serviceId)
        .eq('active', true)
        .eq('weekday', weekday),
      supabase
        .from(BLACKOUT_TABLE)
        .select('blackout_date, barangay_id, reason')
        .eq('service_id', serviceId)
        .eq('blackout_date', date),
      supabase
        .from(TABLE)
        .select('requested_date, requested_time, confirmed_date, confirmed_time')
        .eq('service_id', serviceId)
        .in('status', ACTIVE_STATUSES),
    ]);
  throwOnError(schedErr || blackErr || apptErr, 'Could not load availability');

  const scopedSchedules = (schedules || []).filter(
    (s) => s.barangay_id === null || s.barangay_id === resident.barangay_id,
  );
  if (scopedSchedules.length === 0) {
    return { date, slots: [], available: false, message: 'No clinic hours are configured for this date. Please choose another date.' };
  }

  const blackout = (blackouts || []).find((b) => b.barangay_id === null || b.barangay_id === resident.barangay_id);
  if (blackout) {
    return {
      date,
      slots: [],
      available: false,
      message: blackout.reason ? `Closed: ${blackout.reason}. Please choose another date.` : 'The health center is closed on this date. Please choose another date.',
    };
  }

  // Merge all matching schedules into a time -> capacity map (max capacity wins,
  // matching the booking RPC's max(capacity_per_slot)).
  const capacityByTime = new Map();
  for (const s of scopedSchedules) {
    for (const t of generateTimes(hhmm(s.start_time), hhmm(s.end_time), s.slot_minutes)) {
      capacityByTime.set(t, Math.max(capacityByTime.get(t) || 0, s.capacity_per_slot));
    }
  }

  const taken = slotTaken(appts, date);
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const slots = [...capacityByTime.keys()]
    .sort()
    .map((time) => {
      const capacity = capacityByTime.get(time);
      const used = taken.get(time) || 0;
      const remaining = Math.max(0, capacity - used);
      const past = date < todayStr || (date === todayStr && time <= nowHHMM);
      return { time, capacity, remaining, available: remaining > 0 && !past };
    });

  const anyOpen = slots.some((s) => s.available);
  return {
    date,
    slots,
    available: anyOpen,
    message: anyOpen ? '' : 'No open time slots for this date. Please choose another date.',
  };
};

// ---------------------------------------------------------------------------
// Resident actions
// ---------------------------------------------------------------------------
const RPC_ERRORS = {
  RESIDENT_NOT_FOUND: () => ApiError.notFound('No resident record is linked to your account.'),
  SERVICE_UNAVAILABLE: () => ApiError.unprocessable('This service is not available for booking.'),
  SERVICE_OUT_OF_SCOPE: () => ApiError.forbidden('This service is not offered in your barangay.'),
  DATE_IN_PAST: () => ApiError.unprocessable('The appointment date cannot be in the past.'),
  SLOT_UNAVAILABLE: () => ApiError.unprocessable('That time slot is not available. Please choose another slot.'),
  SLOT_FULL: () => ApiError.conflict('That time slot is already full. Please choose another slot.'),
  DUPLICATE_APPOINTMENT: () => ApiError.conflict('You already have a request for this service at that time.'),
};

const mapRpcError = (error) => {
  const message = String(error?.message || '');
  for (const key of Object.keys(RPC_ERRORS)) {
    if (message.includes(key)) return RPC_ERRORS[key]();
  }
  return Object.assign(new Error(message || 'Could not book the appointment'), { statusCode: 500, details: error });
};

const notifyServicePersonnel = async (supabase, { serviceId, reference, serviceName, barangay }) => {
  const { data, error } = await supabase
    .from(ASSIGN_TABLE)
    .select('personnel_id')
    .eq('service_id', serviceId)
    .eq('active', true);
  if (error) return; // best-effort
  await Promise.all(
    (data || [])
      .map((a) => a.personnel_id)
      .filter(Boolean)
      .map((personnelId) =>
        notifyResident({
          recipientAuthUserId: personnelId,
          category: 'information',
          title: 'New appointment request',
          message: `A resident requested "${serviceName}"${barangay ? ` in ${barangay}` : ''} (${reference}).`,
          relatedType: TABLE,
          relatedId: reference,
        }),
      ),
  );
};

/** A resident books a service slot. Concurrency-safe via the booking RPC. */
export const book = async ({ user, serviceId, date, time, reason = '', supabase = getServiceClient() }) => {
  const resident = await ownResident(supabase, user);

  const { data, error } = await supabase.rpc('book_resident_appointment', {
    p_resident_id: resident.id,
    p_service_id: serviceId,
    p_requested_date: date,
    p_requested_time: time,
    p_reason: text(reason),
  });
  if (error) throw mapRpcError(error);
  const inserted = Array.isArray(data) ? data[0] : data;
  if (!inserted) throw ApiError.unprocessable('Could not book the appointment.');

  // Re-read with the display embeds, then best-effort notify.
  const { data: row } = await supabase.from(TABLE).select(BASE_SELECT).eq('id', inserted.id).maybeSingle();
  const mapped = toAppointment(row || inserted);

  await audit(supabase, user, 'APPOINTMENT_REQUESTED', inserted.id, inserted);
  await notifyResident({
    recipientAuthUserId: resident.auth_user_id,
    category: 'information',
    title: 'Appointment request submitted',
    message: `Your request for "${mapped.service || 'a health service'}" on ${mapped.requestedDate} is pending confirmation (${mapped.reference}).`,
    relatedType: TABLE,
    relatedId: mapped.reference,
  }).catch(() => {});
  await notifyServicePersonnel(supabase, {
    serviceId,
    reference: mapped.reference,
    serviceName: mapped.service,
    barangay: resident.barangay,
  }).catch(() => {});

  return mapped;
};

export const listOwn = async ({ user, supabase = getServiceClient() }) => {
  const resident = await ownResident(supabase, user);
  const { data, error } = await supabase
    .from(TABLE)
    .select(BASE_SELECT)
    .eq('resident_id', resident.id)
    .order('requested_date', { ascending: false })
    .limit(200);
  throwOnError(error, 'Could not load your appointments');
  return (data || []).map((row) => toAppointment(row));
};

const ownAppointment = async (supabase, resident, id) => {
  const { data, error } = await supabase.from(TABLE).select(BASE_SELECT).eq('id', id).maybeSingle();
  throwOnError(error, 'Could not load the appointment');
  if (!data || data.resident_id !== resident.id) throw ApiError.notFound('Appointment not found.');
  return data;
};

export const getOwn = async ({ user, id, supabase = getServiceClient() }) => {
  const resident = await ownResident(supabase, user);
  const row = await ownAppointment(supabase, resident, id);
  return toAppointment(row);
};

/**
 * A resident cancels their OWN request. Pending and reschedule-proposed
 * requests may be cancelled directly; an already-approved appointment must be
 * cancelled through staff (the resident is told to contact the health center),
 * honoring the distinction between a pending request and a confirmed booking.
 */
export const cancelOwn = async ({ user, id, reason = '', supabase = getServiceClient() }) => {
  const resident = await ownResident(supabase, user);
  const row = await ownAppointment(supabase, resident, id);

  if (row.status === 'approved') {
    throw ApiError.conflict('This appointment is already confirmed. Please contact your health center to cancel it.');
  }
  if (!['pending', 'reschedule_proposed'].includes(row.status)) {
    throw ApiError.conflict('This appointment can no longer be cancelled.');
  }

  const updated = await applyUpdate(supabase, id, {
    status: 'cancelled',
    decision_reason: text(reason),
    decided_by: null,
    decided_at: new Date().toISOString(),
  });
  await audit(supabase, user, 'APPOINTMENT_CANCELLED_BY_RESIDENT', id, row);
  await notifyDecider(supabase, row, 'A resident cancelled their appointment request.');
  return toAppointment(updated);
};

/** A resident accepts or declines a staff-proposed alternative schedule. */
export const respondToProposal = async ({ user, id, decision, reason = '', supabase = getServiceClient() }) => {
  const resident = await ownResident(supabase, user);
  const row = await ownAppointment(supabase, resident, id);

  if (row.status !== 'reschedule_proposed') {
    throw ApiError.conflict('There is no proposed schedule awaiting your response.');
  }

  if (decision === 'accept') {
    // Re-check capacity for the proposed slot before confirming.
    await assertSlotHasRoom(supabase, {
      serviceId: row.service_id,
      date: row.proposed_date,
      time: hhmm(row.proposed_time),
      excludeId: row.id,
    });
    const updated = await applyUpdate(supabase, id, {
      status: 'approved',
      confirmed_date: row.proposed_date,
      confirmed_time: row.proposed_time,
      proposed_date: null,
      proposed_time: null,
      decided_at: new Date().toISOString(),
    });
    await audit(supabase, user, 'APPOINTMENT_PROPOSAL_ACCEPTED', id, row);
    await notifyDecider(supabase, row, 'A resident accepted the proposed appointment schedule.');
    return toAppointment(updated);
  }

  const updated = await applyUpdate(supabase, id, {
    status: 'declined',
    decision_reason: text(reason),
    decided_at: new Date().toISOString(),
  });
  await audit(supabase, user, 'APPOINTMENT_PROPOSAL_DECLINED', id, row);
  await notifyDecider(supabase, row, 'A resident declined the proposed appointment schedule.');
  return toAppointment(updated);
};

// ---------------------------------------------------------------------------
// Staff actions
// ---------------------------------------------------------------------------
const assertManager = (user) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');
  if (!MANAGE_ROLES.has(user.role)) {
    throw ApiError.forbidden('Your role is not authorized to manage appointments.');
  }
};

/** Confine a query to the caller's barangay / municipality. */
const applyStaffScope = (query, user) => {
  if (BARANGAY_SCOPED.has(user.role)) {
    if (!user.barangayId) throw ApiError.forbidden('Your account has no barangay assignment.');
    return query.eq('barangay_id', user.barangayId);
  }
  if (MUNICIPALITY_WIDE.has(user.role)) {
    if (!user.municipalityId) throw ApiError.forbidden('Your account has no municipality assignment.');
    return query.eq('municipality_id', user.municipalityId);
  }
  throw ApiError.forbidden('Your role is not authorized to manage appointments.');
};

const appointmentInScope = (user, row) => {
  if (BARANGAY_SCOPED.has(user.role)) return row.barangay_id === user.barangayId;
  if (MUNICIPALITY_WIDE.has(user.role)) return row.municipality_id === user.municipalityId;
  return false;
};

export const staffList = async ({ user, query = {}, supabase = getServiceClient() }) => {
  assertManager(user);
  let request = supabase.from(TABLE).select(STAFF_SELECT);
  request = applyStaffScope(request, user);

  const status = text(query.status);
  if (status) request = request.eq('status', status);
  const serviceId = text(query.serviceId || query.service_id);
  if (serviceId) request = request.eq('service_id', serviceId);
  const date = text(query.date);
  if (date) request = request.eq('requested_date', date);
  const from = text(query.from);
  if (from) request = request.gte('requested_date', from);
  const to = text(query.to);
  if (to) request = request.lte('requested_date', to);

  const { data, error } = await request.order('requested_date', { ascending: true }).limit(500);
  throwOnError(error, 'Could not load appointments');
  return (data || []).map((row) => toAppointment(row, { includeResident: true }));
};

const loadForStaff = async (supabase, user, id) => {
  const { data, error } = await supabase.from(TABLE).select(STAFF_SELECT).eq('id', id).maybeSingle();
  throwOnError(error, 'Could not load the appointment');
  if (!data || !appointmentInScope(user, data)) throw ApiError.notFound('Appointment not found.');
  return data;
};

export const staffGet = async ({ user, id, supabase = getServiceClient() }) => {
  assertManager(user);
  const row = await loadForStaff(supabase, user, id);
  return toAppointment(row, { includeResident: true });
};

const applyUpdate = async (supabase, id, patch) => {
  const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select(STAFF_SELECT).maybeSingle();
  throwOnError(error, 'Could not update the appointment');
  if (!data) throw ApiError.conflict('The appointment could not be updated.');
  return data;
};

/** Count active appointments on a slot (optionally excluding one id). */
const assertSlotHasRoom = async (supabase, { serviceId, date, time, excludeId = null }) => {
  const weekday = weekdayOf(date);
  const { data: schedules, error: schedErr } = await supabase
    .from(SCHEDULE_TABLE)
    .select('capacity_per_slot, start_time, end_time, weekday, active')
    .eq('service_id', serviceId)
    .eq('active', true)
    .eq('weekday', weekday);
  throwOnError(schedErr, 'Could not verify availability');
  const capacity = (schedules || [])
    .filter((s) => hhmm(s.start_time) <= time && hhmm(s.end_time) > time)
    .reduce((max, s) => Math.max(max, s.capacity_per_slot), 0);
  if (capacity <= 0) throw ApiError.unprocessable('That slot is outside the configured clinic hours.');

  const { data: appts, error: apptErr } = await supabase
    .from(TABLE)
    .select('id, requested_date, requested_time, confirmed_date, confirmed_time')
    .eq('service_id', serviceId)
    .in('status', ACTIVE_STATUSES);
  throwOnError(apptErr, 'Could not verify availability');
  const taken = (appts || []).filter((a) => {
    if (excludeId && a.id === excludeId) return false;
    const d = a.confirmed_date || a.requested_date;
    const t = hhmm(a.confirmed_time || a.requested_time);
    return d === date && t === time;
  }).length;
  if (taken >= capacity) throw ApiError.conflict('That time slot is already full.');
};

const stampDecision = (user) => ({ decided_by: user.id, decided_at: new Date().toISOString() });

/** Staff approve the (requested or overridden) schedule. */
export const approve = async ({ user, id, date = null, time = null, note = '', supabase = getServiceClient() }) => {
  assertManager(user);
  const row = await loadForStaff(supabase, user, id);
  if (!['pending', 'reschedule_proposed'].includes(row.status)) {
    throw ApiError.conflict('Only a pending request can be approved.');
  }
  const confirmedDate = date || row.requested_date;
  const confirmedTime = time || hhmm(row.requested_time);
  await assertSlotHasRoom(supabase, { serviceId: row.service_id, date: confirmedDate, time: confirmedTime, excludeId: row.id });

  const updated = await applyUpdate(supabase, id, {
    status: 'approved',
    confirmed_date: confirmedDate,
    confirmed_time: confirmedTime,
    proposed_date: null,
    proposed_time: null,
    decision_reason: text(note),
    ...stampDecision(user),
  });
  await audit(supabase, user, 'APPOINTMENT_APPROVED', id, row);
  await notifyResidentOf(supabase, row, {
    title: 'Appointment approved',
    message: `Your appointment for "${row.service?.name || 'a health service'}" is confirmed for ${confirmedDate} at ${confirmedTime} (${row.reference}).`,
  });
  return toAppointment(updated, { includeResident: true });
};

export const decline = async ({ user, id, reason, supabase = getServiceClient() }) => {
  assertManager(user);
  const row = await loadForStaff(supabase, user, id);
  if (!['pending', 'reschedule_proposed'].includes(row.status)) {
    throw ApiError.conflict('Only a pending request can be declined.');
  }
  const updated = await applyUpdate(supabase, id, {
    status: 'declined',
    decision_reason: text(reason),
    ...stampDecision(user),
  });
  await audit(supabase, user, 'APPOINTMENT_DECLINED', id, row);
  await notifyResidentOf(supabase, row, {
    title: 'Appointment request declined',
    message: `Your request for "${row.service?.name || 'a health service'}" (${row.reference}) was declined. Reason: ${text(reason)}`,
  });
  return toAppointment(updated, { includeResident: true });
};

/** Staff propose an alternative schedule; awaits the resident's response. */
export const propose = async ({ user, id, date, time, note = '', supabase = getServiceClient() }) => {
  assertManager(user);
  const row = await loadForStaff(supabase, user, id);
  if (row.status !== 'pending') {
    throw ApiError.conflict('Only a pending request can be rescheduled.');
  }
  await assertSlotHasRoom(supabase, { serviceId: row.service_id, date, time, excludeId: row.id });

  const updated = await applyUpdate(supabase, id, {
    status: 'reschedule_proposed',
    proposed_date: date,
    proposed_time: time,
    decision_reason: text(note),
    ...stampDecision(user),
  });
  await audit(supabase, user, 'APPOINTMENT_RESCHEDULE_PROPOSED', id, row);
  await notifyResidentOf(supabase, row, {
    title: 'New appointment schedule proposed',
    message: `A new schedule (${date} at ${time}) was proposed for "${row.service?.name || 'your appointment'}" (${row.reference}). Please accept or decline it.`,
  });
  return toAppointment(updated, { includeResident: true });
};

/** Staff cancel an appointment (pending, proposed or approved). */
export const cancel = async ({ user, id, reason = '', supabase = getServiceClient() }) => {
  assertManager(user);
  const row = await loadForStaff(supabase, user, id);
  if (!['pending', 'reschedule_proposed', 'approved'].includes(row.status)) {
    throw ApiError.conflict('This appointment can no longer be cancelled.');
  }
  const updated = await applyUpdate(supabase, id, {
    status: 'cancelled',
    decision_reason: text(reason),
    ...stampDecision(user),
  });
  await audit(supabase, user, 'APPOINTMENT_CANCELLED_BY_STAFF', id, row);
  await notifyResidentOf(supabase, row, {
    title: 'Appointment cancelled',
    message: `Your appointment for "${row.service?.name || 'a health service'}" (${row.reference}) was cancelled.${text(reason) ? ` Reason: ${text(reason)}` : ''}`,
  });
  return toAppointment(updated, { includeResident: true });
};

/**
 * Record the final outcome after the visit — completed or missed. A missed
 * status is NEVER assigned automatically by elapsed time; it requires this
 * authorized staff action on an already-approved appointment.
 */
export const setOutcome = async ({ user, id, status, note = '', supabase = getServiceClient() }) => {
  assertManager(user);
  const row = await loadForStaff(supabase, user, id);
  if (row.status !== 'approved') {
    throw ApiError.conflict('Only an approved appointment can be marked completed or missed.');
  }
  const updated = await applyUpdate(supabase, id, {
    status,
    decision_reason: text(note),
    ...stampDecision(user),
  });
  await audit(supabase, user, status === 'completed' ? 'APPOINTMENT_COMPLETED' : 'APPOINTMENT_MISSED', id, row);
  await notifyResidentOf(supabase, row, {
    title: status === 'completed' ? 'Appointment completed' : 'Appointment marked as missed',
    message: status === 'completed'
      ? `Your appointment for "${row.service?.name || 'a health service'}" (${row.reference}) was marked completed.`
      : `Your appointment for "${row.service?.name || 'a health service'}" (${row.reference}) was marked as missed.`,
  });
  return toAppointment(updated, { includeResident: true });
};

// ---------------------------------------------------------------------------
// Schedule + blackout management (authorized staff)
// ---------------------------------------------------------------------------
const loadManageableService = async (supabase, user, serviceId) => {
  const { data, error } = await supabase
    .from(SERVICE_TABLE)
    .select('id, municipality_id, barangay_id, active')
    .eq('id', serviceId)
    .maybeSingle();
  throwOnError(error, 'Could not load the service');
  if (!data) throw ApiError.notFound('Health service not found.');
  const inMunicipality = user.municipalityId && data.municipality_id === user.municipalityId;
  if (BARANGAY_SCOPED.has(user.role)) {
    if (!inMunicipality || !user.barangayId || (data.barangay_id !== null && data.barangay_id !== user.barangayId)) {
      throw ApiError.notFound('Health service not found.');
    }
  } else if (MUNICIPALITY_WIDE.has(user.role)) {
    if (!inMunicipality) throw ApiError.notFound('Health service not found.');
  } else {
    throw ApiError.forbidden('Your role is not authorized to manage schedules.');
  }
  return data;
};

const scheduleBarangay = (user, service, requestedBarangayId) => {
  if (BARANGAY_SCOPED.has(user.role)) return user.barangayId;
  return requestedBarangayId || service.barangay_id || null;
};

export const listSchedules = async ({ user, query = {}, supabase = getServiceClient() }) => {
  assertManager(user);
  const serviceId = text(query.serviceId || query.service_id);
  let request = supabase.from(SCHEDULE_TABLE).select('*').order('weekday').order('start_time');
  if (serviceId) {
    await loadManageableService(supabase, user, serviceId);
    request = request.eq('service_id', serviceId);
  } else if (BARANGAY_SCOPED.has(user.role)) {
    request = request.eq('barangay_id', user.barangayId);
  } else {
    request = request.eq('municipality_id', user.municipalityId);
  }
  const { data, error } = await request;
  throwOnError(error, 'Could not load schedules');
  return (data || []).map(toSchedule);
};

const toSchedule = (row) => ({
  id: row.id,
  serviceId: row.service_id,
  municipalityId: row.municipality_id || null,
  barangayId: row.barangay_id || null,
  weekday: row.weekday,
  startTime: hhmm(row.start_time),
  endTime: hhmm(row.end_time),
  slotMinutes: row.slot_minutes,
  capacityPerSlot: row.capacity_per_slot,
  active: row.active !== false,
});

export const createSchedule = async ({ user, payload = {}, supabase = getServiceClient() }) => {
  assertManager(user);
  const service = await loadManageableService(supabase, user, payload.serviceId);
  const barangayId = scheduleBarangay(user, service, payload.barangayId);
  const row = {
    service_id: payload.serviceId,
    municipality_id: service.municipality_id,
    barangay_id: barangayId,
    weekday: payload.weekday,
    start_time: payload.startTime,
    end_time: payload.endTime,
    slot_minutes: payload.slotMinutes,
    capacity_per_slot: payload.capacityPerSlot,
    active: payload.active !== false,
    created_by: user.id,
  };
  const { data, error } = await supabase.from(SCHEDULE_TABLE).insert(row).select('*').single();
  throwOnError(error, 'Could not create the schedule');
  return toSchedule(data);
};

export const updateSchedule = async ({ user, id, payload = {}, supabase = getServiceClient() }) => {
  assertManager(user);
  const { data: current, error: curErr } = await supabase.from(SCHEDULE_TABLE).select('*').eq('id', id).maybeSingle();
  throwOnError(curErr, 'Could not load the schedule');
  if (!current) throw ApiError.notFound('Schedule not found.');
  await loadManageableService(supabase, user, current.service_id);
  if (BARANGAY_SCOPED.has(user.role) && current.barangay_id !== user.barangayId) {
    throw ApiError.notFound('Schedule not found.');
  }
  const patch = {
    weekday: payload.weekday,
    start_time: payload.startTime,
    end_time: payload.endTime,
    slot_minutes: payload.slotMinutes,
    capacity_per_slot: payload.capacityPerSlot,
    active: payload.active !== false,
  };
  const { data, error } = await supabase.from(SCHEDULE_TABLE).update(patch).eq('id', id).select('*').single();
  throwOnError(error, 'Could not update the schedule');
  return toSchedule(data);
};

export const deleteSchedule = async ({ user, id, supabase = getServiceClient() }) => {
  assertManager(user);
  const { data: current, error: curErr } = await supabase.from(SCHEDULE_TABLE).select('*').eq('id', id).maybeSingle();
  throwOnError(curErr, 'Could not load the schedule');
  if (!current) throw ApiError.notFound('Schedule not found.');
  await loadManageableService(supabase, user, current.service_id);
  if (BARANGAY_SCOPED.has(user.role) && current.barangay_id !== user.barangayId) {
    throw ApiError.notFound('Schedule not found.');
  }
  const { error } = await supabase.from(SCHEDULE_TABLE).delete().eq('id', id);
  throwOnError(error, 'Could not remove the schedule');
  return { id, removed: true };
};

export const listBlackouts = async ({ user, query = {}, supabase = getServiceClient() }) => {
  assertManager(user);
  const serviceId = text(query.serviceId || query.service_id);
  if (!serviceId) throw ApiError.badRequest('A service reference is required.');
  await loadManageableService(supabase, user, serviceId);
  const { data, error } = await supabase
    .from(BLACKOUT_TABLE)
    .select('*')
    .eq('service_id', serviceId)
    .order('blackout_date', { ascending: true });
  throwOnError(error, 'Could not load closures');
  return (data || []).map((r) => ({
    id: r.id,
    serviceId: r.service_id,
    barangayId: r.barangay_id || null,
    date: r.blackout_date,
    reason: r.reason || '',
  }));
};

export const createBlackout = async ({ user, payload = {}, supabase = getServiceClient() }) => {
  assertManager(user);
  const service = await loadManageableService(supabase, user, payload.serviceId);
  const barangayId = scheduleBarangay(user, service, payload.barangayId);
  const { data, error } = await supabase
    .from(BLACKOUT_TABLE)
    .insert({
      service_id: payload.serviceId,
      barangay_id: barangayId,
      blackout_date: payload.date,
      reason: text(payload.reason),
      created_by: user.id,
    })
    .select('*')
    .single();
  throwOnError(error, 'Could not create the closure');
  return { id: data.id, serviceId: data.service_id, barangayId: data.barangay_id || null, date: data.blackout_date, reason: data.reason || '' };
};

export const deleteBlackout = async ({ user, id, supabase = getServiceClient() }) => {
  assertManager(user);
  const { data: current, error: curErr } = await supabase.from(BLACKOUT_TABLE).select('*').eq('id', id).maybeSingle();
  throwOnError(curErr, 'Could not load the closure');
  if (!current) throw ApiError.notFound('Closure not found.');
  await loadManageableService(supabase, user, current.service_id);
  const { error } = await supabase.from(BLACKOUT_TABLE).delete().eq('id', id);
  throwOnError(error, 'Could not remove the closure');
  return { id, removed: true };
};

// ---------------------------------------------------------------------------
// Audit + notifications
// ---------------------------------------------------------------------------
async function audit(supabase, user, action, entityId, row) {
  await supabase
    .from('health_audit_logs')
    .insert({
      actor_id: user.id,
      action,
      entity_type: TABLE,
      entity_id: String(entityId),
      municipality_id: row?.municipality_id || null,
      barangay_id: row?.barangay_id || null,
      metadata: {},
    })
    .then(() => {}, () => {});
}

async function notifyResidentOf(supabase, row, { title, message }) {
  const authUserId = await residentAuthUser(supabase, row.resident_id).catch(() => null);
  if (!authUserId) return;
  await notifyResident({
    recipientAuthUserId: authUserId,
    category: 'information',
    title,
    message,
    relatedType: TABLE,
    relatedId: row.reference,
  }).catch(() => {});
}

async function notifyDecider(supabase, row, message) {
  if (!row.decided_by) return;
  await notifyResident({
    recipientAuthUserId: row.decided_by,
    category: 'information',
    title: 'Appointment update',
    message: `${message} (${row.reference})`,
    relatedType: TABLE,
    relatedId: row.reference,
  }).catch(() => {});
}

export default {
  ACTIVE_STATUSES,
  listAvailableServices,
  availability,
  book,
  listOwn,
  getOwn,
  cancelOwn,
  respondToProposal,
  staffList,
  staffGet,
  approve,
  decline,
  propose,
  cancel,
  setOutcome,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  listBlackouts,
  createBlackout,
  deleteBlackout,
};
