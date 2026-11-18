import ApiError from './apiError.js';

/**
 * Shared optimistic-concurrency and synchronization-caller guards for Stage 2A
 * clinical endpoints.
 *
 * Synchronization callers are identified by `Idempotency-Key`, `X-Kalusagap-Sync`,
 * or an explicit `isSync: true` service flag. Synchronization updates MUST
 * supply an explicit expected revision (`If-Match` or `expected_revision` /
 * `expectedRevision`); they never silently substitute the current server
 * revision. Ordinary online updates remain compatible when no precondition is
 * supplied, while still honoring `If-Match` / `expected_revision` whenever
 * provided.
 */

export const SYNC_HEADER = 'x-kalusagap-sync';
const MAX_PG_INT = 2147483647;

const readHeader = (req, name) => {
  if (!req) return undefined;
  if (typeof req.get === 'function') {
    const val = req.get(name);
    if (val !== undefined) return val;
  }
  const headers = req.headers || {};
  const lower = name.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(headers, lower)) return headers[lower];
  if (Object.prototype.hasOwnProperty.call(headers, name)) return headers[name];
  return undefined;
};

/**
 * True when an HTTP request originates from the offline synchronization engine
 * or explicitly opts into synchronization semantics.
 */
export const isSyncRequest = (req, options = {}) => {
  if (options.isSync === true || req?.isSyncRequest === true) return true;
  if (req?.idempotencyKey) return true;
  const rawIdem = readHeader(req, 'Idempotency-Key');
  if (rawIdem !== undefined && rawIdem !== null) return true;
  const rawSync = readHeader(req, 'X-Kalusagap-Sync');
  if (rawSync !== undefined && rawSync !== null) {
    const normalized = String(Array.isArray(rawSync) ? rawSync[0] : rawSync).trim().toLowerCase();
    if (normalized === '1' || normalized === 'true') return true;
    if (normalized && normalized !== '0' && normalized !== 'false') {
      throw ApiError.badRequest('Invalid X-Kalusagap-Sync header.');
    }
  }
  return false;
};

/**
 * Strip optional weak ETag prefix (`W/`) and surrounding quotes (`"..."`).
 */
export const unwrapEtagToken = (raw) =>
  String(raw ?? '')
    .trim()
    .replace(/^W\//i, '')
    .replace(/^"(.*)"$/s, '$1')
    .trim();

/**
 * Parse a positive 32-bit integer revision from an ETag or numeric value.
 */
export const parsePositiveIntegerRevision = (raw, label = 'revision') => {
  if (typeof raw === 'number') {
    if (Number.isSafeInteger(raw) && raw >= 1 && raw <= MAX_PG_INT) return raw;
    throw ApiError.badRequest(`Invalid ${label}; expected a positive integer.`);
  }
  if (typeof raw !== 'string') {
    throw ApiError.badRequest(`Invalid ${label}; expected a positive integer.`);
  }
  const token = unwrapEtagToken(raw);
  if (!/^[1-9]\d*$/.test(token)) {
    throw ApiError.badRequest(`Invalid ${label}; expected a positive integer.`);
  }
  const parsed = Number(token);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PG_INT) {
    throw ApiError.badRequest(`Invalid ${label}; expected a positive integer.`);
  }
  return parsed;
};

/**
 * Extract and validate optimistic-concurrency preconditions from `If-Match`
 * and/or an explicit body revision field.
 *
 * @param {object} opts
 * @param {string|number|null|undefined} [opts.ifMatch]
 * @param {string|number|null|undefined} [opts.bodyRevision]
 * @param {boolean} [opts.isSync]
 * @param {boolean} [opts.allowLegacyTimestamp] - Support ISO timestamps (`followups`).
 * @param {string}  [opts.entityLabel]
 * @returns {{ expectedRevision: number|null, expectedUpdatedAt: string|null }}
 */
export const extractExpectedRevision = ({
  ifMatch = undefined,
  bodyRevision = undefined,
  isSync = false,
  allowLegacyTimestamp = false,
  entityLabel = 'clinical record',
} = {}) => {
  let headerRevision = null;
  let expectedUpdatedAt = null;

  if (ifMatch !== undefined && ifMatch !== null) {
    if (Array.isArray(ifMatch)) {
      if (ifMatch.length !== 1) throw ApiError.badRequest('Multiple If-Match headers are not allowed.');
      ifMatch = ifMatch[0];
    }
    const rawStr = String(ifMatch).trim();
    if (!rawStr || rawStr === '*') {
      throw ApiError.badRequest(`Invalid ${entityLabel} If-Match precondition.`);
    }
    const token = unwrapEtagToken(rawStr);
    if (/^[1-9]\d*$/.test(token)) {
      headerRevision = parsePositiveIntegerRevision(token, `${entityLabel} revision`);
    } else if (allowLegacyTimestamp && /^\d{4}-\d{2}-\d{2}T/.test(token) && Number.isFinite(Date.parse(token))) {
      expectedUpdatedAt = token;
    } else {
      throw ApiError.badRequest(`Invalid ${entityLabel} revision precondition.`);
    }
  }

  let explicitBodyRevision = null;
  if (bodyRevision !== undefined && bodyRevision !== null && bodyRevision !== '') {
    explicitBodyRevision = parsePositiveIntegerRevision(bodyRevision, `${entityLabel} expected_revision`);
  }

  if (headerRevision !== null && explicitBodyRevision !== null && headerRevision !== explicitBodyRevision) {
    throw ApiError.badRequest(`Conflicting ${entityLabel} revision preconditions were supplied.`);
  }
  if (expectedUpdatedAt !== null && explicitBodyRevision !== null) {
    throw ApiError.badRequest(`Conflicting ${entityLabel} revision preconditions were supplied.`);
  }

  const expectedRevision = headerRevision ?? explicitBodyRevision;

  if (isSync && expectedRevision === null && expectedUpdatedAt === null) {
    throw ApiError.badRequest(
      `Synchronization update for ${entityLabel} requires an explicit If-Match or expected_revision precondition.`,
    ).withCode('REVISION_REQUIRED');
  }

  return { expectedRevision, expectedUpdatedAt };
};

export default {
  SYNC_HEADER,
  isSyncRequest,
  unwrapEtagToken,
  parsePositiveIntegerRevision,
  extractExpectedRevision,
};
