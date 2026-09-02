import { createClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client (frontend).
 *
 * Uses ONLY the public anon key — never the service-role key, which must stay
 * on the server. The anon key is safe to ship in the bundle because access is
 * ultimately controlled by Supabase Row Level Security.
 *
 * If the env vars are not set yet, `supabase` is `null` and the app falls back
 * to local development auth (see `@/context/AuthContext`). This keeps the UI
 * runnable before the real Supabase project is connected.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

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
