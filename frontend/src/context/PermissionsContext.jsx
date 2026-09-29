import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

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
import { rolesApi } from '@/services/api/rolesApi';

const PermissionsContext = createContext(null);

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
  const [auditEntries, setAuditEntries] = useState([]);

  useEffect(() => {
    let active = true;
    // The permission matrix endpoint is authenticated. Only load it once a user
    // is signed in; before authentication, use the safe registry defaults so no
    // unauthenticated request is issued (which would 401).
    if (!user?.id) {
      setMatrix(hydrateMatrix(null));
      return () => {
        active = false;
      };
    }
    rolesApi
      .getMatrix()
      .then((serverMatrix) => {
        if (active) setMatrix(hydrateMatrix(serverMatrix));
      })
      .catch(() => {
        // On failure keep the safe registry defaults; never trust local storage.
        if (active) setMatrix(hydrateMatrix(null));
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

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
   */
  const can = useCallback(
    (permissionId) => {
      if (!permissionId) return true;
      const effectiveRole = role === ROLE.RESIDENT_LIMITED ? ROLE.RESIDENT : role;
      if (!effectiveRole) return false;
      return roleCan(effectiveRole, permissionId);
    },
    [role, roleCan],
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
