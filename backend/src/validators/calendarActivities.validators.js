// backend/src/validators/calendarActivities.validators.js
import { invalid, isUuid, parseDateOnly, text, valid } from './common.js';

const ACTIVITY_TYPES = Object.freeze([
  'Reminder', 'Follow-up', 'Meeting', 'Field Visit', 'Health Activity', 'Other',
]);
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ACTIVITY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dateOnly = (value) => parseDateOnly(text(value)) !== null;

const normalizePayload = (input = {}, { partial = false } = {}) => {
  const errors = {};
  const value = {};
  const has = (key, alias) => Object.hasOwn(input, key) || (alias && Object.hasOwn(input, alias));
  const read = (key, alias) => input[key] ?? (alias ? input[alias] : undefined);

  if (!partial || has('title')) {
    value.title = text(read('title'));
    if (!value.title) errors.title = 'Enter an activity title.';
    else if (value.title.length > 120) errors.title = 'Activity title must be 120 characters or fewer.';
  }
  if (!partial || has('activityType', 'activity_type')) {
    value.activity_type = text(read('activityType', 'activity_type'));
    if (!ACTIVITY_TYPES.includes(value.activity_type)) errors.activityType = 'Select a valid activity type.';
  }
  if (!partial || has('date', 'activity_date')) {
    value.activity_date = text(read('date', 'activity_date'));
    if (!dateOnly(value.activity_date)) errors.date = 'Enter a valid activity date.';
  }
  if (has('time', 'activity_time') || !partial) {
    const time = text(read('time', 'activity_time'));
    if (time && !TIME_PATTERN.test(time)) errors.time = 'Enter a valid activity time.';
    value.activity_time = time || null;
  }
  if (has('notes')) {
    const notes = String(read('notes') ?? '');
    if (notes.length > 2000) errors.notes = 'Notes must be 2,000 characters or fewer.';
    value.notes = notes.trim() || null;
  } else if (!partial) {
    value.notes = null;
  }
  if (has('residentId', 'resident_id') || !partial) {
    const residentId = text(read('residentId', 'resident_id'));
    if (residentId.length > 80) errors.residentId = 'Select a valid resident.';
    value.resident_id = residentId || null;
  }

  return Object.keys(errors).length ? invalid(errors) : valid(value);
};

export const createActivityValidator = (input) => normalizePayload(input);
export const updateActivityValidator = (input) => {
  const result = normalizePayload(input, { partial: true });
  if (result.value && Object.keys(result.value).length === 0) {
    return invalid({ activity: 'Provide at least one activity field to update.' });
  }
  return result;
};

export const listActivitiesValidator = (input = {}) => {
  const from = text(input.from);
  const to = text(input.to);
  const errors = {};
  if (from && !dateOnly(from)) errors.from = 'Enter a valid start date.';
  if (to && !dateOnly(to)) errors.to = 'Enter a valid end date.';
  if (from && to && dateOnly(from) && dateOnly(to) && from > to) {
    errors.to = 'End date must be on or after the start date.';
  }
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ from: from || null, to: to || null });
};

export const activityIdValidator = (input = {}) => (
  ACTIVITY_ID_PATTERN.test(text(input.id))
    ? valid(input)
    : invalid({ id: 'Activity not found.' })
);

export { ACTIVITY_TYPES };
export default {
  createActivityValidator, updateActivityValidator, listActivitiesValidator, activityIdValidator,
};
