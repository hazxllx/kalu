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
 * Which roles may access each protected area. A resident area also admits the
 * limited (pending) resident state, and vice-versa, since it is the same person.
 */
export const ROUTE_ROLES = Object.freeze({
  admin: [ROLE.ADMIN],
  mho: [ROLE.MHO],
  phn: [ROLE.PHN],
  health_supervisor: [ROLE.HEALTH_SUPERVISOR],
  rhu_personnel: [ROLE.RHU_PERSONNEL],
  bhw: [ROLE.BHW],
  resident: [ROLE.RESIDENT],
  'resident-limited': [ROLE.RESIDENT, ROLE.RESIDENT_LIMITED],
});

export const homeForRole = (role) => ROLE_HOME[role] || '/login';

export default { ROLE, ALL_ROLES, ROLE_HOME, ROUTE_ROLES, homeForRole };
