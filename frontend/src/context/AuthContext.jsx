import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { authApi } from '@/services/api';

const AuthContext = createContext(null);

/**
 * Reads the KALUSAGAP application role from a Supabase user. The role lives in
 * the account (app_metadata/user_metadata) — it is never selected by the user.
 * This is the FALLBACK source; the authoritative role/status/coverage live in
 * the `profiles` table and are resolved through the backend (see below).
 */
const roleFromSupabaseUser = (user) =>
  user?.app_metadata?.role || user?.user_metadata?.role || null;

const toUser = (supabaseUser) => {
  const metadata = supabaseUser?.app_metadata || {};
  const userMetadata = supabaseUser?.user_metadata || {};
  return {
    id: supabaseUser.id,
    email: supabaseUser.email,
    name: userMetadata?.name || supabaseUser.email,
    role: roleFromSupabaseUser(supabaseUser),
    // Barangay assignment for the barangay-scoped Health Supervisor role.
    // Comes from the account metadata — never chosen by the user. `barangay`
    // is kept as a backward compatible alias used by other roles. PHNs are
    // RHU-based and are never assigned a barangay.
    assignedBarangay:
      metadata?.assignedBarangay ||
      userMetadata?.assignedBarangay ||
      metadata?.barangay ||
      userMetadata?.barangay ||
      null,
    barangay:
      metadata?.assignedBarangay ||
      userMetadata?.assignedBarangay ||
      metadata?.barangay ||
      userMetadata?.barangay ||
      null,
  };
};

/** Map the backend profile user (GET /api/auth/me) to the frontend user shape. */
const profileToFrontendUser = (profileUser) => ({
  id: profileUser.id,
  email: profileUser.email,
  name: profileUser.name || profileUser.email,
  role: profileUser.role,
  status: profileUser.status ?? null,
  assignedBarangay: profileUser.barangay ?? null,
  barangay: profileUser.barangay ?? null,
  municipalityId: profileUser.municipalityId ?? null,
  municipality: profileUser.municipality ?? null,
  facilityId: profileUser.facilityId ?? null,
});

/**
 * Resolve the signed-in account's application profile through the backend.
 * Role, account status and municipality/barangay/facility coverage are read
 * from the `profiles` table on the server — never from the client.
 *
 * Returns the profile user, or null when the backend is unreachable (callers
 * fall back to the Supabase auth metadata). Throws only for account-state
 * rejections (HTTP 403: no profile, disabled or pending activation) — the
 * caller should then end the session. A 503/network failure is NOT an account
 * problem and must never be reported as one.
 */
const fetchProfileUser = async () => {
  // apiClient attaches the current Supabase access token automatically.
  const payload = await authApi.me();
  return payload?.user || null;
};

/**
 * True when the failure means "this account may not sign in" (403) or "this
 * session is no longer valid" (401) — the only cases that should end a session.
 * Anything else (5xx, 503, network) is a temporary service problem.
 */
const isAccountRejection = (err) => err?.status === 403 || err?.status === 401;

/** Message shown when the profile cannot be read for a non-account reason. */
const TRANSIENT_PROFILE_NOTICE =
  'Signed in, but your profile could not be loaded from the server (service unavailable). Some details may be incomplete — refresh in a moment.';

/**
 * Authentication provider.
 *
 * Supabase Auth is the ONLY sign-in path: credentials are verified by Supabase
 * and the application role/status/coverage are read from the `profiles` table
 * through the backend. There are no local, demo or mock accounts — when
 * Supabase is not configured the portal reports that sign-in is unavailable
 * instead of accepting a fabricated session.
 */
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  // True while the authoritative profile (role/status/coverage) is being
  // resolved for a freshly-established session — e.g. immediately after a new
  // resident registers. The route guard waits on this so it never rejects a
  // session whose role has not finished loading from the `profiles` table.
  const [isResolvingProfile, setIsResolvingProfile] = useState(false);
  const [authError, setAuthError] = useState(null);
  // Non-blocking warning: the session is valid but the profile layer failed.
  const [authNotice, setAuthNotice] = useState(null);
  // The last user resolved from the `profiles` table. Kept so a later auth
  // event (e.g. TOKEN_REFRESHED) cannot downgrade the session back to
  // metadata-only values and drop role/status/coverage.
  const resolvedProfileUser = useRef(null);
  // The auth user id currently being resolved, to de-duplicate concurrent
  // profile fetches triggered by rapid auth-state events.
  const resolvingForRef = useRef(null);

  const applyUser = useCallback((nextUser, nextSession = null) => {
    setUser(nextUser);
    setRole(nextUser?.role || null);
    setSession(nextSession);
  }, []);

  /**
   * Resolve the authoritative application profile (role/status/coverage from
   * the `profiles` table via the backend) for a session and apply it. Used for
   * any newly-established session that has not been resolved yet — most
   * importantly the just-registered resident, whose role exists only in the
   * database, never in the Supabase auth metadata. A 403/401 ends the session;
   * a transient service failure keeps the session and surfaces a notice.
   */
  const resolveProfileForSession = useCallback(async (nextSession) => {
    const uid = nextSession?.user?.id;
    if (!uid || !supabase) return;
    if (resolvingForRef.current === uid) return; // a resolve is already in flight
    resolvingForRef.current = uid;
    setIsResolvingProfile(true);
    try {
      const profileUser = await fetchProfileUser();
      if (profileUser) {
        resolvedProfileUser.current = profileToFrontendUser(profileUser);
        applyUser(resolvedProfileUser.current, nextSession);
      }
    } catch (err) {
      if (isAccountRejection(err)) {
        await supabase.auth.signOut();
        resolvedProfileUser.current = null;
        applyUser(null, null);
      } else {
        setAuthNotice(TRANSIENT_PROFILE_NOTICE);
      }
    } finally {
      resolvingForRef.current = null;
      setIsResolvingProfile(false);
    }
  }, [applyUser]);

  // --- Session restoration + auth-state subscription -----------------------
  useEffect(() => {
    let subscription;

    const init = async () => {
      if (isSupabaseConfigured && supabase) {
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user) {
          applyUser(toUser(data.session.user), data.session);
          // Refresh with the authoritative profile (role/status/coverage from
          // the profiles table) when the backend is reachable. A 403/401 means
          // the account was rejected or the session is invalid — end it. A
          // service failure keeps the session and surfaces a notice instead.
          try {
            const profileUser = await fetchProfileUser();
            if (profileUser) {
              resolvedProfileUser.current = profileToFrontendUser(profileUser);
              applyUser(resolvedProfileUser.current, data.session);
            }
          } catch (err) {
            if (isAccountRejection(err)) {
              await supabase.auth.signOut();
              resolvedProfileUser.current = null;
              applyUser(null, null);
            } else {
              setAuthNotice(TRANSIENT_PROFILE_NOTICE);
            }
          }
        }
        const listener = supabase.auth.onAuthStateChange((_event, nextSession) => {
          if (nextSession?.user) {
            const resolved = resolvedProfileUser.current;
            if (resolved && resolved.id === nextSession.user.id) {
              // Keep the database-resolved role/status/coverage.
              applyUser(resolved, nextSession);
            } else {
              // A new/unresolved session (e.g. a resident who just completed
              // registration). Show the metadata identity immediately, then
              // resolve the authoritative role from the profiles table — the
              // resident role is stored there, not in the auth metadata, so
              // without this the role would stay null and the route guard would
              // reject the account with /unauthorized.
              applyUser(toUser(nextSession.user), nextSession);
              resolveProfileForSession(nextSession);
            }
          } else {
            resolvedProfileUser.current = null;
            applyUser(null, null);
          }
        });
        subscription = listener.data?.subscription;
      }

      setIsLoadingAuth(false);
      setAuthChecked(true);
    };

    init();
    return () => subscription?.unsubscribe?.();
  }, [applyUser]);

  /**
   * Log in with email + password. Returns the resolved role on success so the
   * caller can redirect to the correct dashboard.
   */
  const login = useCallback(async ({ email, password }) => {
    setAuthError(null);
    setAuthNotice(null);

    if (!isSupabaseConfigured || !supabase) {
      const message = 'Sign-in is unavailable: Supabase authentication is not configured.';
      setAuthError({ message });
      throw new Error(message);
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data?.session?.user) {
      const message = error?.message || 'Invalid email or password';
      setAuthError({ message });
      throw new Error(message);
    }

    // Resolve the application profile through the backend so the role,
    // account status and coverage come from the database. A rejection
    // (403/401) ends the session; a service failure keeps it and warns, but
    // never claims the account has no profile.
    let nextUser = toUser(data.session.user);
    try {
      const profileUser = await fetchProfileUser();
      if (profileUser) {
        nextUser = profileToFrontendUser(profileUser);
        resolvedProfileUser.current = nextUser;
      }
    } catch (err) {
      if (isAccountRejection(err)) {
        // No profile / disabled / pending activation / invalid session —
        // do not leave a session behind.
        await supabase.auth.signOut();
        resolvedProfileUser.current = null;
        const message = err.message || 'Your account cannot sign in at this time.';
        setAuthError({ message });
        throw new Error(message);
      }

      // The profile service could not be read (outage, network, schema not
      // deployed). We cannot determine the account's role, so sign-in fails
      // closed with an accurate message — never the "no profile" error.
      await supabase.auth.signOut();
      resolvedProfileUser.current = null;
      const message =
        'Could not load your account profile from the server. Please try again in a moment.';
      setAuthError({ message });
      throw new Error(message);
    }

    applyUser(nextUser, data.session);
    return nextUser.role;
  }, [applyUser]);

  const logout = useCallback(async (shouldRedirect = true) => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    resolvedProfileUser.current = null;
    setAuthNotice(null);
    applyUser(null, null);
    if (shouldRedirect) window.location.href = '/login';
  }, [applyUser]);

  /**
   * Re-resolve the signed-in account's authoritative profile (role/status/
   * coverage) from the backend and apply it to the current session — WITHOUT a
   * re-login. This is how a resident whose identity was just approved by the
   * Health Supervisor picks up their new role: `profiles.status` flips to
   * 'active', so `effectiveRole` returns 'resident' and the limited/locked UI
   * gives way to the full resident area. Uses the same profile fetch as
   * sign-in; no polling, timers or hardcoded flags.
   */
  const refreshProfile = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return null;
    const { data } = await supabase.auth.getSession();
    const currentSession = data?.session || null;
    if (!currentSession?.user) return null;
    try {
      const profileUser = await fetchProfileUser();
      if (profileUser) {
        resolvedProfileUser.current = profileToFrontendUser(profileUser);
        applyUser(resolvedProfileUser.current, currentSession);
        return resolvedProfileUser.current.role;
      }
    } catch (err) {
      if (isAccountRejection(err)) {
        await supabase.auth.signOut();
        resolvedProfileUser.current = null;
        applyUser(null, null);
      } else {
        setAuthNotice(TRANSIENT_PROFILE_NOTICE);
      }
    }
    return null;
  }, [applyUser]);

  const value = {
    user,
    session,
    role,
    isAuthenticated: Boolean(user),
    isLoadingAuth,
    authChecked,
    isResolvingProfile,
    authError,
    authNotice,
    isSupabaseConfigured,
    login,
    logout,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
