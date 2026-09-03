import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { findMockAccount } from '@/services/mock/mockAccounts';

const AuthContext = createContext(null);

const DEV_SESSION_KEY = 'kalusagap.dev.session';

/**
 * Reads the KALUSAGAP application role from a Supabase user. The role lives in
 * the account (app_metadata/user_metadata) — it is never selected by the user.
 */
const roleFromSupabaseUser = (user) =>
  user?.app_metadata?.role || user?.user_metadata?.role || null;

const toUser = (supabaseUser) => ({
  id: supabaseUser.id,
  email: supabaseUser.email,
  name: supabaseUser.user_metadata?.name || supabaseUser.email,
  role: roleFromSupabaseUser(supabaseUser),
  // Barangay assignment for barangay-scoped roles (e.g. Health Supervisor).
  // Comes from the account metadata — never chosen by the user.
  barangay: supabaseUser.app_metadata?.barangay || supabaseUser.user_metadata?.barangay || null,
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState(null);

  const applyUser = useCallback((nextUser, nextSession = null) => {
    setUser(nextUser);
    setRole(nextUser?.role || null);
    setSession(nextSession);
  }, []);

  // --- Session restoration + auth-state subscription -----------------------
  useEffect(() => {
    let subscription;

    const init = async () => {
      if (isSupabaseConfigured && supabase) {
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user) {
          applyUser(toUser(data.session.user), data.session);
        }
        const listener = supabase.auth.onAuthStateChange((_event, nextSession) => {
          if (nextSession?.user) {
            applyUser(toUser(nextSession.user), nextSession);
          } else {
            applyUser(null, null);
          }
        });
        subscription = listener.data?.subscription;
      } else {
        // Dev fallback: restore a previously stored dev session.
        try {
          const raw = localStorage.getItem(DEV_SESSION_KEY);
          if (raw) applyUser(JSON.parse(raw), { dev: true });
        } catch {
          /* ignore malformed dev session */
        }
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

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data?.session?.user) {
        const message = error?.message || 'Invalid email or password';
        setAuthError({ message });
        throw new Error(message);
      }
      const nextUser = toUser(data.session.user);
      applyUser(nextUser, data.session);
      return nextUser.role;
    }

    // --- DEV FALLBACK (no Supabase configured) -----------------------------
    // Resolves the account by email only; the role comes from the matched
    // account, so a user still cannot pick their own role. This path is for
    // local development and disappears automatically once Supabase env vars
    // are set.
    const account = findMockAccount(email);
    if (!account || !password) {
      const message = 'Invalid email or password';
      setAuthError({ message });
      throw new Error(message);
    }
    const devUser = {
      id: `dev-${account.role}`,
      email: account.email,
      name: account.name,
      role: account.role,
      barangay: account.barangay || null,
    };
    try {
      localStorage.setItem(DEV_SESSION_KEY, JSON.stringify(devUser));
    } catch {
      /* storage may be unavailable */
    }
    applyUser(devUser, { dev: true });
    return devUser.role;
  }, [applyUser]);

  const logout = useCallback(async (shouldRedirect = true) => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    } else {
      try {
        localStorage.removeItem(DEV_SESSION_KEY);
      } catch {
        /* ignore */
      }
    }
    applyUser(null, null);
    if (shouldRedirect) window.location.href = '/login';
  }, [applyUser]);

  const value = {
    user,
    session,
    role,
    isAuthenticated: Boolean(user),
    isLoadingAuth,
    authChecked,
    authError,
    isSupabaseConfigured,
    login,
    logout,
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
