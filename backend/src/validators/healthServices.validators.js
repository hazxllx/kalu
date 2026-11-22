import { SERVICE_CATEGORIES } from '../services/healthServices.service.js';
import { invalid, isUuid, text, valid } from './common.js';

/**
 * @file Health service program & resident attendance validators (server-authoritative).
 *
 * Executed by `middleware/validate.js` in the KALUSAGAP pipeline
 * (`route -> authenticate -> authorize -> validate -> controller -> service -> Supabase`)
 * for community/RHU health service management, personnel assignment, and resident
 * attendance + immunization encounter documentation.
 *
 * Municipality and barangay scope are resolved from the authenticated session in
 * `healthServices.service.js` (e.g. a Health Supervisor is bound to their own barangay)
 * and the barangay is derived server-side from the chosen facility, so the client never
 * submits a barangay directly. Only service content, mutually exclusive facility coverage
 * (`facilityId`, free-typed `facilityName`, or `municipalityWide`), schedule bounds,
 * personnel UUIDs, and clinical attendance/immunization fields are accepted here.
 */

const LIMITS = { name: 160, description: 2000, facilityName: 160 };
/** Allowed attendance lifecycle statuses for scheduled clinic visits and walk-in encounters. */
const ATTENDANCE_STATUSES = Object.freeze(['scheduled', 'attended', 'absent', 'cancelled', 'walk_in']);

/** Strict calendar `YYYY-MM-DD` check that rejects out-of-range rollover dates. */
const isDateOnly = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

// Local time-of-day "HH:MM" (24h) and local "YYYY-MM-DDTHH:MM" (datetime-local)
// — the exact shapes the modal's <input type="time"> / "datetime-local" emit.
const isTimeOfDay = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const isLocalDateTime = (value) => {
  const [datePart, timePart] = String(value).split('T');
  return Boolean(timePart) && isDateOnly(datePart) && isTimeOfDay(timePart);
};
// Comparable, lexicographically-ordered "YYYY-MM-DDTHH:MM" key.
const atKey = (date, time) => `${date}T${time}`;

const isDateTime = (value) => value === null || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value)));

/**
 * Validates `POST /health-services` payloads when creating a community or RHU health service.
 * Enforces mutually exclusive facility selection (`facilityId` vs `facilityName` vs `municipalityWide`),
 * defaults omitted `endDate` to `startDate` for single-day events, and checks chronological ordering
 * (`registrationDeadline <= start <= end`).
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const createServiceValidator = (input = {}) => {
  const errors = {};
  const name = text(input?.name);
  if (!name) errors.name = 'A service name is required.';
  if (name.length > LIMITS.name) errors.name = 'The service name is too long.';

  const category = text(input?.category);
  if (category && !SERVICE_CATEGORIES.includes(category)) errors.category = 'Select a valid service category.';

  // Facility coverage: either an existing facility id, OR a new free-typed
  // facility name, OR the explicit municipality-wide flag — never a barangay
  // (the barangay is derived server-side from the facility + the session).
  const facilityId = text(input?.facilityId || input?.facility_id);
  const facilityName = text(input?.facilityName || input?.facility_name);
  const municipalityWide = input?.municipalityWide === true || input?.municipalityWide === 'true';

  if (facilityId && !isUuid(facilityId)) errors.facilityId = 'The selected facility is not valid.';
  if (facilityName && facilityName.length > LIMITS.facilityName) errors.facilityName = 'The facility name is too long.';
  if (facilityId && facilityName) errors.facilityName = 'Choose an existing facility or enter a new name, not both.';
  if (municipalityWide && (facilityId || facilityName)) errors.municipalityWide = 'A municipality-wide service cannot also select a facility.';

  const personnelIdsRaw = Array.isArray(input?.personnelIds) ? input.personnelIds : [];
  const personnelIds = personnelIdsRaw.map((p) => text(p)).filter(Boolean);
  if (personnelIds.some((p) => !isUuid(p))) errors.personnelIds = 'One or more selected personnel are not valid.';

  // Schedule: start date + start time + end time are required; end date is
  // optional (defaults to the start date); registration deadline is optional.
  const startDate = text(input?.startDate || input?.start_date);
  const startTime = text(input?.startTime || input?.start_time);
  const endDateRaw = text(input?.endDate || input?.end_date);
  const endTime = text(input?.endTime || input?.end_time);
  const registrationDeadline = text(input?.registrationDeadline || input?.registration_deadline);
  const registrationCapacityRaw = input?.registrationCapacity ?? input?.registration_capacity;
  const registrationCapacityText = text(registrationCapacityRaw);
  let registrationCapacity = null;
  if (registrationCapacityText !== '') {
    const parsedCapacity = Number(registrationCapacityText);
    if (!Number.isSafeInteger(parsedCapacity) || parsedCapacity < 1 || parsedCapacity > 1000000) {
      errors.registrationCapacity = 'Enter a whole number from 1 to 1,000,000.';
    } else {
      registrationCapacity = parsedCapacity;
    }
  }

  if (!startDate) errors.startDate = 'A start date is required.';
  else if (!isDateOnly(startDate)) errors.startDate = 'Enter a valid start date.';
  if (!startTime) errors.startTime = 'A start time is required.';
  else if (!isTimeOfDay(startTime)) errors.startTime = 'Enter a valid start time.';
  if (!endTime) errors.endTime = 'An end time is required.';
  else if (!isTimeOfDay(endTime)) errors.endTime = 'Enter a valid end time.';
  if (endDateRaw && !isDateOnly(endDateRaw)) errors.endDate = 'Enter a valid end date.';
  if (registrationDeadline && !isLocalDateTime(registrationDeadline)) {
    errors.registrationDeadline = 'Enter a valid registration deadline.';
  }

  // A one-day service ends on its start date when no end date is supplied.
  const endDate = endDateRaw || startDate;

  // Cross-field rules (only when the referenced fields are individually valid).
  if (!errors.startDate && !errors.startTime && !errors.endTime && !errors.endDate) {
    if (atKey(endDate, endTime) < atKey(startDate, startTime)) {
      errors.endTime = 'The end date and time cannot be earlier than the start.';
    }
  }
  if (!errors.registrationDeadline && registrationDeadline && !errors.startDate && !errors.startTime) {
    if (registrationDeadline > atKey(startDate, startTime)) {
      errors.registrationDeadline = 'The registration deadline cannot be after the service start.';
    }
  }

  if (Object.keys(errors).length) return invalid(errors);
  return valid({
    name,
    category: category || 'Other',
    description: text(input?.description).slice(0, LIMITS.description),
    facilityId: facilityId || null,
    facilityName: facilityName || null,
    municipalityWide,
    personnelIds,
    startDate,
    startTime,
    endDate,
    endTime,
    registrationDeadline: registrationDeadline || null,
    registrationCapacity,
    active: input?.active === false ? false : true,
  });
};

/**
 * Update validation. The edit form reuses the create form, so a FULL content
 * update is validated exactly like create (name + schedule required, facility
 * coverage rules, cross-field schedule rules) with an optional `active` flag.
 *
 * A STATUS-ONLY payload — `{ active }` with no content/schedule/coverage/
 * personnel fields — is accepted on its own so the activate/deactivate action
 * can flip the flag without resubmitting the whole schedule.
 */
const CONTENT_KEYS = [
  'name', 'category', 'description',
  'facilityId', 'facility_id', 'facilityName', 'facility_name', 'municipalityWide',
  'personnelIds',
  'startDate', 'start_date', 'startTime', 'start_time',
  'endDate', 'end_date', 'endTime', 'end_time',
  'registrationDeadline', 'registration_deadline', 'registrationCapacity', 'registration_capacity',
];

const hasActiveFlag = (input) =>
  input?.active === true || input?.active === false || input?.active === 'true' || input?.active === 'false';
const normalizeActive = (input) => !(input?.active === false || input?.active === 'false');

/**
 * Validates `PUT`/`PATCH /health-services/:id` payloads, supporting either a status-only
 * `{ active }` toggle or a full service definition update delegated to `createServiceValidator`.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const updateServiceValidator = (input = {}) => {
  const hasContent = CONTENT_KEYS.some((k) => {
    if (input == null || !Object.prototype.hasOwnProperty.call(input, k)) return false;
    const value = input[k];
    return Array.isArray(value) || text(value) !== '';
  });

  // Status-only update: just the active flag, nothing else to validate.
  if (!hasContent) {
    if (!hasActiveFlag(input)) return invalid({ _root: 'Provide at least one field to update.' });
    return valid({ active: normalizeActive(input) });
  }

  const result = createServiceValidator(input);
  if (result.error) return result;
  // Carry the active flag through when supplied (defaults to active for a full
  // update that omits it, mirroring create).
  result.value.active = hasActiveFlag(input) ? normalizeActive(input) : (input?.active === false ? false : true);
  return result;
};

/**
 * Validates personnel assignment payloads (`personnelId` / `personnel_id` UUID) for a health service.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { personnelId } }` or `{ error }`.
 */
export const assignValidator = (input = {}) => {
  const personnelId = text(input?.personnelId || input?.personnel_id);
  if (!personnelId) return invalid({ personnelId: 'Select a personnel to assign.' });
  if (!isUuid(personnelId)) return invalid({ personnelId: 'The selected personnel is not valid.' });
  return valid({ personnelId });
};

/**
 * Validates `:id` route parameters for health service endpoints as UUIDs.
 *
 * @param {Object} [params] - Route params object.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const serviceIdParamValidator = (params = {}) => {
  const id = text(params.id);
  if (!id) return invalid({ id: 'A service reference is required.' });
  if (!isUuid(id)) return invalid({ id: 'The service reference is not valid.' });
  return valid({ ...params, id });
};

/**
 * Validates creation of a resident service attendance record (and optional linked immunization entry).
 *
 * Domain rules enforced:
 * - `service_provided` is mandatory whenever `status === 'attended'`.
 * - `follow_up_date` is mandatory whenever `follow_up_required === true`.
 * - When `vaccine` is populated, validates dose/date fields and requires `administered_date`
 *   if `immunization_status` is `'Completed'` (defaulting omitted status to `'Completed'`).
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const createAttendanceValidator = (input = {}) => {
  const errors = {};
  const serviceId = text(input?.service_id);
  const residentId = text(input?.resident_id);
  const scheduledDate = text(input?.scheduled_date);
  const status = text(input?.status);
  const notes = text(input?.notes);
  const serviceProvided = text(input?.service_provided);
  const assessment = text(input?.assessment);
  const recommendations = text(input?.recommendations);
  const followUpRequired = input?.follow_up_required === true;
  const followUpDate = text(input?.follow_up_date);
  const vaccine = text(input?.vaccine);
  const dose = text(input?.dose);
  const administeredDate = input?.administered_date == null || input.administered_date === '' ? null : text(input.administered_date);
  const nextDose = input?.next_dose == null || input.next_dose === '' ? null : text(input.next_dose);
  const immunizationStatus = text(input?.immunization_status);

  if (!serviceId || !isUuid(serviceId)) errors.service_id = 'A valid service is required.';
  if (!residentId) errors.resident_id = 'A resident is required.';
  if (!isDateOnly(scheduledDate)) errors.scheduled_date = 'Enter a valid scheduled date.';
  if (!ATTENDANCE_STATUSES.includes(status)) errors.status = 'Select a valid attendance status.';
  if (notes.length > 2000) errors.notes = 'Notes must be 2000 characters or fewer.';
  if (serviceProvided.length > 5000) errors.service_provided = 'Service details must be 5000 characters or fewer.';
  if (assessment.length > 5000) errors.assessment = 'Assessment must be 5000 characters or fewer.';
  if (recommendations.length > 5000) errors.recommendations = 'Recommendations must be 5000 characters or fewer.';
  if (input?.follow_up_required !== undefined && typeof input.follow_up_required !== 'boolean') errors.follow_up_required = 'Follow-up must be yes or no.';
  if (followUpDate && !isDateOnly(followUpDate)) errors.follow_up_date = 'Enter a valid follow-up date.';
  if (status === 'attended' && !serviceProvided) errors.service_provided = 'Describe the service provided.';
  if (followUpRequired && !followUpDate) errors.follow_up_date = 'Enter the follow-up date.';
  if (vaccine.length > 200) errors.vaccine = 'Vaccine name must be 200 characters or fewer.';
  if (dose.length > 100) errors.dose = 'Dose must be 100 characters or fewer.';
  if (administeredDate && !isDateOnly(administeredDate)) errors.administered_date = 'Enter a valid administration date.';
  if (nextDose && !isDateOnly(nextDose)) errors.next_dose = 'Enter a valid next-dose date.';
  if (immunizationStatus && !['Due', 'Completed', 'Missed'].includes(immunizationStatus)) errors.immunization_status = 'Select a valid immunization status.';
  if (vaccine && immunizationStatus === 'Completed' && !administeredDate) errors.administered_date = 'Date administered is required for a completed immunization.';
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ service_id: serviceId, resident_id: residentId, scheduled_date: scheduledDate, status, notes, service_provided: serviceProvided, assessment, recommendations, follow_up_required: followUpRequired, follow_up_date: followUpDate || null, ...(vaccine ? { vaccine, dose, administered_date: administeredDate, next_dose: nextDose, immunization_status: immunizationStatus || 'Completed' } : {}) });
};

/**
 * Validates query filters for listing attendance records (`service_id`, `resident_id`, `from`, `to`).
 * Rejects supplying both `service_id` and `resident_id` simultaneously and ensures `from <= to`.
 *
 * @param {Object} [query] - Raw query parameters.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const attendanceListQueryValidator = (query = {}) => {
  const errors = {};
  const serviceId = text(query?.service_id);
  const residentId = text(query?.resident_id);
  const from = text(query?.from);
  const to = text(query?.to);
  // Either a service, a resident (own), or neither (staff-scope dashboard
  // listing). The existing service/resident branches are validated by the
  // service; date ranges are validated here for every branch.
  if (Boolean(serviceId) && Boolean(residentId)) errors._root = 'Provide either service_id or resident_id, not both.';
  if (serviceId && !isUuid(serviceId)) errors.service_id = 'The service reference is not valid.';
  if (residentId && !isUuid(residentId)) errors.resident_id = 'The resident reference is not valid.';
  if (from && !isDateOnly(from)) errors.from = 'Enter a valid start date.';
  if (to && !isDateOnly(to)) errors.to = 'Enter a valid end date.';
  if (from && to && from > to) errors.to = 'The end date must not be before the start date.';
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ service_id: serviceId, resident_id: residentId, from, to });
};

/**
 * Validates partial updates to an existing service attendance record (and optional immunization details).
 * Enforces non-empty patch payloads (`errors._root`) plus the same clinical completeness rules
 * as creation (`attended` requires `service_provided`, `follow_up_required` requires `follow_up_date`,
 * and `'Completed'` immunizations require `administered_date`).
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const updateAttendanceValidator = (input = {}) => {
  const errors = {};
  const value = {};
  if (input?.status !== undefined) {
    const status = text(input.status);
    if (!ATTENDANCE_STATUSES.includes(status)) errors.status = 'Select a valid attendance status.';
    else value.status = status;
  }
  if (input?.notes !== undefined) {
    if (typeof input.notes !== 'string' || input.notes.length > 2000) errors.notes = 'Notes must be a string of 2000 characters or fewer.';
    else value.notes = input.notes.trim();
  }
  if (input?.attended_at !== undefined) {
    if (!isDateTime(input.attended_at)) errors.attended_at = 'Enter a valid attendance timestamp.';
    else value.attended_at = input.attended_at;
  }
  for (const [field, max, label] of [
    ['service_provided', 5000, 'Service details'],
    ['assessment', 5000, 'Assessment'],
    ['recommendations', 5000, 'Recommendations'],
  ]) {
    if (input?.[field] !== undefined) {
      if (typeof input[field] !== 'string' || input[field].length > max) errors[field] = `${label} must be a string of ${max} characters or fewer.`;
      else value[field] = input[field].trim();
    }
  }
  if (input?.follow_up_required !== undefined) {
    if (typeof input.follow_up_required !== 'boolean') errors.follow_up_required = 'Follow-up must be yes or no.';
    else value.follow_up_required = input.follow_up_required;
  }
  if (input?.follow_up_date !== undefined) {
    const date = input.follow_up_date === null || input.follow_up_date === '' ? null : text(input.follow_up_date);
    if (date && !isDateOnly(date)) errors.follow_up_date = 'Enter a valid follow-up date.';
    else value.follow_up_date = date;
  }
  if (value.follow_up_required === true && !(value.follow_up_date || input.follow_up_date)) errors.follow_up_date = 'Enter the follow-up date.';
  if (value.status === 'attended' && !(value.service_provided || text(input.service_provided))) errors.service_provided = 'Describe the service provided.';
  if (input?.vaccine !== undefined) {
    const vaccine = text(input.vaccine);
    const dose = text(input.dose);
    const administeredDate = input.administered_date == null || input.administered_date === '' ? null : text(input.administered_date);
    const nextDose = input.next_dose == null || input.next_dose === '' ? null : text(input.next_dose);
    const immunizationStatus = text(input.immunization_status || 'Completed');
    if (!vaccine || vaccine.length > 200) errors.vaccine = 'Enter a vaccine name of 200 characters or fewer.';
    if (dose.length > 100) errors.dose = 'Dose must be 100 characters or fewer.';
    if (administeredDate && !isDateOnly(administeredDate)) errors.administered_date = 'Enter a valid administration date.';
    if (nextDose && !isDateOnly(nextDose)) errors.next_dose = 'Enter a valid next-dose date.';
    if (!['Due', 'Completed', 'Missed'].includes(immunizationStatus)) errors.immunization_status = 'Select a valid immunization status.';
    if (immunizationStatus === 'Completed' && !administeredDate) errors.administered_date = 'Date administered is required for a completed immunization.';
    Object.assign(value, { vaccine, dose, administered_date: administeredDate, next_dose: nextDose, immunization_status: immunizationStatus });
  }
  if (Object.keys(value).length === 0) errors._root = 'Provide at least one attendance field to update.';
  if (Object.keys(errors).length) return invalid(errors);
  return valid(value);
};

/**
 * Validates `:id` route parameters for attendance endpoints as UUIDs.
 *
 * @param {Object} [params] - Route params object.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const attendanceIdParamValidator = (params = {}) => {
  const id = text(params.id);
  if (!id || !isUuid(id)) return invalid({ id: 'The attendance reference is not valid.' });
  return valid({ ...params, id });
};

export default {
  createServiceValidator,
  updateServiceValidator,
  assignValidator,
  serviceIdParamValidator,
  createAttendanceValidator,
  attendanceListQueryValidator,
  updateAttendanceValidator,
  attendanceIdParamValidator,
};
