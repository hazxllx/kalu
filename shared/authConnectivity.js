export const AUTH_SERVICE_UNAVAILABLE_CODE = 'AUTH_SERVICE_UNAVAILABLE';
export const AUTH_SERVICE_UNAVAILABLE_MESSAGE =
  'Cannot reach the Supabase authentication service. The project may be paused or unavailable. Contact the administrator or try again after the service is restored.';

/** A network/service outage is not evidence that an account or password is invalid. */
export const isAuthServiceUnavailable = (error) => {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError') return true;
  const status = Number(error.status ?? error.statusCode);
  if (status === 0 || status >= 500) return true;
  const code = error.cause?.code ?? error.code;
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) return true;
  return ['TypeError', 'NetworkError', 'AuthUnknownError'].includes(error.name)
    && /failed to fetch|fetch failed|network ?error|network request failed/i.test(String(error.message || ''));
};

export const authFailureMessage = (error) => {
  if (isAuthServiceUnavailable(error)) return AUTH_SERVICE_UNAVAILABLE_MESSAGE;
  if (Number(error?.status ?? error?.statusCode) === 429) return 'Too many sign-in attempts. Please wait and try again.';
  return 'Invalid email or password';
};

/** Validate browser/build configuration without returning or logging credential values. */
export const publicSupabaseConfigurationError = (url, publicKey) => {
  const value = String(url || '').trim();
  const key = String(publicKey || '').trim();
  if (!value || !key) return 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable authentication.';
  let parsed;
  try { parsed = new URL(value); } catch {
    return 'VITE_SUPABASE_URL must be a valid Supabase project URL.';
  }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    return 'VITE_SUPABASE_URL must be an HTTP(S) project URL without credentials, a query, or a fragment.';
  }
  if (/\/(auth|rest)\/v1\/?$/i.test(parsed.pathname)) return 'VITE_SUPABASE_URL must be the project base URL, not an Auth or REST endpoint.';
  if (key.startsWith('sb_secret_')) return 'VITE_SUPABASE_ANON_KEY must not contain a server secret or service-role key.';
  if (key.startsWith('sb_publishable_')) return null;
  let claims;
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    claims = JSON.parse(globalThis.atob(payload));
  } catch {
    return 'VITE_SUPABASE_ANON_KEY must be the public anon or publishable key from the existing Supabase project.';
  }
  if (claims.role !== 'anon') return 'VITE_SUPABASE_ANON_KEY must not contain a service-role key or a user access token.';
  if (claims.ref && parsed.hostname.endsWith('.supabase.co') && parsed.hostname !== `${claims.ref}.supabase.co`) {
    return 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must belong to the same existing project.';
  }
  return null;
};
