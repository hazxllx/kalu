import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';

import { supabase, isSupabaseConfigured, supabaseConfigurationError } from '@/lib/supabase';
import { authApi } from '@/services/api';
import { authFailureMessage, isAuthNetworkFailure } from '../../../shared/authConnectivity.js';
import { createAuthOwnerLifecycle } from '@/services/auth/authOwnerLifecycle';
import { resetLegacyWorkingSets } from '@/services/local/accountWorkingSets';
import { clearAccountSensitiveCache } from '@/services/offline/records';
import { setOfflineOwnerResolver } from '@/services/offline/db';
import { resetSyncEngine } from '@/services/offline/syncEngine';
import { invalidateVerifiedPermissions } from '@/services/accessControl/permissionCache';
import {
  cacheServerVerifiedProfile,
  invalidateServerVerifiedProfile,
  readServerVerifiedProfile,
  readStoredVerifiedProfileScope,
  verifiedProfileScopeKey,
} from '@/services/offline/verifiedProfileCache';

const AuthContext = createContext(null);

/** Auth identity only. Permissions and coverage require the server profile. */
const toUser = (supabaseUser) => {
  const userMetadata = supabaseUser?.user_metadata || {};
  return {
    id: supabaseUser.id,
    email: supabaseUser.email,
    name: userMetadata?.name || supabaseUser.email,
    role: null,
    assignedBarangay: null,
    barangay: null,
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
  barangayId: profileUser.barangayId ?? null,
  municipalityId: profileUser.municipalityId ?? null,
  municipality: profileUser.municipality ?? null,
  facilityId: profileUser.facilityId ?? null,
  // RHU station assignment(s) — drives station-based nav/route gating in the UI
  // (the backend enforces the same rule authoritatively on every API call).
  rhuStations: Array.isArray(profileUser.rhuStations) ? profileUser.rhuStations : [],
  // Self-service account details (Settings page): own editable contact number,
  // read-only registration date and stable account reference.
  contact: profileUser.contact ?? '',
  licenseNo: profileUser.licenseNo ?? '',
  position: profileUser.position ?? '',
  createdAt: profileUser.createdAt ?? null,
  referenceNumber: profileUser.referenceNumber ?? profileUser.id ?? null,
});

/**
 * Resolve the signed-in account's application profile through the backend.
 * Role, account status and municipality/barangay/facility coverage are read
 * from the `profiles` table on the server — never from the client.
 *
 * Returns a verified profile or throws. Metadata never grants an application
 * role. Only genuine account/session rejection ends authentication; temporary
 * profile failures retain the SDK session without admitting protected pages.
 */
const fetchProfileUser = async (ownerId, accessToken) => {
  // Bind cache eligibility to the exact token this server response verified.
  const payload = await authApi.me({ ownerId, headers: { Authorization: `Bearer ${accessToken}` } });
  if (!payload?.user?.role || payload.user.id !== ownerId) throw Object.assign(new Error('The server did not return the current account profile.'), { code: 'AUTH_PROFILE_INVALID' });
  return payload.user;
};

/**
 * True when the failure means "this account may not sign in" (403) or "this
 * session is no longer valid" (401) — the only cases that should end a session.
 * Anything else (5xx, 503, network) is a temporary service problem.
 */
const isAccountRejection = (err) => !['owner-changed', 'AUTH_SESSION_CHANGED'].includes(err?.code) && (err?.status === 403 || err?.status === 401);

const sessionError = (code) => Object.assign(new Error(authFailureMessage({ code })), { code });
const profileFailureMessage = (error) => {
  if (isAccountRejection(error)) return error.message || 'Your account is not verified or permitted to sign in.';
  if (isAuthNetworkFailure(error)) return 'Cannot reach your account profile. Check your connection and try again; your Supabase session has been retained.';
  return 'Your account profile server is unavailable or could not verify your profile. Please try again; your Supabase session has been retained.';
};

/** Message shown when the profile cannot be read for a non-account reason. */
const TRANSIENT_PROFILE_NOTICE =
  'Your session was restored, but the server account profile is unavailable. Protected pages remain unavailable until the profile can be verified.';
const CACHED_PROFILE_NOTICE =
  'Offline access is using a previously server-verified account profile and unexpired cached permissions. Reconnect to verify current access; online authorization remains server-controlled.';
const permitsCachedRestore = (error) => error?.code !== 'AUTH_PROFILE_INVALID' && !isAccountRejection(error) &&
  (isAuthNetworkFailure(error) || Number(error?.status ?? error?.statusCode) >= 500);

/**
 * True when the current page load is a Supabase password-recovery flow.
 *
 * A recovery link establishes a short-lived Supabase session so the user can
 * set a new password on `/reset-password`. That session must NOT be treated as
 * a normal application sign-in: resolving the account profile here would run
 * the backend `GET /api/auth/me`, and any account-state rejection (403 — e.g. a
 * resident still pending verification) would call `signOut()` and destroy the
 * recovery session before the user can reset their password, leaving the reset
 * page showing an "invalid link" error. The ResetPassword page owns this
 * session instead. Detected from the route and the recovery hash (the hash is
 * stripped quickly by `detectSessionInUrl`, so the route check is the durable
 * signal).
 */
const RECOVERY_PATH = '/reset-password';
const isRecoveryFlow = () => {
  if (typeof window === 'undefined') return false;
  const onResetRoute = (window.location.pathname || '').startsWith(RECOVERY_PATH);
  const hash = window.location.hash || '';
  return onResetRoute || hash.includes('type=recovery');
};

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
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [authError, setAuthError] = useState(null);
  // Non-blocking warning: the session is valid but the profile layer failed.
  const [authNotice, setAuthNotice] = useState(null);
  const [profileAccess, setProfileAccess] = useState(null);
  const profileAccessRef = useRef(null);
  // Previously server-confirmed profile. Token changes require a fresh proof;
  // unchanged-session events do not downgrade it to metadata-only values.
  const resolvedProfileUser = useRef(null);
  // The auth user id currently being resolved, to de-duplicate concurrent
  // profile fetches triggered by rapid auth-state events.
  const resolvingForRef = useRef(null);
  const currentSessionRef = useRef(null);
  const sessionEpochRef = useRef(0);
  const profileRequestRef = useRef(null);
  const loginRequestRef = useRef(null);
  const logoutRequestRef = useRef(null);
  // True once a PASSWORD_RECOVERY event is seen (or the page loaded inside the
  // recovery flow). While set, auth-state changes for the recovery session are
  // ignored so the ResetPassword page can own it — see `isRecoveryFlow`.
  const recoveryActiveRef = useRef(false);
  const lifecycleRef = useRef(null);
  if (!lifecycleRef.current) lifecycleRef.current = createAuthOwnerLifecycle({
    bindOwner: setOfflineOwnerResolver,
    clearCache: clearAccountSensitiveCache,
    resetStores: resetLegacyWorkingSets,
    stopSync: resetSyncEngine,
  });

  useEffect(() => {
    const lifecycle = lifecycleRef.current;
    lifecycle.install();
    return () => { lifecycle.dispose().catch((error) => console.error('Could not clean disposable account cache.', error)); };
  }, []);

  const invalidateProfileAccess = useCallback(async (ownerId = null, options = {}) => {
    const cachedOwner = await invalidateServerVerifiedProfile(ownerId, options);
    if (ownerId || cachedOwner) await invalidateVerifiedPermissions(ownerId || cachedOwner);
  }, []);

  const applyUser = useCallback((nextUser, nextSession = null) => {
    const nextOwner = nextSession?.user?.id || nextUser?.id || null;
    const previousOwner = currentSessionRef.current?.user?.id || null;
    if (previousOwner !== nextOwner) {
      sessionEpochRef.current += 1;
      resolvedProfileUser.current = null;
      profileAccessRef.current = null;
      setProfileAccess(null);
      resolvingForRef.current = null;
      profileRequestRef.current = null;
      void invalidateProfileAccess(previousOwner, previousOwner ? {} : { keepOwnerId: nextOwner }).catch(() => {});
    }
    currentSessionRef.current = nextSession;
    lifecycleRef.current.change(nextOwner, nextSession?.expires_at ? nextSession.expires_at * 1000 : null)
      .catch((error) => console.error('Could not clean disposable account cache. Pending work was retained.', error));
    setUser(nextUser);
    setRole(nextUser?.role || null);
    setSession(nextSession);
  }, [invalidateProfileAccess]);

  const sessionGuard = useCallback((ownerId) => {
    const epoch = sessionEpochRef.current;
    return () => epoch === sessionEpochRef.current && currentSessionRef.current?.user?.id === ownerId &&
      currentSessionRef.current.expires_at * 1000 > Date.now();
  }, []);

  const loadSessionProfile = useCallback((ownerId) => {
    const epoch = sessionEpochRef.current;
    const existing = profileRequestRef.current;
    if (existing?.ownerId === ownerId && existing.epoch === epoch) return existing.promise;
    const request = { ownerId, epoch, promise: null };
    request.promise = (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const verifiedSession = currentSessionRef.current;
        try {
          const profileUser = await fetchProfileUser(ownerId, verifiedSession?.access_token);
          if (epoch === sessionEpochRef.current && currentSessionRef.current?.user?.id === ownerId &&
              currentSessionRef.current.access_token !== verifiedSession?.access_token) {
            if (attempt === 0) continue;
            throw sessionError('AUTH_SESSION_CHANGED');
          }
          return { profileUser, verifiedSession };
        } catch (error) {
          // A refreshed token is verified once, never rebound from unsigned
          // claims or cached role metadata after an old-token response.
          if (attempt === 0 && error?.status === 401 && epoch === sessionEpochRef.current &&
              currentSessionRef.current?.user?.id === ownerId && currentSessionRef.current.access_token !== verifiedSession?.access_token) continue;
          throw error;
        }
      }
    })().finally(() => {
      if (profileRequestRef.current === request) profileRequestRef.current = null;
    });
    profileRequestRef.current = request;
    return request.promise;
  }, []);

  const rememberServerProfile = useCallback(async ({ profileUser, verifiedSession }) => {
    const nextUser = profileToFrontendUser(profileUser);
    const guard = sessionGuard(nextUser.id);
    const current = () => guard() && !logoutRequestRef.current && currentSessionRef.current?.access_token === verifiedSession?.access_token;
    if (!current()) return null;
    let previousScope = resolvedProfileUser.current?.id === nextUser.id
      ? verifiedProfileScopeKey(resolvedProfileUser.current) : null;
    if (!previousScope) {
      try { previousScope = await readStoredVerifiedProfileScope(nextUser.id); } catch { /* unavailable disposable cache */ }
    }
    if (!current()) return null;
    if (previousScope !== verifiedProfileScopeKey(nextUser)) {
      // Known role/coverage/lifecycle changes fence old reads and clear only
      // disposable data. Pending drafts and their protected bases stay durable.
      resolvedProfileUser.current = null;
      profileAccessRef.current = null;
      setProfileAccess(null);
      applyUser(toUser(currentSessionRef.current.user), currentSessionRef.current);
      resetSyncEngine();
      await invalidateProfileAccess(nextUser.id);
      await lifecycleRef.current.cleanup(nextUser.id);
    }
    if (!current()) return null;
    let cached = null;
    try { cached = await cacheServerVerifiedProfile({ user: nextUser, session: verifiedSession, isOwnerCurrent: current }); }
    catch { /* online profile remains authoritative when secure storage is unavailable */ }
    if (!current()) return null;
    resolvedProfileUser.current = nextUser;
    profileAccessRef.current = { source: 'server', expiresAt: cached?.expiresAt ?? null };
    setProfileAccess(profileAccessRef.current);
    applyUser(nextUser, currentSessionRef.current);
    setAuthNotice(null);
    return nextUser;
  }, [applyUser, invalidateProfileAccess, sessionGuard]);

  const restoreCachedProfile = useCallback(async (ownerId) => {
    const guard = sessionGuard(ownerId);
    const current = () => guard() && !logoutRequestRef.current;
    let snapshot;
    try { snapshot = await readServerVerifiedProfile({ session: currentSessionRef.current, isOwnerCurrent: current }); }
    catch { return false; }
    if (!current() || !snapshot || snapshot.expiresAt <= Date.now()) return false;
    resolvedProfileUser.current = snapshot.user;
    profileAccessRef.current = { source: 'cache', verifiedAt: snapshot.verifiedAt, expiresAt: snapshot.expiresAt };
    setProfileAccess(profileAccessRef.current);
    applyUser(snapshot.user, currentSessionRef.current);
    setAuthNotice(CACHED_PROFILE_NOTICE);
    return true;
  }, [applyUser, sessionGuard]);

  const rejectSessionProfile = useCallback(async (ownerId) => {
    const guard = sessionGuard(ownerId);
    if (!guard()) return;
    resolvedProfileUser.current = null;
    profileAccessRef.current = null;
    setProfileAccess(null);
    applyUser(toUser(currentSessionRef.current.user), currentSessionRef.current);
    await invalidateProfileAccess(ownerId).catch(() => {});
    if (!guard()) return;
    try { await supabase.auth.signOut(); } catch { /* rejected local profile stays blocked */ }
    if (!currentSessionRef.current || currentSessionRef.current.user?.id === ownerId) applyUser(null, null);
  }, [applyUser, invalidateProfileAccess, sessionGuard]);

  /**
   * Resolve the authoritative application profile (role/status/coverage from
   * the `profiles` table via the backend) for a session and apply it. Used for
   * any newly-established session that has not been resolved yet — most
   * importantly the just-registered resident, whose role exists only in the
   * database, never in the Supabase auth metadata. A 403/401 ends the session;
   * a transient service failure keeps the session and surfaces a notice.
   */
  const resolveProfileForSession = useCallback(async (nextSession, { allowCachedRestore = false, force = false } = {}) => {
    const uid = nextSession?.user?.id;
    if (!uid || !supabase) return;
    if (!force && resolvedProfileUser.current?.id === uid) return; // a queued duplicate INITIAL_SESSION already completed
    if (resolvingForRef.current === uid) return; // a resolve is already in flight
    const guard = sessionGuard(uid);
    resolvingForRef.current = uid;
    setIsResolvingProfile(true);
    try {
      const verified = await loadSessionProfile(uid);
      if (!guard()) return;
      await rememberServerProfile(verified);
    } catch (err) {
      if (!guard()) return;
      if (isAccountRejection(err)) {
        await rejectSessionProfile(uid);
      } else {
        if (allowCachedRestore && permitsCachedRestore(err) && await restoreCachedProfile(uid)) return;
        if (!guard()) return;
        resolvedProfileUser.current = null;
        profileAccessRef.current = null;
        setProfileAccess(null);
        applyUser(toUser(currentSessionRef.current.user), currentSessionRef.current);
        setAuthNotice(profileFailureMessage(err));
      }
    } finally {
      if (guard()) { resolvingForRef.current = null; setIsResolvingProfile(false); }
    }
  }, [applyUser, sessionGuard, loadSessionProfile, rememberServerProfile, rejectSessionProfile, restoreCachedProfile]);

  // --- Session restoration + auth-state subscription -----------------------
  useEffect(() => {
    let subscription;
    let active = true;
    let liveEventSeen = false;
    const deferredProfiles = new Set();
    const acceptSession = (event, nextSession) => {
      if (!active) return;
      if (event === 'INITIAL_SESSION' && liveEventSeen) return;
      if (event !== 'INITIAL_SESSION') liveEventSeen = true;
      if (event === 'PASSWORD_RECOVERY') {
        recoveryActiveRef.current = true;
        if (loginRequestRef.current) loginRequestRef.current.cancelReason = 'AUTH_SESSION_CHANGED';
        applyUser(null, null);
        void invalidateProfileAccess().catch(() => {});
        setIsResolvingProfile(false);
        return;
      }
      if (event === 'SIGNED_OUT' || !nextSession?.user) {
        recoveryActiveRef.current = false;
        applyUser(null, null);
        void invalidateProfileAccess().catch(() => {});
        setIsResolvingProfile(false);
        return;
      }
      // Do not consume or revoke the short-lived password-reset session.
      if (recoveryActiveRef.current || isRecoveryFlow()) return;
      if (!nextSession.access_token || !Number.isFinite(nextSession.expires_at) || nextSession.expires_at * 1000 <= Date.now()) {
        applyUser(null, null);
        void invalidateProfileAccess().catch(() => {});
        setIsResolvingProfile(false);
        setAuthNotice('Your session expired. Sign in again to access your records. Pending offline work remains protected.');
        return;
      }
      const resolved = resolvedProfileUser.current;
      const tokenChanged = currentSessionRef.current?.user?.id === nextSession.user.id &&
        currentSessionRef.current?.access_token !== nextSession.access_token;
      const loginRequest = loginRequestRef.current;
      if (loginRequest?.ownerId && loginRequest.ownerId !== nextSession.user.id) {
        loginRequest.cancelReason = 'AUTH_SESSION_CHANGED';
        setIsSigningIn(false);
      }
      if (resolved?.id === nextSession.user.id && !tokenChanged) {
        applyUser(resolved, nextSession);
      } else {
        resolvedProfileUser.current = null;
        profileAccessRef.current = null;
        setProfileAccess(null);
        applyUser(toUser(nextSession.user), nextSession);
        setIsResolvingProfile(true);
        if (loginRequest && !loginRequest.cancelReason) return; // login owns this profile lookup
        // Defer beyond GoTrue's notification/mutex, never call SDK methods
        // recursively inside onAuthStateChange or start duplicate lookups.
        const timer = setTimeout(() => {
          deferredProfiles.delete(timer);
          if (active) void resolveProfileForSession(currentSessionRef.current, { allowCachedRestore: event === 'INITIAL_SESSION' });
        }, 0);
        deferredProfiles.add(timer);
      }
    };
    const init = async () => {
      try {
        if (isSupabaseConfigured && supabase) {
          recoveryActiveRef.current = isRecoveryFlow();
          if (recoveryActiveRef.current) void invalidateProfileAccess().catch(() => {});
          // Subscribe before awaiting profile I/O so sign-out/switches fence it.
          subscription = supabase.auth.onAuthStateChange(acceptSession).data?.subscription;
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!active) return;
          if (!liveEventSeen && data?.session?.user && !recoveryActiveRef.current) acceptSession('INITIAL_SESSION', data.session);
        }
      } catch (error) {
        if (active) setAuthError({ message: authFailureMessage(error) });
      } finally {
        if (active) { setIsLoadingAuth(false); setAuthChecked(true); }
      }
    };
    void init();
    return () => {
      active = false;
      sessionEpochRef.current += 1;
      profileRequestRef.current = null;
      for (const timer of deferredProfiles) clearTimeout(timer);
      subscription?.unsubscribe?.();
    };
  }, [applyUser, resolveProfileForSession, invalidateProfileAccess]);

  useEffect(() => {
    if (!session?.expires_at || !session.user?.id) return;
    const id = session.user.id;
    const timer = setTimeout(() => {
      if (lifecycleRef.current.ownerId === id && !lifecycleRef.current.currentOwner()) {
        resolvedProfileUser.current = null;
        applyUser(null, null);
        setAuthNotice('Your session expired. Sign in again to access your records. Pending offline work remains protected.');
      }
    }, Math.max(0, session.expires_at * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [session?.expires_at, session?.user?.id, applyUser]);

  useEffect(() => {
    if (profileAccess?.source !== 'cache' || !profileAccess.expiresAt || !session?.user?.id) return;
    const ownerId = session.user.id;
    const timer = setTimeout(() => {
      if (currentSessionRef.current?.user?.id !== ownerId || profileAccessRef.current?.source !== 'cache') return;
      resolvedProfileUser.current = null;
      profileAccessRef.current = null;
      setProfileAccess(null);
      applyUser(toUser(currentSessionRef.current.user), currentSessionRef.current);
      void invalidateProfileAccess(ownerId).catch(() => {});
      setAuthNotice('Cached account access expired. Reconnect to verify your profile and permissions. Pending work remains protected.');
    }, Math.max(0, profileAccess.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [profileAccess?.source, profileAccess?.expiresAt, session?.user?.id, applyUser, invalidateProfileAccess]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onRejectedPermissions = (event) => {
      const ownerId = event.detail?.userId;
      if (!ownerId || currentSessionRef.current?.user?.id !== ownerId) return;
      void invalidateProfileAccess(ownerId).catch(() => {});
      if (profileAccessRef.current?.source !== 'cache') return;
      resolvedProfileUser.current = null;
      profileAccessRef.current = null;
      setProfileAccess(null);
      applyUser(toUser(currentSessionRef.current.user), currentSessionRef.current);
      setAuthNotice('Cached access was rejected. Reconnect to verify your current profile and permissions.');
    };
    window.addEventListener('kalusagap:permissions-invalidated', onRejectedPermissions);
    return () => window.removeEventListener('kalusagap:permissions-invalidated', onRejectedPermissions);
  }, [applyUser, invalidateProfileAccess]);

  /**
   * Log in with email + password. Returns the resolved role on success so the
   * caller can redirect to the correct dashboard.
   */
  const login = useCallback(async ({ email, password }) => {
    if ((loginRequestRef.current && !loginRequestRef.current.cancelReason) || logoutRequestRef.current) throw sessionError('AUTH_IN_PROGRESS');
    const request = { ownerId: null, cancelReason: null, credentials: null, session: null };
    loginRequestRef.current = request;
    setIsSigningIn(true);
    setAuthError(null);
    setAuthNotice(null);

    try {
      if (!isSupabaseConfigured || !supabase) {
        const message = `Sign-in is unavailable. ${supabaseConfigurationError || 'Supabase authentication is not configured.'}`;
        setAuthError({ message });
        throw new Error(message);
      }

      recoveryActiveRef.current = false;
      const cacheBoundary = invalidateProfileAccess().catch(() => {});
      let result;
      try {
        request.credentials = supabase.auth.signInWithPassword({ email, password });
        result = await request.credentials;
      } catch (error) {
        if (request.cancelReason) throw sessionError(request.cancelReason);
        const message = authFailureMessage(error);
        setAuthError({ message });
        throw new Error(message);
      }
      request.session = result?.data?.session || null;
      if (request.cancelReason) throw sessionError(request.cancelReason);
      const { data, error } = result;
      if (error || !data?.session?.user || !data.session.access_token || !Number.isFinite(data.session.expires_at)) {
        const message = authFailureMessage(error || { code: 'AUTH_INVALID_RESPONSE' });
        setAuthError({ message });
        throw new Error(message);
      }

      // The application role always comes from the verified server profile.
      let nextUser = toUser(data.session.user);
      request.ownerId = nextUser.id;
      const nextSession = currentSessionRef.current?.user?.id === nextUser.id ? currentSessionRef.current : data.session;
      resolvedProfileUser.current = null;
      profileAccessRef.current = null;
      setProfileAccess(null);
      applyUser(nextUser, nextSession);
      setIsResolvingProfile(true);
      const guard = sessionGuard(nextUser.id);
      try {
        await cacheBoundary;
        if (request.cancelReason || !guard()) throw sessionError(request.cancelReason || 'AUTH_SESSION_CHANGED');
        const verified = await loadSessionProfile(nextUser.id);
        if (request.cancelReason || !guard()) throw sessionError(request.cancelReason || (currentSessionRef.current ? 'AUTH_SESSION_CHANGED' : 'session_expired'));
        nextUser = await rememberServerProfile(verified);
        if (!nextUser || request.cancelReason || !guard()) throw sessionError(request.cancelReason || 'AUTH_SESSION_CHANGED');
      } catch (err) {
        if (request.cancelReason || !guard()) throw sessionError(request.cancelReason || (currentSessionRef.current ? 'AUTH_SESSION_CHANGED' : 'session_expired'));
        if (isAccountRejection(err)) {
          await rejectSessionProfile(request.ownerId);
          if (!currentSessionRef.current || currentSessionRef.current.user?.id === nextUser.id) {
            resolvedProfileUser.current = null;
            applyUser(null, null);
            setAuthError({ message: err.message || 'Your account cannot sign in at this time.' });
          }
          throw new Error(err.message || 'Your account cannot sign in at this time.');
        }

        // Keep valid authentication through an outage, but never grant a
        // metadata-only role or navigate before the server profile is verified.
        const message = profileFailureMessage(err);
        setAuthNotice(message);
        setAuthError({ message });
        throw new Error(message);
      }

      return nextUser.role;
    } finally {
      if (loginRequestRef.current === request) {
        loginRequestRef.current = null;
        setIsSigningIn(false);
        if (!resolvingForRef.current) setIsResolvingProfile(false);
      }
    }
  }, [applyUser, sessionGuard, loadSessionProfile, rememberServerProfile, rejectSessionProfile, invalidateProfileAccess]);

  const logout = useCallback(async (shouldRedirect = true) => {
    if (logoutRequestRef.current) return logoutRequestRef.current;
    const loginRequest = loginRequestRef.current;
    if (loginRequest) loginRequest.cancelReason = 'AUTH_SIGN_IN_CANCELLED';
    setIsSigningOut(true);
    const job = (async () => {
      // Wait only for the non-abortable password grant, not its profile I/O.
      if (loginRequest?.credentials) {
        const result = await loginRequest.credentials.catch(() => null);
        if (result?.data?.session) loginRequest.session = result.data.session;
      }
      const ownerId = lifecycleRef.current.ownerId;
      const guard = ownerId ? sessionGuard(ownerId) : () => !currentSessionRef.current;
      await invalidateProfileAccess(ownerId).catch(() => {});
      resetSyncEngine();
      resetLegacyWorkingSets();
      if (isSupabaseConfigured && supabase) {
        try {
          await authApi.logout(ownerId ? { ownerId } : undefined);
        } catch { /* best-effort; SDK sign-out still ends this session */ }
        const { data } = await supabase.auth.getSession();
        const expectedOwner = ownerId || loginRequest?.session?.user?.id;
        if ((guard() || !ownerId) && data?.session?.user?.id === expectedOwner) await supabase.auth.signOut();
      }
      if (guard() || !lifecycleRef.current.ownerId) {
        resolvedProfileUser.current = null;
        resolvingForRef.current = null;
        setIsResolvingProfile(false);
        setAuthNotice(null);
        applyUser(null, null);
      }
      try { await lifecycleRef.current.cleanup(ownerId); }
      catch (error) { console.error('Could not clean disposable account cache. Pending work was retained.', error); }
      if (shouldRedirect && !lifecycleRef.current.ownerId) window.location.href = '/login';
    })();
    logoutRequestRef.current = job;
    try { return await job; }
    finally { if (logoutRequestRef.current === job) { logoutRequestRef.current = null; setIsSigningOut(false); } }
  }, [applyUser, sessionGuard, invalidateProfileAccess]);

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
    const { data, error } = await supabase.auth.getSession();
    if (error) { setAuthNotice(profileFailureMessage(error)); return null; }
    const currentSession = data?.session || null;
    if (!currentSession?.user) { applyUser(null, null); return null; }
    if (currentSession.user.id !== lifecycleRef.current.ownerId) return null;
    const guard = sessionGuard(currentSession.user.id);
    try {
      const verified = await loadSessionProfile(currentSession.user.id);
      if (guard()) {
        const nextUser = await rememberServerProfile(verified);
        if (!nextUser || !guard()) return null;
        setAuthError(null);
        return nextUser.role;
      }
    } catch (err) {
      if (!guard()) return null;
      if (isAccountRejection(err)) {
        await rejectSessionProfile(currentSession.user.id);
      } else {
        if (permitsCachedRestore(err) && await restoreCachedProfile(currentSession.user.id)) return null;
        if (!guard()) return null;
        resolvedProfileUser.current = null;
        profileAccessRef.current = null;
        setProfileAccess(null);
        applyUser(toUser(currentSessionRef.current.user), currentSessionRef.current);
        setAuthNotice(TRANSIENT_PROFILE_NOTICE);
      }
    }
    return null;
  }, [applyUser, sessionGuard, loadSessionProfile, rememberServerProfile, rejectSessionProfile, restoreCachedProfile]);

  useEffect(() => {
    if (!supabase || typeof window === 'undefined') return;
    let active = true;
    const retryUnverifiedSession = async () => {
      if (loginRequestRef.current || logoutRequestRef.current || recoveryActiveRef.current ||
          (resolvedProfileUser.current && profileAccessRef.current?.source === 'server')) return;
      const epoch = sessionEpochRef.current;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!active || error || epoch !== sessionEpochRef.current || !data?.session?.user || isRecoveryFlow()) return;
        const nextSession = data.session;
        if (currentSessionRef.current?.user?.id && currentSessionRef.current.user.id !== nextSession.user.id) return;
        applyUser(resolvedProfileUser.current || toUser(nextSession.user), nextSession);
        await resolveProfileForSession(nextSession, { force: true, allowCachedRestore: true });
      } catch { /* retain the valid session and existing connectivity notice */ }
    };
    window.addEventListener('online', retryUnverifiedSession);
    return () => { active = false; window.removeEventListener('online', retryUnverifiedSession); };
  }, [applyUser, resolveProfileForSession]);

  const value = {
    user,
    session,
    role,
    isAuthenticated: Boolean(user?.role && session?.user?.id === user.id) && !isSigningOut &&
      (profileAccess?.source !== 'cache' || profileAccess.expiresAt > Date.now()),
    isLoadingAuth,
    authChecked,
    isResolvingProfile,
    isSigningIn,
    isSigningOut,
    authError,
    authNotice,
    profileSource: profileAccess?.source ?? null,
    isOfflineProfile: profileAccess?.source === 'cache',
    profileExpiresAt: profileAccess?.expiresAt ?? null,
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
