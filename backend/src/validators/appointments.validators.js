/**
 * Appointment booking validators (server-authoritative).
 *
 * Convention with middleware/validate.js:
 *   validator(input, req) -> { value }            // accepted, replaces req[part]
 *                         -> { error: { field } } // rejected with 400 + details
 *
 * These re-validate every request before it reaches the service. The service
 * still enforces authorization, ownership, scope and slot capacity — these
 * validators only normalize shape and reject obviously invalid input.
 */
import { invalid, valid, text, isUuid, parseDateOnly } from './common.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const REASON_MAX = 500;
const NOTE_MAX = 500;

const isTime = (value) => TIME_24H.test(text(value));
const isDateOnly = (value) => parseDateOnly(text(value)) !== null;
const toInt = (value) => {
  const n = Number(text(value));
  return Number.isInteger(n) ? n : null;
};

/** POST /resident/appointments — a resident books a service slot. */
export const bookValidator = (input = {}) => {
  const errors = {};
  const serviceId = text(input.serviceId || input.service_id);
  const date = text(input.date || input.requestedDate || input.requested_date);
  const time = text(input.time || input.requestedTime || input.requested_time);
  const reason = text(input.reason);

  if (!isUuid(serviceId)) errors.serviceId = 'Select a valid health service.';
  if (!isDateOnly(date)) errors.date = 'Select a valid appointment date.';
  if (!isTime(time)) errors.time = 'Select a valid appointment time.';
  if (reason.length > REASON_MAX) errors.reason = `Reason must be ${REASON_MAX} characters or fewer.`;
  if (Object.keys(errors).length) return invalid(errors);

  return valid({ serviceId, date, time, reason });
};

/** GET /resident/appointments/availability?serviceId=&date= */
export const availabilityQueryValidator = (input = {}) => {
  const errors = {};
  const serviceId = text(input.serviceId || input.service_id);
  const date = text(input.date);
  if (!isUuid(serviceId)) errors.serviceId = 'A valid service reference is required.';
  if (!isDateOnly(date)) errors.date = 'A valid date is required.';
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ serviceId, date });
};

/** Optional reason body (resident cancel, decline a proposal). */
export const reasonBodyValidator = (input = {}) => {
  const reason = text(input.reason);
  if (reason.length > NOTE_MAX) return invalid({ reason: `Reason must be ${NOTE_MAX} characters or fewer.` });
  return valid({ reason });
};

/** Staff approve: optionally override the confirmed schedule. */
export const approveValidator = (input = {}) => {
  const errors = {};
  const date = text(input.date || input.confirmedDate || input.confirmed_date);
  const time = text(input.time || input.confirmedTime || input.confirmed_time);
  const note = text(input.note);
  if (date && !isDateOnly(date)) errors.date = 'Enter a valid confirmed date.';
  if (time && !isTime(time)) errors.time = 'Enter a valid confirmed time.';
  if ((date && !time) || (time && !date)) {
    errors.time = 'Provide both a confirmed date and time, or neither.';
  }
  if (note.length > NOTE_MAX) errors.note = `Note must be ${NOTE_MAX} characters or fewer.`;
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ date: date || null, time: time || null, note });
};

/** Staff decline: a reason is required. */
export const declineValidator = (input = {}) => {
  const reason = text(input.reason);
  if (!reason) return invalid({ reason: 'A reason is required to decline a request.' });
  if (reason.length > NOTE_MAX) return invalid({ reason: `Reason must be ${NOTE_MAX} characters or fewer.` });
  return valid({ reason });
};

/** Staff propose an alternative schedule: date + time required. */
export const proposeValidator = (input = {}) => {
  const errors = {};
  const date = text(input.date || input.proposedDate || input.proposed_date);
  const time = text(input.time || input.proposedTime || input.proposed_time);
  const note = text(input.note);
  if (!isDateOnly(date)) errors.date = 'Select a valid proposed date.';
  if (!isTime(time)) errors.time = 'Select a valid proposed time.';
  if (note.length > NOTE_MAX) errors.note = `Note must be ${NOTE_MAX} characters or fewer.`;
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ date, time, note });
};

/** Staff set final attendance outcome: completed | missed. */
export const outcomeValidator = (input = {}) => {
  const status = text(input.status).toLowerCase();
  if (!['completed', 'missed'].includes(status)) {
    return invalid({ status: 'Status must be completed or missed.' });
  }
  const note = text(input.note);
  if (note.length > NOTE_MAX) return invalid({ note: `Note must be ${NOTE_MAX} characters or fewer.` });
  return valid({ status, note });
};

/** Resident response to a proposed schedule: accept | decline. */
export const proposalResponseValidator = (input = {}) => {
  const decision = text(input.decision).toLowerCase();
  if (!['accept', 'decline'].includes(decision)) {
    return invalid({ decision: 'Decision must be accept or decline.' });
  }
  const reason = text(input.reason);
  if (reason.length > NOTE_MAX) return invalid({ reason: `Reason must be ${NOTE_MAX} characters or fewer.` });
  return valid({ decision, reason });
};

/** Create / update a service availability schedule row (staff). */
export const scheduleValidator = (input = {}) => {
  const errors = {};
  const serviceId = text(input.serviceId || input.service_id);
  const weekday = toInt(input.weekday);
  const startTime = text(input.startTime || input.start_time);
  const endTime = text(input.endTime || input.end_time);
  const slotMinutes = toInt(input.slotMinutes ?? input.slot_minutes ?? 30);
  const capacity = toInt(input.capacityPerSlot ?? input.capacity_per_slot ?? 1);
  const barangayId = text(input.barangayId || input.barangay_id);

  if (!isUuid(serviceId)) errors.serviceId = 'Select a valid health service.';
  if (weekday === null || !WEEKDAYS.includes(weekday)) errors.weekday = 'Select a valid day of the week.';
  if (!isTime(startTime)) errors.startTime = 'Enter a valid start time.';
  if (!isTime(endTime)) errors.endTime = 'Enter a valid end time.';
  if (isTime(startTime) && isTime(endTime) && endTime <= startTime) {
    errors.endTime = 'End time must be after the start time.';
  }
  if (slotMinutes === null || slotMinutes < 5 || slotMinutes > 480) {
    errors.slotMinutes = 'Slot length must be between 5 and 480 minutes.';
  }
  if (capacity === null || capacity < 1 || capacity > 100) {
    errors.capacityPerSlot = 'Capacity must be between 1 and 100.';
  }
  if (barangayId && !isUuid(barangayId)) errors.barangayId = 'The selected barangay is not valid.';
  if (Object.keys(errors).length) return invalid(errors);

  return valid({
    serviceId,
    weekday,
    startTime,
    endTime,
    slotMinutes,
    capacityPerSlot: capacity,
    barangayId: barangayId || null,
    active: input.active !== false,
  });
};

/** Create a blackout (closure) date for a service. */
export const blackoutValidator = (input = {}) => {
  const errors = {};
  const serviceId = text(input.serviceId || input.service_id);
  const date = text(input.date || input.blackoutDate || input.blackout_date);
  const reason = text(input.reason);
  const barangayId = text(input.barangayId || input.barangay_id);
  if (!isUuid(serviceId)) errors.serviceId = 'Select a valid health service.';
  if (!isDateOnly(date)) errors.date = 'Select a valid date.';
  if (reason.length > NOTE_MAX) errors.reason = `Reason must be ${NOTE_MAX} characters or fewer.`;
  if (barangayId && !isUuid(barangayId)) errors.barangayId = 'The selected barangay is not valid.';
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ serviceId, date, reason, barangayId: barangayId || null });
};

/** :id path param must be a UUID. */
export const idParamValidator = (input = {}) => {
  if (!UUID.test(text(input.id))) return invalid({ id: 'Appointment not found.' });
  return valid(input);
};

export const scheduleIdParamValidator = (input = {}) => {
  if (!UUID.test(text(input.id))) return invalid({ id: 'Schedule not found.' });
  return valid(input);
};

export default {
  bookValidator,
  availabilityQueryValidator,
  reasonBodyValidator,
  approveValidator,
  declineValidator,
  proposeValidator,
  outcomeValidator,
  proposalResponseValidator,
  scheduleValidator,
  blackoutValidator,
  idParamValidator,
  scheduleIdParamValidator,
};
