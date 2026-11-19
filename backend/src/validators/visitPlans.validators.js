/**
 * @file Resident health-service visit-plan validators (server-authoritative).
 *
 * Executed by `middleware/validate.js` in the KALUSAGAP request pipeline
 * (`route -> authenticate -> authorize -> validate -> controller -> service -> repository/Supabase`):
 *   validator(input, req) -> { value }            // accepted, replaces req[part]
 *                         -> { error: { field } } // rejected with HTTP 400 + details
 *
 * Normalizes camelCase/snake_case fields and rejects malformed UUIDs, calendar dates,
 * and over-length notes (`<= 140` chars). Downstream visit-plan services still enforce
 * resident authorization/ownership, barangay/RHU service visibility, active scheduled
 * weekdays, and blackout closures.
 */
import { invalid, valid, text, isUuid, parseDateOnly } from './common.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Short note limit (140 chars) for lightweight resident visit-intent entries. */
const NOTE_MAX = 140;
const isDateOnly = (value) => parseDateOnly(text(value)) !== null;

/**
 * Validates `POST /resident/visit-plans` payloads when a resident logs an intended clinic visit date.
 * Accepts `serviceId`/`service_id` and `plannedDate`/`planned_date`/`date` aliases,
 * normalizing into `{ serviceId, plannedDate, note }`.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const createPlanValidator = (input = {}) => {
  const errors = {};
  const serviceId = text(input.serviceId || input.service_id);
  const plannedDate = text(input.plannedDate || input.planned_date || input.date);
  const note = text(input.note);

  if (!isUuid(serviceId)) errors.serviceId = 'Select a valid health service.';
  if (!isDateOnly(plannedDate)) errors.plannedDate = 'Select a valid visit date.';
  if (note.length > NOTE_MAX) errors.note = `Note must be ${NOTE_MAX} characters or fewer.`;
  if (Object.keys(errors).length) return invalid(errors);

  return valid({ serviceId, plannedDate, note });
};

/**
 * Validates `GET /resident/health-services/:id/availability` optional date-window query parameters
 * (`from` and `to` as strict `YYYY-MM-DD` strings, normalized to `null` when omitted).
 *
 * @param {Object} [input] - Raw query parameters.
 * @returns {Object} Validation result `{ value: { from, to } }` or `{ error }`.
 */
export const availabilityQueryValidator = (input = {}) => {
  const from = text(input.from);
  const to = text(input.to);
  const errors = {};
  if (from && !isDateOnly(from)) errors.from = 'Enter a valid start date.';
  if (to && !isDateOnly(to)) errors.to = 'Enter a valid end date.';
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ from: from || null, to: to || null });
};

/**
 * Validates `GET /resident/visit-plans` query filters, normalizing optional `service_id`/`serviceId`
 * into `{ serviceId }`.
 *
 * @param {Object} [input] - Raw query parameters.
 * @returns {Object} Validation result `{ value: { serviceId } }` or `{ error }`.
 */
export const listQueryValidator = (input = {}) => {
  const serviceId = text(input.service_id || input.serviceId);
  if (serviceId && !isUuid(serviceId)) return invalid({ service_id: 'A valid service reference is required.' });
  return valid({ serviceId: serviceId || '' });
};

/**
 * Validates `:id` route parameters for visit-plan endpoints as UUIDs.
 *
 * @param {Object} [input] - Route params object.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const idParamValidator = (input = {}) => {
  if (!UUID.test(text(input.id))) return invalid({ id: 'Visit plan not found.' });
  return valid(input);
};

/**
 * Validates `:id` route parameters for resident health-service availability lookups as UUIDs.
 *
 * @param {Object} [input] - Route params object.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const serviceIdParamValidator = (input = {}) => {
  if (!UUID.test(text(input.id))) return invalid({ id: 'Health service not found.' });
  return valid(input);
};

export default {
  createPlanValidator,
  availabilityQueryValidator,
  listQueryValidator,
  idParamValidator,
  serviceIdParamValidator,
};
