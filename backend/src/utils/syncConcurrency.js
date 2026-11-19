import ApiError from './apiError.js';

/**
 * @module utils/syncConcurrency
 * @description Shared optimistic-concurrency and offline-synchronization guards for
 * Stage 2A clinical endpoints (consultations, referrals, follow-ups, etc.).
 *
 * Architectural layer:
 *   `route -> authenticate -> authorize -> [idempotency] -> controller -> service -> repository/Supabase`
 *
 * Synchronization callers are identified by `Idempotency-Key`, `X-Kalusagap-Sync`,
 * or an explicit `isSync: true` service flag. Synchronization updates MUST
 * supply an explicit expected revision (`If-Match` or `expected_revision` /
 * `expectedRevision`); they never silently substitute the current server
 * revision. Ordinary online updates remain compatible when no precondition is
 * supplied, while still honoring `If-Match` / `expected_revision` whenever
 * provided.
 */

/** Custom HTTP header allowing offline sync clients to opt into strict sync semantics. */
export const SYNC_HEADER = 'x-kalusagap-sync';

/** Upper bound of PostgreSQL's signed 32-bit `integer` type used for `revision` columns. */
const MAX_PG_INT = 2147483647;

/**
 * Reads an HTTP request header case-insensitively across both Express `Request`
 * instances (`req.get`) and plain/mocked `{ headers }` objects.
 *
 * @param {Object|null|undefined} req - Express request or request-like object.
 * @param {string} name - Header name to look up.
 * @returns {string|Array<string>|undefined} Raw header value if present.
 */
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
 * Determines whether an incoming request originates from the offline synchronization
 * queue or explicitly opts into strict synchronization concurrency rules.
 *
 * Detection signals (any match returns `true`):
 *   1. `options.isSync === true` or `req.isSyncRequest === true`
 *   2. `req.idempotencyKey` (attached by idempotency middleware) or `Idempotency-Key` header
 *   3. `X-Kalusagap-Sync` header set to `'1'` or `'true'` (throws `400 Bad Request` on
 *      unrecognized non-empty values other than `'0'`/`'false'`)
 *
 * @param {Object|null|undefined} req - Express request object.
 * @param {Object} [options={}] - Optional service-level override flags.
 * @param {boolean} [options.isSync] - Explicit sync caller flag.
 * @returns {boolean} `true` when strict synchronization revision rules apply.
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
 * Strips an optional weak ETag prefix (`W/`) and surrounding double quotes (`"..."`)
 * from an HTTP `ETag` or `If-Match` token.
 *
 * @param {*} raw - Raw header or revision value.
 * @returns {string} Unwrapped token string.
 */
export const unwrapEtagToken = (raw) =>
  String(raw ?? '')
    .trim()
    .replace(/^W\//i, '')
    .replace(/^"(.*)"$/s, '$1')
    .trim();

/**
 * Parses and validates a positive 32-bit PostgreSQL integer revision (`1..2147483647`)
 * from a numeric value or ETag-formatted string. Throws `400 Bad Request` when invalid.
 *
 * @param {number|string} raw - Candidate revision number or ETag string.
 * @param {string} [label='revision'] - Human-readable field label for error messages.
 * @returns {number} Validated positive integer revision.
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
 * Extracts and cross-validates optimistic-concurrency preconditions from an HTTP
 * `If-Match` header and/or an explicit request-body revision field (`expected_revision`).
 *
 * @param {Object} [opts={}] - Precondition inputs and validation options.
 * @param {string|Array<string>|number|null|undefined} [opts.ifMatch] - Raw `If-Match` header value.
 * @param {string|number|null|undefined} [opts.bodyRevision] - Explicit body revision (`expected_revision` / `expectedRevision`).
 * @param {boolean} [opts.isSync=false] - Whether strict sync rules require a precondition (`REVISION_REQUIRED`).
 * @param {boolean} [opts.allowLegacyTimestamp=false] - Allow ISO-8601 `updated_at` tokens in `If-Match` (used by `followups`).
 * @param {string} [opts.entityLabel='clinical record'] - Domain entity name interpolated into error messages.
 * @returns {Object} `{ expectedRevision: number|null, expectedUpdatedAt: string|null }`.
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

  // 1. Parse `If-Match` header: reject multiple headers, empty values, or wildcard `*`.
  if (ifMatch !== undefined && ifMatch !== null) {
    if (Array.isArray(ifMatch)) {
      if (ifMatch.length !== 1) throw ApiError.badRequest('Multiple If-Match headers are not allowed.');
      ifMatch = ifMatch[0];
    }
    const rawStr = String(ifMatch).trim();
    const invalidMsg = allowLegacyTimestamp
      ? 'The follow-up revision is invalid.'
      : `Invalid ${entityLabel} revision precondition.`;
    if (!rawStr || rawStr === '*') {
      throw ApiError.badRequest(invalidMsg);
    }
    const token = unwrapEtagToken(rawStr);
    if (/^[1-9]\d*$/.test(token)) {
      headerRevision = parsePositiveIntegerRevision(token, `${entityLabel} revision`);
    } else if (allowLegacyTimestamp && /^\d{4}-\d{2}-\d{2}T/.test(token) && Number.isFinite(Date.parse(token))) {
      // Legacy follow-up concurrency checks may pass an ISO `updated_at` timestamp in `If-Match`.
      expectedUpdatedAt = token;
    } else {
      throw ApiError.badRequest(invalidMsg);
    }
  }

  // 2. Parse optional explicit revision supplied in the JSON request body.
  let explicitBodyRevision = null;
  if (bodyRevision !== undefined && bodyRevision !== null && bodyRevision !== '') {
    explicitBodyRevision = parsePositiveIntegerRevision(bodyRevision, `${entityLabel} expected_revision`);
  }

  // 3. Reject contradictory preconditions when both header and body values are provided.
  if (headerRevision !== null && explicitBodyRevision !== null && headerRevision !== explicitBodyRevision) {
    throw ApiError.badRequest(`Conflicting ${entityLabel} revision preconditions were supplied.`);
  }
  if (expectedUpdatedAt !== null && explicitBodyRevision !== null) {
    throw ApiError.badRequest(`Conflicting ${entityLabel} revision preconditions were supplied.`);
  }

  const expectedRevision = headerRevision ?? explicitBodyRevision;

  // 4. Offline sync mutations must always provide an explicit revision precondition.
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
