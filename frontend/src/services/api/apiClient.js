import { supabase } from '@/lib/supabase';

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
 * NOTE: the backend domain endpoints currently return 501 until the verified
 * database schema is connected. During development the UI renders from
 * `@/services/mock/*`; swap a feature module's mock call for its apiClient call
 * once the corresponding endpoint is live.
 */
const BASE_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

async function getAccessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

async function request(path, { method = 'GET', body, headers = {}, ...rest } = {}) {
  const token = await getAccessToken();

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...rest,
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      (isJson && (payload?.error?.message || payload?.message)) ||
      `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  // Unwrap the standard success envelope when present.
  return isJson && payload && 'data' in payload ? payload.data : payload;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};

export default api;
