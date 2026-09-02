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
import {
  AUDIT_LIMIT,
  loadAuditEntries,
  loadMatrix,
  persistAuditEntries,
  persistMatrix,
} from '@/services/accessControl/permissionsStore';

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

  const [matrix, setMatrix] = useState(() => loadMatrix());
  const [auditEntries, setAuditEntries] = useState(() => loadAuditEntries());

  // Keep other tabs of the same admin session in step.
  useEffect(() => {
    const onStorage = (event) => {
      if (!event.key || event.key.startsWith('kalusagap.access.')) {
        setMatrix(loadMatrix());
        setAuditEntries(loadAuditEntries());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

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
      const next = [...entries, ...auditEntries].slice(0, AUDIT_LIMIT);
      setAuditEntries(next);
      persistAuditEntries(next);
    },
    [auditEntries],
  );

  /**
   * Commit a role's draft permission map.
   * Returns the changed permission ids so the caller can report the result.
   */
  const saveRolePermissions = useCallback(
    (roleId, draft, options = {}) => {
      const previous = permissionsForRole(roleId);

      const next = ALL_PERMISSION_IDS.reduce((acc, id) => {
        acc[id] = normalizePermissionValue(roleId, id, draft?.[id]);
        return acc;
      }, {});

      const changedIds = diffPermissionMaps(previous, next);
      if (changedIds.length === 0) return { changedIds: [], entries: [] };

      const nextMatrix = { ...matrix, [roleId]: next };
      setMatrix(nextMatrix);
      persistMatrix(nextMatrix);

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
    [appendAudit, matrix, permissionsForRole, user],
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
