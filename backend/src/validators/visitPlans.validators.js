/**
 * Resident visit-plan validators (server-authoritative).
 *
 * Convention with middleware/validate.js:
 *   validator(input, req) -> { value }            // accepted, replaces req[part]
 *                         -> { error: { field } } // rejected with 400 + details
 *
 * These normalize shape and reject obviously invalid input. The service still
 * enforces authorization, ownership, barangay/RHU scope, the active-weekday
 * rule and closures — these validators are the first gate, not the only one.
 */
import { invalid, valid, text, isUuid, parseDateOnly } from './common.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_MAX = 140;
const isDateOnly = (value) => parseDateOnly(text(value)) !== null;

/** POST /resident/visit-plans — a resident records a visit intent. */
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

/** GET /resident/health-services/:id/availability?from=&to= */
export const availabilityQueryValidator = (input = {}) => {
  const from = text(input.from);
  const to = text(input.to);
  const errors = {};
  if (from && !isDateOnly(from)) errors.from = 'Enter a valid start date.';
  if (to && !isDateOnly(to)) errors.to = 'Enter a valid end date.';
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ from: from || null, to: to || null });
};

/** GET /resident/visit-plans?service_id= (optional filter). */
export const listQueryValidator = (input = {}) => {
  const serviceId = text(input.service_id || input.serviceId);
  if (serviceId && !isUuid(serviceId)) return invalid({ service_id: 'A valid service reference is required.' });
  return valid({ serviceId: serviceId || '' });
};

/** :id path param must be a UUID. */
export const idParamValidator = (input = {}) => {
  if (!UUID.test(text(input.id))) return invalid({ id: 'Visit plan not found.' });
  return valid(input);
};

/** :id path param for the service availability route. */
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
