// frontend/src/services/api/apiClient.js
import { supabase } from '../../lib/supabase.js';
import { resolveApiBaseUrl } from './apiBaseUrl.js';
import { invalidateVerifiedPermissions } from '../accessControl/permissionCache.js';
import { captureOwnerGuard, assertCurrentOwner, getOfflineOwnerId } from '../offline/db.js';
import { performanceMonitor } from '../../utils/performanceMonitor.js';

/**
 * Centralized HTTP client for the KALUSAGAP backend (see `backend/`).
 *
 * This is the ONE place that talks to the API. Feature API modules
 * (`residentsApi`, `healthRecordsApi`, …) build on it, and UI components call
 * those feature modules — components never call `fetch` directly.
 *
 * Auth: when a Supabase session exists, its access token is attached as a
 * Bearer header so the backend `authenticate` middleware can verify the user
 * and derive their role. Responses are unwrapped from the `{ data }` envelope
 * used by the backend (`utils/apiResponse.js`).
 *
 * NOTE: the backend domain endpoints that are not connected yet return 501.
 * Pages render their loading skeleton while a request is in flight and an
 * empty state when the endpoint supplies no rows — no fabricated data is
 * rendered anywhere in the app.
 */
const BASE_URL = resolveApiBaseUrl(import.meta.env?.VITE_API_URL, import.meta.env?.MODE === 'production');

/**
 * @typedef {Object} RequestOptions
 * @property {string} [method]
 * @property {any} [body]
 * @property {any} [headers]
 * @property {Record<string, any>} [params]
 * @property {RequestCredentials} [credentials]
 * @property {AbortSignal} [signal]
 * @property {RequestCache} [cache]
 * @property {'blob'} [responseType]
 * @property {'SAFE_SYNC'|'OFFLINE_DRAFT'|'ONLINE_ONLY'} [offlineMutationType] Caller policy metadata; not used to infer connectivity.
 * @property {string} [ownerId] Authenticated account whose queued operation this request belongs to.
 * @property {string} [dedupeKey] Optional caller-supplied scope key for GET deduplication.
 * @property {number} [timeout] Request timeout in milliseconds (default: 30000)
 */

// Request deduplication map: maps request key to pending promise
const pendingRequests = new Map();

class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {any} payload
   */
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

class ApiTransportError extends TypeError {
  constructor(cause) {
    super(cause?.message || 'The API request could not reach the server.');
    this.name = 'TypeError';
    this.code = 'API_TRANSPORT_ERROR';
    this.cause = cause;
  }
}

let refreshSessionInFlight = null;

// Handles getAuthIdentity logic.
async function getAuthIdentity({ refreshIfNeeded = true, forceRefresh = false } = {}) {
  if (!supabase) return { token: null, userId: null, expiresAt: null };
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const session = data?.session;
  const expiresSoon = session?.expires_at && session.expires_at * 1000 <= Date.now() + 60_000;
  if (refreshIfNeeded && session?.refresh_token && (forceRefresh || expiresSoon)) {
    if (!refreshSessionInFlight) {
      refreshSessionInFlight = supabase.auth.refreshSession()
        .finally(() => { refreshSessionInFlight = null; });
    }
    const refreshed = await refreshSessionInFlight;
    if (refreshed.error) throw refreshed.error;
    return {
      token: refreshed.data?.session?.access_token || null,
      userId: refreshed.data?.session?.user?.id || null,
      expiresAt: refreshed.data?.session?.expires_at || null,
    };
  }
  return {
    token: session?.access_token || null,
    userId: session?.user?.id || null,
    expiresAt: session?.expires_at || null,
  };
}

/** Build the request URL, serializing `params` into the query string. */
function buildUrl(path, params) {
  if (!params) return `${BASE_URL}${path}`;
  const search = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ).toString();
  return search ? `${BASE_URL}${path}?${search}` : `${BASE_URL}${path}`;
}

/**
 * Generate a cache key for request deduplication.
 * Only GET requests without custom headers/bodies are deduplicated.
 */
function getRequestKey(path, method, params, body, dedupeKey) {
  if (method !== 'GET') return null;
  const url = buildUrl(path, params);
  return `${method}:${url}:${dedupeKey || ''}`;
}

/**
 * Create an AbortController with timeout.
 */
function createTimeoutController(timeoutMs, existingSignal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('Request timeout')), timeoutMs);
  
  if (existingSignal) {
    existingSignal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      controller.abort(existingSignal.reason);
    });
  }
  
  // Clean up timeout on completion
  controller.signal.addEventListener('abort', () => clearTimeout(timeoutId));
  controller.clearTimeout = () => clearTimeout(timeoutId);
  
  return controller;
}

/**
 * @param {string} path
 * @param {RequestOptions} options
 */
async function request(
  path,
  { method = 'GET', body, headers = {}, params, offlineMutationType, ownerId = null, timeout = 30000, signal, dedupeKey, responseType, ...rest } = {},
) {
  // `navigator.onLine` is only a hint; let the API request establish whether
  // this client can actually reach the server.
  void offlineMutationType;

  // Request deduplication for GET requests
  const requestKey = getRequestKey(path, method, params, body, dedupeKey);
  if (requestKey && pendingRequests.has(requestKey)) {
    return pendingRequests.get(requestKey);
  }

  const executeRequest = async () => {
    const expectedOwnerId = ownerId === null ? getOfflineOwnerId() : ownerId;
    const ownerGuard = expectedOwnerId !== null ? captureOwnerGuard(expectedOwnerId) : null;
    if (ownerGuard) assertCurrentOwner(ownerGuard);
    let { token, userId, expiresAt } = await getAuthIdentity();
    if (ownerGuard) {
      assertCurrentOwner(ownerGuard);
      if (!token || userId !== expectedOwnerId || (expiresAt && expiresAt * 1000 <= Date.now())) {
        throw new ApiError('Your session changed or expired. Sign in to the original account before synchronizing.', 401, null);
      }
    }

    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const isJsonBody = body !== undefined && body !== null && !isFormData && typeof body !== 'string' && !(body instanceof URLSearchParams);
    const requestBody = isJsonBody ? JSON.stringify(body) : body;

    // Setup timeout
    const timeoutController = timeout > 0 ? createTimeoutController(timeout, signal) : null;
    const effectiveSignal = timeoutController ? timeoutController.signal : signal;

    let response;
    const startTime = performance.now();
    if (ownerGuard) assertCurrentOwner(ownerGuard);
    try {
      response = await fetch(buildUrl(path, params), {
        method,
        credentials: 'include',
        headers: {
          ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        ...(requestBody !== undefined && requestBody !== null ? { body: requestBody } : {}),
        ...(effectiveSignal ? { signal: effectiveSignal } : {}),
        ...rest,
      });
    } catch (error) {
      if (timeoutController?.signal.aborted && !signal?.aborted) {
        const timeoutError = Object.assign(
          new Error('The server took too long to confirm this request.'),
          { name: 'TimeoutError', code: 'API_TIMEOUT' },
        );
        console.warn('[kalusagap/sync] request timeout', {
          event: 'api_request_timeout', endpoint: path, method,
          operationUuid: headers?.['Idempotency-Key'] || null,
        });
        throw timeoutError;
      }
      console.warn('[kalusagap/sync] transport failure', {
        event: 'api_transport_failure',
        endpoint: path,
        method,
        operationUuid: headers?.['Idempotency-Key'] || null,
        errorCode: error?.code || error?.name || 'NETWORK',
      });
      if (error?.name === 'AbortError') throw error;
      throw new ApiTransportError(error);
    }

    // A token can expire between getSession() and fetch(). Recover once using
    // the shared refresh single-flight so concurrent requests do not rotate
    // the same refresh token against each other. A genuine 401 is still
    // surfaced to the caller and invalidates permissions below.
    if (response.status === 401 && supabase) {
      const refreshed = await getAuthIdentity({ refreshIfNeeded: true, forceRefresh: true });
      if (refreshed.token && refreshed.token !== token) {
        token = refreshed.token;
        userId = refreshed.userId;
        expiresAt = refreshed.expiresAt;
        response = await fetch(buildUrl(path, params), {
          method,
          credentials: 'include',
          headers: {
            ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
            Authorization: `Bearer ${token}`,
            ...headers,
          },
          ...(requestBody !== undefined && requestBody !== null ? { body: requestBody } : {}),
          ...(effectiveSignal ? { signal: effectiveSignal } : {}),
          ...rest,
        });
      }
    }

    // Record API performance metric
    const duration = performance.now() - startTime;
    performanceMonitor.recordApiMetric(path, method, duration, response.status);

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = responseType === 'blob' && response.ok
    ? await response.blob()
    : isJson ? await response.json() : await response.text();
  timeoutController?.clearTimeout?.();
  // A late response must never populate the next account's UI/cache after a
  // sign-out or switch, even when the original request committed successfully.
  if (ownerGuard) assertCurrentOwner(ownerGuard);

  if (!response.ok) {
    console.warn('[kalusagap/sync] HTTP rejection', {
      event: 'api_http_rejection',
      endpoint: path,
      method,
      status: response.status,
      operationUuid: headers?.['Idempotency-Key'] || null,
      errorCode: isJson ? payload?.error?.code || payload?.code || null : null,
      message: isJson ? payload?.error?.message || payload?.message || null : null,
    });
    // A 403 from an ordinary feature endpoint means that particular action is
    // forbidden; it is not evidence that the user's verified role matrix is
    // invalid. Treating every feature-level 403 as a permission-session
    // failure cleared the entire UI for valid users (including Health
    // Supervisors) whenever a background request was outside their scope.
    // Only an unauthenticated response proves that the signed-in session must
    // be discarded. The PermissionsProvider handles a 403 from its own matrix
    // request directly and displays a retry affordance.
    if (response.status === 401 && userId) {
      void invalidateVerifiedPermissions(userId)
        .catch((error) => console.error('[kalusagap/permissions] Could not clear rejected permissions.', error))
        .finally(() => {
          if (typeof window !== 'undefined' && !path.endsWith('/roles/permissions')) {
            window.dispatchEvent(new CustomEvent('kalusagap:permissions-invalidated', {
              detail: { userId, status: response.status },
            }));
          }
        });
    }
    const message =
      (isJson && (payload?.error?.message || payload?.message)) ||
      `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return isJson && payload && 'data' in payload ? payload.data : payload;
  };

  // Store promise for deduplication
  if (requestKey) {
    const promise = executeRequest();
    pendingRequests.set(requestKey, promise);
    promise
      .finally(() => {
        pendingRequests.delete(requestKey);
      })
      .catch(() => {});
    return promise;
  }

  return executeRequest();
}

/** @param {RequestOptions} options */
export const postFormData = async (path, formData, options = {}) => {
  return request(path, { ...options, method: 'POST', body: formData });
};

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};

export default api;
