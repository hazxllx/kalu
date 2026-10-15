import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { ROLE } from '@/lib/roles';
import {
  ALL_PERMISSION_IDS,
  defaultPermissionsForRole,
  diffPermissionMaps,
  getModule,
  getPermission,
  normalizePermissionValue,
  roleLabel,
} from '@/lib/permissions';
import { AUDIT_LIMIT, hydrateMatrix } from '@/services/accessControl/permissionsStore';
import {
  PERMISSION_CACHE_TTL_MS,
  cacheVerifiedPermissions,
  invalidateAllVerifiedPermissions,
  invalidateVerifiedPermissions,
  readVerifiedPermissions,
} from '@/services/accessControl/permissionCache';
import { hasValidPermissionSnapshot } from '@/services/accessControl/permissionAccess';
import { rolesApi } from '@/services/api/rolesApi';
import { permissionLoadErrorMessage } from '@/services/api/permissionLoadError';
import { isNavigatorOnline } from '@/services/offline/connectivity.js';
import { classifySyncError, SYNC_ERROR } from '@/services/offline/errors.js';

const PermissionsContext = createContext(null);

/** @typedef {{userId: string|null, role?: string|null, status: 'loading'|'ready'|'error', source?: string, failureKind?: string, error?: string|null, verifiedAt?: number, expiresAt?: number}} PermissionMatrixLoadState */

/** "Admin enabled 'Approve referral' for Health Supervisor." */
const actorTitleFor = (actorRole) => (actorRole === ROLE.ADMIN ? 'Admin' : roleLabel(actorRole));

const makeId = () => `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Builds one audit record per changed permission. Every entry carries the admin
 * account, the affected role, the permission, the previous value, the new value
 * and the timestamp — the full set the KALUSAGAP audit trail requires.
 */
const buildAuditEntries = ({ actor, roleId, changedIds, previous, next, source }) => {
  const timestamp = new Date().toISOString();
  const actorTitle = actorTitleFor(actor?.role);

  return changedIds.map((permissionId) => {
    const permission = getPermission(permissionId);
    const module = getModule(permission?.moduleId);
    const newValue = Boolean(next[permissionId]);

    return {
      id: makeId(),
      timestamp,
      actorName: actor?.name || actorTitle,
      actorEmail: actor?.email || '',
      actorRole: actor?.role || null,
      actorRoleLabel: actorTitle,
      roleId,
      roleLabel: roleLabel(roleId),
      moduleId: permission?.moduleId || '',
      moduleLabel: module?.label || '',
      permissionId,
      permissionLabel: permission?.label || permissionId,
      previousValue: Boolean(previous[permissionId]),
      newValue,
      source: source || 'manual',
      summary: `${actorTitle} ${newValue ? 'enabled' : 'disabled'} '${permission?.label || permissionId}' for ${roleLabel(roleId)}.`,
    };
  });
};

/**
 * Runtime access-control state.
 *
 * Holds the role -> permission matrix an administrator maintains on the
 * Role & Permissions page, plus the audit trail of every change. Screens read
 * it through `can()` / `roleCan()`; nothing else in the app has to know how the
 * matrix is stored.
 */
export const PermissionsProvider = ({ children }) => {
  const { user, role } = useAuth();

  // BUG-011: the authoritative matrix is the server (public.role_permissions).
  // Start from the registry defaults, then load the persisted overrides from the
  // API. localStorage is no longer the source of truth.
  const [matrix, setMatrix] = useState(() => hydrateMatrix(null));
  const [matrixLoadState, setMatrixLoadState] = useState(/** @type {PermissionMatrixLoadState} */ ({
    userId: user?.id || null,
    status: user?.id ? 'loading' : 'ready',
    error: null,
  }));
  const matrixRequestRef = useRef(0);
  const matrixRequestInFlightRef = useRef(null);
  const previousUserIdRef = useRef(user?.id || null);
  const [auditEntries, setAuditEntries] = useState([]);
  const latestMatrixRef = useRef({ matrix, matrixLoadState });
  latestMatrixRef.current = { matrix, matrixLoadState };

  const refreshMatrix = useCallback(async () => {
    if (!user?.id) {
      setMatrix(hydrateMatrix(null));
      setMatrixLoadState({ userId: null, status: 'ready', error: null });
      return false;
    }
    const effectiveRole = role === ROLE.RESIDENT_LIMITED ? ROLE.RESIDENT : role;
    if (!effectiveRole) {
      setMatrix(hydrateMatrix(null));
      setMatrixLoadState({
        userId: user.id,
        status: 'error',
        failureKind: 'profile',
        error: 'Your account role could not be verified. Reconnect and refresh your profile.',
      });
      return false;
    }
    const requestKey = `${user.id}:${effectiveRole}`;
    if (matrixRequestInFlightRef.current?.key === requestKey) {
      return matrixRequestInFlightRef.current.promise;
    }
    const requestId = ++matrixRequestRef.current;
    const promise = (async () => {
      let snapshot = null;
      const { matrix: currentMatrix, matrixLoadState: current } = latestMatrixRef.current;
      if (
        current.userId === user.id &&
        current.status === 'ready' &&
        current.role === effectiveRole &&
        current.expiresAt > Date.now()
      ) {
        snapshot = {
          matrix: currentMatrix,
          verifiedAt: current.verifiedAt,
          expiresAt: current.expiresAt,
        };
      } else {
        setMatrixLoadState({ userId: user.id, role: effectiveRole, status: 'loading', error: null });
        try {
          snapshot = await readVerifiedPermissions({ userId: user.id, role: effectiveRole });
        } catch (error) {
          console.error('[kalusagap/permissions] Could not read the local permission cache.', error);
        }
      }

      if (requestId !== matrixRequestRef.current) return false;
      if (snapshot) {
        setMatrix(hydrateMatrix(snapshot.matrix));
        setMatrixLoadState({
          userId: user.id,
          role: effectiveRole,
          status: 'ready',
          source: 'cache',
          verifiedAt: snapshot.verifiedAt,
          expiresAt: snapshot.expiresAt,
          error: null,
        });
      }

      if (!isNavigatorOnline()) {
        if (!snapshot) {
          setMatrix(hydrateMatrix(null));
          setMatrixLoadState({
            userId: user.id,
            role: effectiveRole,
            status: 'error',
            failureKind: 'network',
            error: 'No unexpired verified permissions are stored on this device. Reconnect to verify access.',
          });
        }
        return Boolean(snapshot);
      }

      try {
        const serverMatrix = await rolesApi.getMatrix();
        if (requestId !== matrixRequestRef.current) return false;
        const verified = await cacheVerifiedPermissions({
          userId: user.id,
          role: effectiveRole,
          matrix: serverMatrix,
        }).catch((error) => {
          console.error('[kalusagap/permissions] Could not persist verified permissions.', error);
          return null;
        });
        setMatrix(hydrateMatrix(serverMatrix));
        const verifiedAt = verified?.verifiedAt || Date.now();
        setMatrixLoadState({
          userId: user.id,
          role: effectiveRole,
          status: 'ready',
          source: 'server',
          verifiedAt,
          expiresAt: verified?.expiresAt || verifiedAt + PERMISSION_CACHE_TTL_MS,
          error: null,
        });
        return true;
      } catch (error) {
        if (requestId !== matrixRequestRef.current) return false;
        const status = Number(error?.status || error?.statusCode || 0);
        if (status === 401 || status === 403) {
          try {
            await invalidateVerifiedPermissions(user.id);
          } catch (cacheError) {
            console.error('[kalusagap/permissions] Could not invalidate rejected permissions.', cacheError);
          }
          setMatrix(hydrateMatrix(null));
          setMatrixLoadState({
            userId: user.id,
            role: effectiveRole,
            status: 'error',
            failureKind: status === 401 ? 'auth' : 'forbidden',
            error: permissionLoadErrorMessage(error),
          });
          return false;
        }
        const failureKind = classifySyncError(error).code === SYNC_ERROR.NETWORK
          ? 'network'
          : status >= 500
            ? 'service'
            : 'unknown';
        if (snapshot && snapshot.expiresAt > Date.now()) {
          setMatrixLoadState({
            userId: user.id,
            role: effectiveRole,
            status: 'ready',
            source: 'cache',
            verifiedAt: snapshot.verifiedAt,
            expiresAt: snapshot.expiresAt,
            failureKind,
            error: permissionLoadErrorMessage(error),
          });
          return true;
        }
        setMatrix(hydrateMatrix(null));
        setMatrixLoadState({
          userId: user.id,
          role: effectiveRole,
          status: 'error',
          failureKind,
          error: permissionLoadErrorMessage(error),
        });
        return false;
      }
    })();
    matrixRequestInFlightRef.current = { key: requestKey, promise };
    try {
      return await promise;
    } finally {
      if (matrixRequestInFlightRef.current?.promise === promise) {
        matrixRequestInFlightRef.current = null;
      }
    }
  }, [role, user?.id]);

  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    if (previousUserId && previousUserId !== user?.id) {
      void invalidateVerifiedPermissions(previousUserId).catch((error) => {
        console.error('[kalusagap/permissions] Could not clear the previous account cache.', error);
      });
      setMatrix(hydrateMatrix(null));
    }
    previousUserIdRef.current = user?.id || null;
    void refreshMatrix();
    return () => {
      matrixRequestRef.current += 1;
    };
  }, [refreshMatrix]);

  useEffect(() => {
    const onOnline = () => void refreshMatrix();
    const onPermissionsInvalidated = (event) => {
      const invalidatedUserId = event.detail?.userId;
      if (!user?.id || invalidatedUserId !== user.id) return;
      matrixRequestRef.current += 1;
      setMatrix(hydrateMatrix(null));
      setMatrixLoadState({
        userId: user.id,
        role: role === ROLE.RESIDENT_LIMITED ? ROLE.RESIDENT : role,
        status: 'error',
        failureKind: event.detail?.status === 401 ? 'auth' : 'forbidden',
        error: event.detail?.status === 401
          ? 'Your session has expired. Sign in again before continuing.'
          : 'Your permissions were rejected. Contact an administrator or retry after reconnecting.',
      });
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('kalusagap:permissions-invalidated', onPermissionsInvalidated);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('kalusagap:permissions-invalidated', onPermissionsInvalidated);
    };
  }, [refreshMatrix, role, user?.id]);

  useEffect(() => {
    if (matrixLoadState.status !== 'ready' || !matrixLoadState.expiresAt) return undefined;
    const delay = Math.max(0, matrixLoadState.expiresAt - Date.now());
    const timer = window.setTimeout(() => void refreshMatrix(), delay);
    return () => window.clearTimeout(timer);
  }, [matrixLoadState.expiresAt, matrixLoadState.status, refreshMatrix]);

  const permissionsForRole = useCallback(
    (roleId) => matrix[roleId] || defaultPermissionsForRole(roleId),
    [matrix],
  );

  /** Does an arbitrary role hold a permission? */
  const roleCan = useCallback(
    (roleId, permissionId) => Boolean(permissionsForRole(roleId)?.[permissionId]),
    [permissionsForRole],
  );

  /**
   * Does the signed-in user hold a permission? A limited (pending) resident is
   * evaluated against the resident set, mirroring how routing treats it today.
   *
   * While the persisted matrix is still loading (or if the load failed and fell
   * back to the catalogue defaults), use the least-privilege defaults so an
   * authorized Health Supervisor is not temporarily denied the Add Resident
   * affordance or the Yes/No login-account choice. The server matrix, once
   * loaded, hydrates over the defaults and immediately tightens/loosens the
   * result. This preserves the bootstrap behaviour documented in
   * backend/src/services/roles.service.js (null → allow via FEATURE_ROLES) and
   * avoids the "Your role does not have the required permission" flash that
   * occurred when can() returned false during the initial fetch.
   */
  const can = useCallback(
    (permissionId) => {
      if (!permissionId) return true;
      const effectiveRole = role === ROLE.RESIDENT_LIMITED ? ROLE.RESIDENT : role;
      if (!effectiveRole) return false;
      if (!hasValidPermissionSnapshot(matrixLoadState, user?.id, effectiveRole)) return false;
      return roleCan(effectiveRole, permissionId);
    },
    [matrixLoadState, role, roleCan, user?.id],
  );

  const canAny = useCallback(
    (permissionIds = []) => permissionIds.length === 0 || permissionIds.some((id) => can(id)),
    [can],
  );

  const appendAudit = useCallback(
    (entries) => {
      if (entries.length === 0) return;
      // Session-local display only; the authoritative audit trail is recorded
      // server-side (health_audit_logs) when the change is persisted.
      setAuditEntries((current) => [...entries, ...current].slice(0, AUDIT_LIMIT));
    },
    [],
  );

  /**
   * Commit a role's draft permission map. Persists to the server (admin-only,
   * enforced by the API and RLS) and returns the changed permission ids so the
   * caller can report the result. Throws if the server rejects the change.
   */
  const saveRolePermissions = useCallback(
    async (roleId, draft, options = {}) => {
      const previous = permissionsForRole(roleId);

      const next = ALL_PERMISSION_IDS.reduce((acc, id) => {
        acc[id] = normalizePermissionValue(roleId, id, draft?.[id]);
        return acc;
      }, {});

      const changedIds = diffPermissionMaps(previous, next);
      if (changedIds.length === 0) return { changedIds: [], entries: [] };

      // Persist to the authoritative store FIRST; only reflect locally on success.
      await rolesApi.updateRolePermissions(roleId, next);
      await invalidateAllVerifiedPermissions().catch((error) => {
        console.error('[kalusagap/permissions] Could not invalidate stale permission caches.', error);
      });

      // A matrix fetch started before this save must not overwrite the saved
      // permissions if its response arrives afterwards.
      matrixRequestRef.current += 1;
      setMatrix((current) => ({ ...current, [roleId]: next }));

      const entries = buildAuditEntries({
        actor: user,
        roleId,
        changedIds,
        previous,
        next,
        source: options.source,
      });
      appendAudit(entries);

      return { changedIds, entries };
    },
    [appendAudit, permissionsForRole, user],
  );

  /** Restore a role to the defaults declared in the registry. */
  const resetRoleToDefaults = useCallback(
    (roleId) => saveRolePermissions(roleId, defaultPermissionsForRole(roleId), { source: 'reset' }),
    [saveRolePermissions],
  );

  const auditEntriesForRole = useCallback(
    (roleId) => auditEntries.filter((entry) => entry.roleId === roleId),
    [auditEntries],
  );

  const value = useMemo(
    () => ({
      matrix,
      matrixLoadState,
      refreshMatrix,
      permissionsForRole,
      roleCan,
      can,
      canAny,
      saveRolePermissions,
      resetRoleToDefaults,
      auditEntries,
      auditEntriesForRole,
    }),
    [
      matrix,
      matrixLoadState,
      refreshMatrix,
      permissionsForRole,
      roleCan,
      can,
      canAny,
      saveRolePermissions,
      resetRoleToDefaults,
      auditEntries,
      auditEntriesForRole,
    ],
  );

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
};

export const usePermissions = () => {
  const context = useContext(PermissionsContext);
  if (!context) {
    throw new Error('usePermissions must be used within a PermissionsProvider');
  }
  return context;
};

/** Convenience hook for a single check: `const canApprove = useCan('referrals.approve')`. */
export const useCan = (permissionId) => usePermissions().can(permissionId);

export default PermissionsContext;
