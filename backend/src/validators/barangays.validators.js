import { isUuid, text, valid, invalid } from './common.js';

/**
 * Admin Barangay Management validation (server-authoritative).
 *
 * The barangay registry (public.barangays) is the single source of truth for
 * every barangay dropdown in the application. These validators sanitize the
 * admin editor payload before the service writes it; the service still enforces
 * the admin role, uniqueness within a municipality, and safe-delete rules.
 */

const LIMITS = { name: 120, short: 120, contact: 40 };

const clean = (value, max) => text(value).slice(0, max);

const STATUSES = ['Active', 'Inactive'];

const normalizeStatus = (value) => {
  const raw = text(value);
  if (!raw) return 'Active';
  const match = STATUSES.find((s) => s.toLowerCase() === raw.toLowerCase());
  return match || null;
};

const parseCoordinate = (value, { min, max }) => {
  if (value === null || value === undefined || text(value) === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return undefined; // undefined => invalid
  return n;
};

/** Shared field parsing for create/update bodies. */
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

export const createBarangayValidator = (input = {}) => {
  const { errors, out } = parseBody(input, { partial: false });
  if (Object.keys(errors).length) return invalid(errors);
  return valid(out);
};

export const updateBarangayValidator = (input = {}) => {
  const { errors, out } = parseBody(input, { partial: true });
  if (Object.keys(errors).length) return invalid(errors);
  if (Object.keys(out).length === 0) return invalid({ _: 'No changes were provided.' });
  return valid(out);
};

export const barangayIdParamValidator = (params = {}) => {
  const id = text(params.id);
  if (!id) return invalid({ id: 'A barangay reference is required.' });
  if (!isUuid(id)) return invalid({ id: 'The barangay reference is not valid.' });
  return valid({ ...params, id });
};

export default {
  createBarangayValidator,
  updateBarangayValidator,
  barangayIdParamValidator,
};
