// backend/src/validators/barangays.validators.js
import { isUuid, text, valid, invalid } from './common.js';

/**
 * @file Admin Barangay Management validators (server-authoritative).
 *
 * Runs inside `middleware/validate.js` in the KALUSAGAP pipeline
 * (`route -> authenticate -> authorize -> validate -> controller -> service -> Supabase`).
 * The barangay registry (`public.barangays`) is the single source of truth for
 * every barangay dropdown and scope check across the system. These validators
 * sanitize create/update/status payloads before the service layer enforces
 * administrator privileges, per-municipality name uniqueness, and non-destructive lifecycle rules.
 */

const LIMITS = { name: 120, short: 120, contact: 40 };

/** Trims a value to string and caps it at `max` characters. */
const clean = (value, max) => text(value).slice(0, max);

const STATUSES = ['Active', 'Inactive'];

/**
 * Normalizes a barangay status case-insensitively to `'Active'` or `'Inactive'`.
 * Defaults blank/omitted values to `'Active'`; returns `null` when unrecognized.
 */
const normalizeStatus = (value) => {
  const raw = text(value);
  if (!raw) return 'Active';
  const match = STATUSES.find((s) => s.toLowerCase() === raw.toLowerCase());
  return match || null;
};

/**
 * Parses an optional geographic coordinate within `[min, max]`.
 * Returns `null` when blank/nullish (allowing coordinates to be cleared),
 * `undefined` when non-numeric or out of bounds, or the finite `Number`.
 */
const parseCoordinate = (value, { min, max }) => {
  if (value === null || value === undefined || text(value) === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return undefined; // undefined => invalid
  return n;
};

/**
 * Shared field extractor for barangay creation (`partial: false`) and partial
 * edits (`partial: true`). Normalizes camelCase/snake_case keys (`municipalityId`,
 * `healthStationName`) and validates WGS84 latitude/longitude bounds.
 *
 * @param {Object} input - Raw request body.
 * @param {Object} options - `{ partial: boolean }` mode flag.
 * @returns {Object} `{ errors, out }` accumulator pair.
 */
const parseBody = (input, { partial }) => {
  const errors = {};
  const out = {};

  const has = (key) => Object.prototype.hasOwnProperty.call(input || {}, key);

  // name
  if (!partial || has('name')) {
    const name = clean(input?.name, LIMITS.name);
    if (!name) errors.name = 'Barangay name is required.';
    else out.name = name;
  }

  // municipality_id (accepts municipalityId or municipality_id)
  if (!partial || has('municipalityId') || has('municipality_id')) {
    const municipalityId = text(input?.municipalityId ?? input?.municipality_id);
    if (!municipalityId) {
      if (!partial) errors.municipalityId = 'A municipality is required.';
    } else if (!isUuid(municipalityId)) {
      errors.municipalityId = 'The selected municipality is not valid.';
    } else {
      out.municipalityId = municipalityId;
    }
  }

  // status
  if (!partial || has('status')) {
    const status = normalizeStatus(input?.status);
    if (status === null) errors.status = 'Status must be either Active or Inactive.';
    else out.status = status;
  }

  // optional descriptive fields
  if (!partial || has('captain')) out.captain = clean(input?.captain, LIMITS.short);
  if (!partial || has('contact')) out.contact = clean(input?.contact, LIMITS.contact);
  if (!partial || has('healthStationName') || has('health_station_name')) {
    out.healthStationName = clean(input?.healthStationName ?? input?.health_station_name, LIMITS.name);
  }

  // optional coordinates
  if (has('latitude')) {
    const lat = parseCoordinate(input?.latitude, { min: -90, max: 90 });
    if (lat === undefined) errors.latitude = 'Latitude must be between -90 and 90.';
    else out.latitude = lat;
  }
  if (has('longitude')) {
    const lng = parseCoordinate(input?.longitude, { min: -180, max: 180 });
    if (lng === undefined) errors.longitude = 'Longitude must be between -180 and 180.';
    else out.longitude = lng;
  }

  return { errors, out };
};

/**
 * Validates `POST /barangays` payloads, requiring `name` and `municipalityId`
 * and defaulting `status` to `'Active'`.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const createBarangayValidator = (input = {}) => {
  const { errors, out } = parseBody(input, { partial: false });
  if (Object.keys(errors).length) return invalid(errors);
  return valid(out);
};

/**
 * Validates `PATCH`/`PUT /barangays/:id` partial update payloads.
 * Rejects empty update bodies (`errors._`) when no recognized barangay fields are supplied.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const updateBarangayValidator = (input = {}) => {
  const { errors, out } = parseBody(input, { partial: true });
  if (Object.keys(errors).length) return invalid(errors);
  if (Object.keys(out).length === 0) return invalid({ _: 'No changes were provided.' });
  return valid(out);
};

/**
 * Validates status-only updates (`PATCH /barangays/:id/status`).
 * Barangays are activated/deactivated rather than hard-deleted so historical
 * resident, household, and health-service foreign keys remain intact.
 *
 * @param {Object} [input] - Raw request body containing `status`.
 * @returns {Object} Validation result `{ value: { status } }` or `{ error }`.
 */
export const updateBarangayStatusValidator = (input = {}) => {
  const status = normalizeStatus(input?.status);
  if (!status) return invalid({ status: 'Status must be either Active or Inactive.' });
  return valid({ status });
};

/**
 * Validates `:id` route parameters on barangay endpoints as UUIDs while preserving sibling params.
 *
 * @param {Object} [params] - Route params object.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const barangayIdParamValidator = (params = {}) => {
  const id = text(params.id);
  if (!id) return invalid({ id: 'A barangay reference is required.' });
  if (!isUuid(id)) return invalid({ id: 'The barangay reference is not valid.' });
  return valid({ ...params, id });
};

export default {
  createBarangayValidator,
  updateBarangayValidator,
  updateBarangayStatusValidator,
  barangayIdParamValidator,
};
