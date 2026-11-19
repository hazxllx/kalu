/**
 * @file Appointment booking & clinic schedule validators (server-authoritative).
 *
 * Fits into the KALUSAGAP request pipeline (`route -> authenticate -> authorize ->
 * validate -> controller -> service -> repository/Supabase`) via `middleware/validate.js`:
 *   validator(input, req) -> { value }            // accepted, replaces req[part]
 *                         -> { error: { field } } // rejected with HTTP 400 + details
 *
 * These validators normalize camelCase/snake_case request payloads and reject
 * malformed dates, times, UUIDs, and over-length notes before controller execution.
 * Downstream appointment services still enforce RBAC, resident ownership,
 * barangay/RHU scope, blackout dates, and per-slot capacity limits.
 */
import { invalid, valid, text, isUuid, parseDateOnly } from './common.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 24-hour clock format `HH:MM` (`00:00` through `23:59`). */
const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;
/** JavaScript `Date.prototype.getUTCDay()` / `getDay()` indices (`0` = Sunday .. `6` = Saturday). */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const REASON_MAX = 500;
const NOTE_MAX = 500;

const isTime = (value) => TIME_24H.test(text(value));
const isDateOnly = (value) => parseDateOnly(text(value)) !== null;
/** Coerces a scalar input to a finite integer, returning `null` for blanks or non-integers. */
const toInt = (value) => {
  const n = Number(text(value));
  return Number.isInteger(n) ? n : null;
};

/**
 * Validates `POST /resident/appointments` payloads when a resident books a health service slot.
 * Accepts camelCase or snake_case field aliases (`serviceId`/`service_id`,
 * `date`/`requestedDate`/`requested_date`, `time`/`requestedTime`/`requested_time`)
 * and normalizes them into `{ serviceId, date, time, reason }`.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
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

/**
 * Validates `GET /resident/appointments/availability` query parameters (`serviceId` and `date`).
 * Ensures both the target health service UUID and strict `YYYY-MM-DD` calendar date are present
 * before slot availability is computed.
 *
 * @param {Object} [input] - Raw query string object.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const availabilityQueryValidator = (input = {}) => {
  const errors = {};
  const serviceId = text(input.serviceId || input.service_id);
  const date = text(input.date);
  if (!isUuid(serviceId)) errors.serviceId = 'A valid service reference is required.';
  if (!isDateOnly(date)) errors.date = 'A valid date is required.';
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ serviceId, date });
};

/**
 * Validates optional free-text reason payloads (e.g., resident appointment cancellation).
 *
 * @param {Object} [input] - Raw request body containing optional `reason`.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const reasonBodyValidator = (input = {}) => {
  const reason = text(input.reason);
  if (reason.length > NOTE_MAX) return invalid({ reason: `Reason must be ${NOTE_MAX} characters or fewer.` });
  return valid({ reason });
};

/**
 * Validates staff appointment approval payloads.
 * Allows health personnel to confirm the resident's requested slot as-is (`date: null, time: null`)
 * or override the confirmed schedule, enforcing that `date` and `time` are supplied together.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
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

/**
 * Validates staff appointment decline payloads, requiring a non-empty explanation
 * so the resident knows why the booking request was turned down.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const declineValidator = (input = {}) => {
  const reason = text(input.reason);
  if (!reason) return invalid({ reason: 'A reason is required to decline a request.' });
  if (reason.length > NOTE_MAX) return invalid({ reason: `Reason must be ${NOTE_MAX} characters or fewer.` });
  return valid({ reason });
};

/**
 * Validates staff reschedule-proposal payloads when offering an alternative `date` and `time`
 * to a resident (accepts `proposedDate`/`proposed_date` and `proposedTime`/`proposed_time` aliases).
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
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

/**
 * Validates staff post-appointment attendance outcomes (`completed` or `missed`)
 * along with an optional clinical/administrative note.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const outcomeValidator = (input = {}) => {
  const status = text(input.status).toLowerCase();
  if (!['completed', 'missed'].includes(status)) {
    return invalid({ status: 'Status must be completed or missed.' });
  }
  const note = text(input.note);
  if (note.length > NOTE_MAX) return invalid({ note: `Note must be ${NOTE_MAX} characters or fewer.` });
  return valid({ status, note });
};

/**
 * Validates a resident's response (`accept` or `decline`) to a staff-proposed reschedule,
 * with an optional reason when declining.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const proposalResponseValidator = (input = {}) => {
  const decision = text(input.decision).toLowerCase();
  if (!['accept', 'decline'].includes(decision)) {
    return invalid({ decision: 'Decision must be accept or decline.' });
  }
  const reason = text(input.reason);
  if (reason.length > NOTE_MAX) return invalid({ reason: `Reason must be ${NOTE_MAX} characters or fewer.` });
  return valid({ decision, reason });
};

/**
 * Validates recurring weekly availability schedule definitions created/updated by health staff.
 * Enforces valid weekday (`0..6`), `endTime > startTime`, slot duration (`5..480` minutes,
 * default `30`), per-slot capacity (`1..100`, default `1`), optional barangay UUID scope,
 * and `active` flag (default `true`).
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
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

/**
 * Validates service blackout/closure date payloads (`date`/`blackoutDate`/`blackout_date`)
 * used to block appointment bookings on holidays or clinic closure days.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
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

/**
 * Validates `:id` route parameters for appointment endpoints as UUIDs.
 *
 * @param {Object} [input] - Route params object.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const idParamValidator = (input = {}) => {
  if (!UUID.test(text(input.id))) return invalid({ id: 'Appointment not found.' });
  return valid(input);
};

/**
 * Validates `:id` route parameters for availability schedule and blackout endpoints as UUIDs.
 *
 * @param {Object} [input] - Route params object.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
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
