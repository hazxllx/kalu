import { SERVICE_CATEGORIES } from '../services/healthServices.service.js';
import { invalid, isUuid, text, valid } from './common.js';

/**
 * Health service request validation. Municipality/barangay scope is taken from
 * the authenticated session in the service (a Health Supervisor is forced to
 * their own barangay) and the barangay is DERIVED from the chosen facility, so
 * the client never submits a barangay. Only content + an optional facility
 * reference (an existing id OR a new free-typed name) + an optional
 * municipality-wide flag + personnel references are accepted here.
 */

const LIMITS = { name: 160, description: 2000, facilityName: 160 };
const ATTENDANCE_STATUSES = Object.freeze(['scheduled', 'attended', 'absent', 'cancelled', 'walk_in']);

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
    active: input?.active === false ? false : true,
  });
};

export const assignValidator = (input = {}) => {
  const personnelId = text(input?.personnelId || input?.personnel_id);
  if (!personnelId) return invalid({ personnelId: 'Select a personnel to assign.' });
  if (!isUuid(personnelId)) return invalid({ personnelId: 'The selected personnel is not valid.' });
  return valid({ personnelId });
};

export const serviceIdParamValidator = (params = {}) => {
  const id = text(params.id);
  if (!id) return invalid({ id: 'A service reference is required.' });
  if (!isUuid(id)) return invalid({ id: 'The service reference is not valid.' });
  return valid({ ...params, id });
};

export const createAttendanceValidator = (input = {}) => {
  const errors = {};
  const serviceId = text(input?.service_id);
  const residentId = text(input?.resident_id);
  const scheduledDate = text(input?.scheduled_date);
  const status = text(input?.status);
  const notes = text(input?.notes);

  if (!serviceId || !isUuid(serviceId)) errors.service_id = 'A valid service is required.';
  if (!residentId) errors.resident_id = 'A resident is required.';
  if (!isDateOnly(scheduledDate)) errors.scheduled_date = 'Enter a valid scheduled date.';
  if (!ATTENDANCE_STATUSES.includes(status)) errors.status = 'Select a valid attendance status.';
  if (notes.length > 2000) errors.notes = 'Notes must be 2000 characters or fewer.';
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ service_id: serviceId, resident_id: residentId, scheduled_date: scheduledDate, status, notes });
};

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
  if (Object.keys(value).length === 0) errors._root = 'Provide at least one attendance field to update.';
  if (Object.keys(errors).length) return invalid(errors);
  return valid(value);
};

export const attendanceIdParamValidator = (params = {}) => {
  const id = text(params.id);
  if (!id || !isUuid(id)) return invalid({ id: 'The attendance reference is not valid.' });
  return valid({ ...params, id });
};

export default {
  createServiceValidator,
  assignValidator,
  serviceIdParamValidator,
  createAttendanceValidator,
  attendanceListQueryValidator,
  updateAttendanceValidator,
  attendanceIdParamValidator,
};
