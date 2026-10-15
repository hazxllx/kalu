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

export default { hasValidPermissionSnapshot, routePermissionsAllowed };
