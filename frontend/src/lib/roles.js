/**
 * KALUSAGAP canonical roles + route-level RBAC map (frontend source of truth).
 *
 * These role ids match the backend (`backend/src/config/roles.js`) and are the
 * values expected on the authenticated Supabase account. The role is NEVER
 * chosen by the user at login — it is read from the account.
 *
 * `ROLE_HOME` is where each role lands after login. `ROUTE_ROLES` lists which
 * roles may enter each `/app/<segment>` area; `<ProtectedRoute>` enforces it.
 */
export const ROLE = Object.freeze({
  ADMIN: 'admin',
  MHO: 'mho',
  PHN: 'phn',
  HEALTH_SUPERVISOR: 'health_supervisor',
  RHU_PERSONNEL: 'rhu_personnel',
  BHW: 'bhw',
  RESIDENT: 'resident',
  // Verification sub-state of a resident account (pending identity review).
  RESIDENT_LIMITED: 'resident-limited',
});

export const ALL_ROLES = Object.values(ROLE);

/** Landing route per role, used for post-login redirects. */
export const ROLE_HOME = Object.freeze({
  [ROLE.ADMIN]: '/app/admin/dashboard',
  [ROLE.MHO]: '/app/mho/dashboard',
  [ROLE.PHN]: '/app/phn/dashboard',
  [ROLE.HEALTH_SUPERVISOR]: '/app/health_supervisor/dashboard',
  [ROLE.RHU_PERSONNEL]: '/app/rhu_personnel/dashboard',
  [ROLE.BHW]: '/app/bhw/dashboard',
  [ROLE.RESIDENT]: '/app/resident/dashboard',
  [ROLE.RESIDENT_LIMITED]: '/app/resident-limited/dashboard',
});

/**
 * Which roles may access each protected area.
 *
 * The limited (pending) area admits ONLY the limited role. A resident whose
 * identity has been approved is served as the full `resident` role, so they no
 * longer belong in the limited area — the route guard redirects them to their
 * own dashboard (see ProtectedRoute). Keeping the full `resident` out of the
 * limited area is what makes a post-approval page refresh unlock features
 * instead of lingering on the locked, limited layout.
 */
export const ROUTE_ROLES = Object.freeze({
  admin: [ROLE.ADMIN],
  mho: [ROLE.MHO],
  phn: [ROLE.PHN],
  health_supervisor: [ROLE.HEALTH_SUPERVISOR],
  rhu_personnel: [ROLE.RHU_PERSONNEL],
  bhw: [ROLE.BHW],
  resident: [ROLE.RESIDENT],
  'resident-limited': [ROLE.RESIDENT_LIMITED],
});

export const homeForRole = (role) => ROLE_HOME[role] || '/login';

/**
 * True when `path` is an `/app/<area>/...` URL that `role` is permitted to
 * open. Used to validate a redirect target before navigating to it.
 */
export const canAccessPath = (path, role) => {
  if (!path || typeof path !== 'string' || !role) return false;
  const match = /^\/app\/([^/?#]+)/.exec(path);
  if (!match) return false;
  const allowed = ROUTE_ROLES[match[1]];
  return Array.isArray(allowed) && allowed.includes(role);
};

/**
 * Where to send a user after sign-in.
 *
 * A `from` path is honored ONLY when the authenticated role may actually open
 * it. A stale `from` left in history by a previous session (or another role)
 * would otherwise drop a valid user onto /unauthorized right after a
 * successful sign-in; in that case the role's own dashboard is used instead.
 */
export const landingFor = (role, from) => (canAccessPath(from, role) ? from : homeForRole(role));

export default { ROLE, ALL_ROLES, ROLE_HOME, ROUTE_ROLES, homeForRole, canAccessPath, landingFor };
