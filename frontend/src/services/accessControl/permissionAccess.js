export const hasValidPermissionSnapshot = (state, userId, role, now = Date.now()) =>
  Boolean(
    userId &&
      role &&
      state?.userId === userId &&
      state.role === role &&
      state.status === 'ready' &&
      Number.isFinite(state.expiresAt) &&
      state.expiresAt > now,
  );

export const permissionNotice = (state, userId, online, now = Date.now()) => {
  if (!userId || state?.userId !== userId) return null;
  if (state.status === 'error') return state.failureKind === 'auth' ? 'auth' : 'error';
  if (state.status !== 'ready' || state.source !== 'cache' ||
      !Number.isFinite(state.expiresAt) || state.expiresAt <= now) return null;
  if (!online) return 'cached-offline';
  return state.failureKind ? 'cached-failed' : null;
};

export const routePermissionsAllowed = ({
  permissions,
  state,
  userId,
  role,
  can,
  now = Date.now(),
}) => {
  if (!permissions) return true;
  if (!hasValidPermissionSnapshot(state, userId, role, now)) return false;
  return permissions.some((permission) => can(permission));
};

export default { hasValidPermissionSnapshot, permissionNotice, routePermissionsAllowed };
