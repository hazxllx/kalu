import { createHash } from 'node:crypto';

import env from '../config/env.js';
import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Idempotency middleware.
 *
 * When a request carries an `Idempotency-Key`, the backend records the completed
 * success response for `(user_id, key)` in `public.sync_operations`. A later
 * request with the SAME key and user replays that response instead of executing
 * the handler again — so an interrupted offline upload can be retried freely
 * without ever creating a duplicate record. This is the server half of the
 * offline synchronization guarantee.
 *
 * Properties:
 *   - scoped per authenticated user; a key can never replay another user's
 *     response;
 *   - only 2xx responses are recorded; a failed request releases the claim so a
 *     retry re-executes and returns the same authoritative error;
 *   - a concurrent duplicate while the first is still processing gets 425 (Too
 *     Early) — a RETRYABLE signal, not a data conflict;
 *   - when Supabase is not configured (local JSON driver) the middleware is a
 *     pass-through.
 */

const HEADER = 'idempotency-key';
const MAX_KEY_LENGTH = 200;
const STALE_PROCESSING_MS = 60_000;

const readKey = (req) => {
  const raw = req.headers[HEADER];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || typeof key !== 'string') return null;
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > MAX_KEY_LENGTH) return null;
  return trimmed;
};

/** Pure header reader (exported for tests). */
export const readIdempotencyKey = (headers = {}) => readKey({ headers });

/** Deterministic JSON with sorted object keys, so equivalent payloads hash equal. */
export const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
};

/**
 * Fingerprint of the request an idempotency key was first used for. A duplicate
 * key with a different fingerprint is a client error, not a replay: rejecting it
 * prevents returning an unrelated (possibly sensitive) response body.
 */
export const requestFingerprint = ({ method = 'GET', path = '', body = null } = {}) =>
  createHash('sha256').update(`${method}\n${path}\n${stableStringify(body)}`).digest('hex');

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

export const createIdempotencyMiddleware = ({ validateReplay, durable = false, getKey = readKey,
  getClient = getServiceClient, isConfigured = () => env.isSupabaseConfigured } = {}) =>
  asyncHandler(async (req, res, next) => {
  const key = getKey(req);
  // Make the normalized key available to the controller so the domain write can
  // carry it into the created row (database-enforced deduplication).
  if (key) req.idempotencyKey = key;
  const userId = req.user?.id;
  if (!key || !userId || !isConfigured()) return next();

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

const idempotency = createIdempotencyMiddleware();

export default idempotency;
