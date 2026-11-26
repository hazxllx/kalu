// frontend/src/lib/supabase.js
import { createClient } from '@supabase/supabase-js';
import { publicSupabaseConfigurationError } from '../../../shared/authConnectivity.js';
import { validateLocalEnvironment } from './localSafety.js';

/**
 * Browser Supabase client (frontend).
 *
 * Uses ONLY the public anon key — never the service-role key, which must stay
 * on the server. The anon key is safe to ship in the bundle because access is
 * ultimately controlled by Supabase Row Level Security.
 *
 * If the environment variables are missing, `supabase` is `null` and sign-in
 * is unavailable until the frontend is configured for a Supabase project.
 */
const url = String(import.meta.env?.VITE_SUPABASE_URL || '').trim();
const anonKey = String(import.meta.env?.VITE_SUPABASE_ANON_KEY || '').trim();

if (import.meta.env?.MODE && import.meta.env.MODE !== 'production') {
  validateLocalEnvironment(import.meta.env);
}

export const supabaseConfigurationError = publicSupabaseConfigurationError(url, anonKey);
export const isSupabaseConfigured = !supabaseConfigurationError;
export const SUPABASE_AUTH_STORAGE_KEY = import.meta.env?.MODE && import.meta.env.MODE !== 'production'
  ? 'kalusagap.local.auth' : 'kalusagap.auth';

export const clearPersistedSupabaseSession = () => {
  if (typeof window !== 'undefined') window.localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
};

if (!isSupabaseConfigured && import.meta.env?.DEV) {
  console.warn('Supabase authentication is not configured for this frontend build.');
}

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: SUPABASE_AUTH_STORAGE_KEY,
      },
    })
  : null;

export default supabase;
