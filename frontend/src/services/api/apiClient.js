import { supabase } from '../../lib/supabase.js';
import { resolveApiBaseUrl } from './apiBaseUrl.js';
import {
  MUTATION_TIER,
  OfflineActionRequiredError,
  requireOnlineForMutation,
} from '../offline/mutationPolicy.js';
import { invalidateVerifiedPermissions } from '../accessControl/permissionCache.js';
import { captureOwnerGuard, assertCurrentOwner, getOfflineOwnerId } from '../offline/db.js';

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
const BASE_URL = resolveApiBaseUrl(import.meta.env?.VITE_API_URL, import.meta.env?.PROD);

/**
 * @typedef {Object} RequestOptions
 * @property {string} [method]
 * @property {any} [body]
 * @property {any} [headers]
 * @property {Record<string, any>} [params]
 * @property {RequestCredentials} [credentials]
 * @property {AbortSignal} [signal]
 * @property {'SAFE_SYNC'|'OFFLINE_DRAFT'|'ONLINE_ONLY'} [offlineMutationType]
 * @property {string} [ownerId] Authenticated account whose queued operation this request belongs to.
 */

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

async function getAuthIdentity() {
  if (!supabase) return { token: null, userId: null, expiresAt: null };
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return {
    token: data?.session?.access_token || null,
    userId: data?.session?.user?.id || null,
    expiresAt: data?.session?.expires_at || null,
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
 * @param {string} path
 * @param {RequestOptions} options
 */
async function request(
  path,
  { method = 'GET', body, headers = {}, params, offlineMutationType, ownerId = null, ...rest } = {},
) {
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase());
  const mutationType = offlineMutationType || MUTATION_TIER.ONLINE_ONLY;
  if (isMutation) requireOnlineForMutation(mutationType);

  const expectedOwnerId = ownerId === null ? getOfflineOwnerId() : ownerId;
  const ownerGuard = expectedOwnerId !== null ? captureOwnerGuard(expectedOwnerId) : null;
  if (ownerGuard) assertCurrentOwner(ownerGuard);
  const { token, userId, expiresAt } = await getAuthIdentity();
  if (ownerGuard) {
    assertCurrentOwner(ownerGuard);
    if (!token || userId !== expectedOwnerId || (expiresAt && expiresAt * 1000 <= Date.now())) {
      throw new ApiError('Your session changed or expired. Sign in to the original account before synchronizing.', 401, null);
    }
  }

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const isJsonBody = body !== undefined && body !== null && !isFormData && typeof body !== 'string' && !(body instanceof URLSearchParams);
  const requestBody = isJsonBody ? JSON.stringify(body) : body;

  let response;
  try {
    if (ownerGuard) assertCurrentOwner(ownerGuard);
    response = await fetch(buildUrl(path, params), {
      method,
      credentials: 'include',
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(requestBody !== undefined && requestBody !== null ? { body: requestBody } : {}),
      ...rest,
    });
  } catch (error) {
    if (error?.status === 401 || error?.code === 'auth') throw error;
    if (isMutation && mutationType === MUTATION_TIER.ONLINE_ONLY) {
      if (error?.name === 'AbortError') throw error;
      throw new OfflineActionRequiredError();
    }
    throw error;
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();
  // A late response must never populate the next account's UI/cache after a
  // sign-out or switch, even when the original request committed successfully.
  if (ownerGuard) assertCurrentOwner(ownerGuard);

  if (!response.ok) {
    if ((response.status === 401 || response.status === 403) && userId) {
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
