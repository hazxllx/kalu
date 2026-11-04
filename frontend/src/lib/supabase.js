import { createClient } from '@supabase/supabase-js';
import { publicSupabaseConfigurationError } from '../../../shared/authConnectivity.js';

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

export const supabaseConfigurationError = publicSupabaseConfigurationError(url, anonKey);
export const isSupabaseConfigured = !supabaseConfigurationError;

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'kalusagap.auth',
      },
    })
  : null;

export default supabase;
