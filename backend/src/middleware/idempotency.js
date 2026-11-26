// backend/src/middleware/idempotency.js
import { createHash } from 'node:crypto';

import env from '../config/env.js';
import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * @module middleware/idempotency
 *
 * Idempotency and offline-synchronization deduplication middleware for KALUSAGAP.
 * Position in request pipeline:
 *   `route -> authenticate -> authorize -> idempotency -> validate -> controller -> service -> repository/Supabase`
 *
 * When a request carries an `Idempotency-Key`, the backend records the completed
 * success response for `(user_id, key)` in `public.sync_operations`. A later
 * request with the SAME key, user, and request fingerprint replays that response
 * instead of executing the handler again — so an interrupted offline upload from
 * field BHWs or RHU staff can be retried freely without ever creating duplicate
 * clinical, resident, or household records.
 *
 * Security & reliability guarantees:
 *   - Scoped per authenticated user (`user_id`); a key can never replay another
 *     user's response.
 *   - Bound to a SHA-256 `requestFingerprint` (method + path + canonical JSON body);
 *     reusing a key with different parameters fails with 409 Conflict.
 *   - Only 2xx responses are committed (before flushing the HTTP body); failed
 *     requests release their `'processing'` claim so retries re-execute cleanly.
 *   - Concurrent duplicates while the first request is in flight receive 425
 *     (Too Early) — a retryable signal, with automatic stale-lock reclamation
 *     after `STALE_PROCESSING_MS` (60 seconds).
 *   - Supports `durable: true` mode for critical clinical writes (failing closed
 *     with 400/401/503 when headers, auth, or the ledger are missing/unavailable)
 *     and optional-ledger pass-through when Supabase is unconfigured.
 */

const HEADER = 'idempotency-key';
const MAX_KEY_LENGTH = 200;
/** Maximum age (ms) of an in-flight `'processing'` claim before a retry may reclaim it. */
const STALE_PROCESSING_MS = 60_000;

/**
 * Strictly extracts and validates the single `Idempotency-Key` header from `req`.
 * Rejects duplicate headers, non-strings, control characters (`\r`, `\n`, `\0`),
 * blank strings, and keys exceeding `MAX_KEY_LENGTH` with 400 `ApiError`.
 *
 * @param {Object} req - Express request object.
 * @returns {string|null} Trimmed idempotency key, or `null` when header is absent.
 */
const readKey = (req) => {
  const headers = req?.headers || {};
  const hasLower = Object.prototype.hasOwnProperty.call(headers, HEADER);
  const hasMixed = Object.prototype.hasOwnProperty.call(headers, 'Idempotency-Key');
  const raw = hasLower ? headers[HEADER] : hasMixed ? headers['Idempotency-Key'] : req?.get?.('Idempotency-Key');
  if (raw === undefined || raw === null) return null;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    if (raw.length > 1) {
      throw ApiError.badRequest('Multiple Idempotency-Key headers are not allowed.');
    }
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) {
    throw ApiError.badRequest('Invalid Idempotency-Key header.');
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_KEY_LENGTH) {
    throw ApiError.badRequest('Invalid Idempotency-Key header.');
  }
  return trimmed;
};

/**
 * Pure header reader (exported for tests; returns `null` instead of throwing on invalid input).
 *
 * @param {Object} [headers={}] - Raw HTTP headers map.
 * @returns {string|null} Validated idempotency key or `null`.
 */
export const readIdempotencyKey = (headers = {}) => {
  try {
    return readKey({ headers });
  } catch {
    return null;
  }
};

/**
 * Serializes any JSON-compatible value deterministically with sorted object keys
 * so semantically identical payloads hash to the same fingerprint.
 *
 * @param {*} value - Value to serialize.
 * @returns {string} Canonical JSON string.
 */
export const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
};

/**
 * Computes a SHA-256 fingerprint of the HTTP method, URL path, and canonical body
 * that an idempotency key was first used for. A duplicate key presenting a
 * different fingerprint is rejected (409) to prevent replaying unrelated or
 * sensitive responses.
 *
 * @param {Object} [params={}] - Request attributes to hash.
 * @param {string} [params.method='GET'] - HTTP method.
 * @param {string} [params.path=''] - Request URL/path.
 * @param {*} [params.body=null] - Parsed request body.
 * @returns {string} Hex-encoded SHA-256 digest.
 */
export const requestFingerprint = ({ method = 'GET', path = '', body = null } = {}) =>
  createHash('sha256').update(`${method}\n${path}\n${stableStringify(body)}`).digest('hex');

/**
 * Marks the claimed row in `public.sync_operations` as `'completed'` alongside
 * the HTTP status code and JSON response body. When `claimId` is provided
 * (`durable` mode), fences the update to that exact row ID and verifies one row
 * was updated, throwing 503 if the ledger write cannot be confirmed.
 *
 * @param {Object} supabase - Supabase service-role client.
 * @param {string} userId - Authenticated caller UUID.
 * @param {string} key - Normalized idempotency key.
 * @param {number} status - HTTP 2xx status code.
 * @param {*} body - JSON payload to cache for future replays.
 * @param {string|null} [claimId=null] - Optional row ID fence for durable claims.
 * @returns {Promise<void>}
 */
const persistResponse = async (supabase, userId, key, status, body, claimId = null) => {
  let query = supabase
    .from('sync_operations')
    .update({
      status: 'completed',
      response_status: status,
      response_body: body,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('idempotency_key', key);
  if (claimId) query = query.eq('id', claimId).select('id');
  const result = await query;
  if (result.error || (claimId && result.data?.length !== 1)) {
    throw new ApiError(503, 'The operation outcome could not be recorded. Retry the original operation.');
  }
};

/**
 * Deletes an uncommitted `'processing'` claim from `public.sync_operations`
 * when a downstream handler returns a non-2xx response or outcome persistence
 * fails, allowing subsequent client retries to execute normally.
 *
 * @param {Object} supabase - Supabase service-role client.
 * @param {string} userId - Authenticated caller UUID.
 * @param {string} key - Normalized idempotency key.
 * @param {string|null} [claimId=null] - Optional row ID fence for durable claims.
 * @returns {Promise<void>}
 */
const releaseClaim = async (supabase, userId, key, claimId = null) => {
  let query = supabase
    .from('sync_operations')
    .delete()
    .eq('user_id', userId)
    .eq('idempotency_key', key);
  if (claimId) query = query.eq('id', claimId);
  const { error } = await query;
  if (error) throw new ApiError(503, 'The operation claim could not be released. Retry the original operation.');
};

/**
 * Factory creating an Express idempotency middleware backed by `public.sync_operations`.
 * Attaches `req.isSyncRequest` (when an idempotency key or `X-Kalusagap-Sync` header
 * is supplied) and `req.idempotencyKey` for downstream controller/service deduplication.
 *
 * @param {Object} [options={}] - Middleware configuration options.
 * @param {Function} [options.validateReplay] - Optional async hook `(req, responseBody)`
 *   invoked before replaying a cached `'completed'` response (e.g. scope/access re-check).
 * @param {boolean} [options.durable=false] - When `true`, enforces fail-closed guarantees
 *   (requires auth, requires `Idempotency-Key` on sync POSTs, fences claims by ID, and
 *   throws 503 if `sync_operations` is unreachable).
 * @param {Function} [options.getKey=readKey] - Custom key extractor `(req) => string|null`.
 * @param {Function} [options.getClient=getServiceClient] - Supabase client factory.
 * @param {Function} [options.isConfigured] - Predicate returning whether Supabase is configured.
 * @returns {Function} Express middleware `(req, res, next)`.
 */
export const createIdempotencyMiddleware = ({ validateReplay, durable = false, getKey = readKey,
  getClient = getServiceClient, isConfigured = () => env.isSupabaseConfigured } = {}) =>
  asyncHandler(async (req, res, next) => {
  // Always validate raw Idempotency-Key header syntax when supplied so malformed
  // keys fail closed (400) rather than bypassing idempotency protection.
  const headerKey = readKey(req);
  const resolved = getKey === readKey ? headerKey : getKey(req);
  const key = resolved == null ? null : String(resolved).trim();
  if (key !== null && (!key || key.length > MAX_KEY_LENGTH || /[\r\n\0]/.test(key))) {
    throw ApiError.badRequest('Invalid Idempotency-Key.');
  }
  const rawSyncHeader = req?.headers?.['x-kalusagap-sync'] ?? req?.get?.('X-Kalusagap-Sync');
  const explicitSync = ['1', 'true'].includes(String(Array.isArray(rawSyncHeader) ? rawSyncHeader[0] : (rawSyncHeader ?? '')).trim().toLowerCase());
  if (key || explicitSync) req.isSyncRequest = true;

  // Make the normalized key available to the controller so the domain write can
  // carry it into the created row (database-enforced deduplication).
  if (key) req.idempotencyKey = key;
  const userId = req.user?.id;
  if (!key) {
    if (durable && explicitSync && req.method === 'POST') {
      throw ApiError.badRequest('Synchronization requests require an Idempotency-Key header.').withCode('IDEMPOTENCY_KEY_REQUIRED');
    }
    return next();
  }
  if (!userId) {
    if (durable) throw ApiError.unauthorized('Authentication is required for idempotent synchronization.');
    return next();
  }
  if (!isConfigured()) {
    if (durable) {
      throw new ApiError(503, 'The operation ledger is unavailable. Retry the original operation.');
    }
    return next();
  }

  const fingerprint = requestFingerprint({
    method: req.method,
    path: req.originalUrl || req.url || '',
    body: req.body ?? null,
  });

  const supabase = getClient();
  const replay = (row) => {
    if (row?.status === 'completed') {
      res.status(row.response_status || 200).json(row.response_body ?? {});
      return true;
    }
    return false;
  };

  // A key is valid only for the request it was first used for.
  const matchesRequest = (row) => {
    if (row?.request_fingerprint) return row.request_fingerprint === fingerprint;
    // Rows created before the fingerprint column existed: fall back to method/path.
    return row?.method === req.method && row?.path === (req.originalUrl || req.url);
  };

  const existing = await supabase
    .from('sync_operations')
    .select('*')
    .eq('user_id', userId)
    .eq('idempotency_key', key)
    .maybeSingle();
  if (existing.error && durable) {
    throw new ApiError(503, 'The operation ledger is unavailable. Retry the original operation.');
  }

  if (existing.data) {
    if (!matchesRequest(existing.data)) {
      throw ApiError.conflict(
        'This Idempotency-Key was already used for a different request. Use a new key.',
      );
    }
    if (
      existing.data.status === 'completed' &&
      typeof validateReplay === 'function'
    ) {
      await validateReplay(req, existing.data.response_body);
    }
    if (replay(existing.data)) return undefined;
    const age = Date.now() - new Date(existing.data.updated_at || existing.data.created_at).getTime();
    if (age < STALE_PROCESSING_MS) {
      throw new ApiError(425, 'An identical request is still being processed. Retry shortly.');
    }
    // Stale claim from a crashed request — reclaim it.
    const released = await supabase.from('sync_operations').delete().eq('id', existing.data.id);
    if (released.error && durable) {
      throw new ApiError(503, 'The operation claim could not be recovered. Retry the original operation.');
    }
  }

  let claimQuery = supabase.from('sync_operations').insert({
    user_id: userId,
    idempotency_key: key,
    method: req.method,
    path: req.originalUrl || req.url,
    request_fingerprint: fingerprint,
    status: 'processing',
  });
  if (durable) claimQuery = claimQuery.select('id').single();
  const claim = await claimQuery;

  if (claim.error) {
    // Unique violation: another request claimed the key between our read and
    // insert. Re-read and either replay or ask the client to retry.
    if (claim.error.code === '23505') {
      const again = await supabase
        .from('sync_operations')
        .select('*')
        .eq('user_id', userId)
        .eq('idempotency_key', key)
        .maybeSingle();
      if (again.error && durable) {
        throw new ApiError(503, 'The operation ledger is unavailable. Retry the original operation.');
      }
      if (again.data) {
        if (!matchesRequest(again.data)) {
          throw ApiError.conflict(
            'This Idempotency-Key was already used for a different request. Use a new key.',
          );
        }
        if (
          again.data.status === 'completed' &&
          typeof validateReplay === 'function'
        ) {
          await validateReplay(req, again.data.response_body);
        }
        if (replay(again.data)) return undefined;
      }
      throw new ApiError(425, 'An identical request is still being processed. Retry shortly.');
    }
    if (durable) {
      throw new ApiError(503, 'The operation ledger is unavailable. Retry the original operation.');
    }
    // Older domain handlers still allow writes when their optional ledger is
    // unavailable. Durable consultation creates explicitly fail closed.
    return next();
  }
  const claimId = durable ? claim.data?.id : null;
  if (durable && !claimId) throw new ApiError(503, 'The operation claim could not be confirmed.');

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const status = res.statusCode || 200;
    let outcomeRecorded = false;
    return (async () => {
      if (status >= 200 && status < 300) {
        // Commit the outcome BEFORE sending success, not after a backoff-sized
        // race window. Fence durable writes to the exact claim we acquired.
        await persistResponse(supabase, userId, key, status, body, claimId);
        outcomeRecorded = true;
      } else {
        // A failed clinical request stays a failed response even when releasing
        // its ledger claim is temporarily unavailable.
        await releaseClaim(supabase, userId, key, claimId).catch(() => {});
      }
      res.json = originalJson;
      return originalJson(body);
    })().catch(async () => {
      res.json = originalJson;
      if (!outcomeRecorded) await releaseClaim(supabase, userId, key, claimId).catch(() => {});
      if (res.destroyed || res.headersSent) return res;
      // Some controllers do not return res.json's promise. Forward the failure
      // here so neither those handlers nor the error pipeline can send fake 2xx.
      next(new ApiError(503, 'The operation outcome could not be confirmed. Retry the original operation.'));
      return res;
    });
  };

  return next();
  });

/**
 * Default non-durable idempotency middleware instance used by standard mutation
 * routes that accept optional `Idempotency-Key` headers during offline sync.
 */
const idempotency = createIdempotencyMiddleware();

export default idempotency;
