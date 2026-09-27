/**
 * Operational account-approval authority (single source of truth for the API).
 *
 * The KALUSAGAP role brief puts account verification with the operational
 * supervisors, not with system administration:
 *
 *   PHN               approves  Health Supervisor, RHU Personnel
 *   Health Supervisor approves  BHW, Resident
 *   System Admin      system administration only — NOT an approval authority
 *   MHO               clinical supervision only — NOT an approval authority
 *
 * This mirrors `public.can_approve_staff_role()` in
 * supabase/migrations/20260928150000_staff_account_verification.sql, which is
 * the layer that re-checks the same rule for a direct PostgREST request made
 * with a user token. Both must stay in step; the SQL definition is the
 * database-level authority, this list is the API-level one.
 */

/**
 * Roles an applicant may request through the personnel registration form.
 *
 * Only roles that HAVE an operational approver are requestable. `phn` and
 * `mho` are intentionally absent: no role may approve them (see
 * `STAFF_APPROVALS` and `public.can_approve_staff_role()`), so allowing them
 * here would create a request that can never be approved. Those two accounts
 * are created through the administrative provisioning path instead —
 * `backend/scripts/provision-official-accounts.mjs` — which sets the profile
 * directly rather than leaving a request in an approval queue nobody owns.
 */
export const REQUESTABLE_ROLES = Object.freeze([
  'bhw',
  'health_supervisor',
  'rhu_personnel',
]);

/** Roles that are assigned to exactly one barangay at registration. */
export const BARANGAY_ASSIGNED_ROLES = Object.freeze(['health_supervisor', 'bhw']);

/** Roles that are assigned to an RHU / health facility at registration. */
export const FACILITY_ASSIGNED_ROLES = Object.freeze(['rhu_personnel']);

/** approver role -> the request roles it may approve. */
export const STAFF_APPROVALS = Object.freeze({
  phn: Object.freeze(['health_supervisor', 'rhu_personnel']),
  health_supervisor: Object.freeze(['bhw', 'resident']),
});

/** Every role that may open an approval queue at all. */
export const APPROVER_ROLES = Object.freeze(Object.keys(STAFF_APPROVALS));

/** May this signed-in user approve an account that requested `targetRole`? */
export const canApproveRole = (userRole, targetRole) => {
  const allowed = STAFF_APPROVALS[userRole];
  if (!allowed) return false;
  return allowed.includes(targetRole);
};

/** The request roles this reviewer sees in their queue. */
export const approvableRolesFor = (userRole) => STAFF_APPROVALS[userRole] || [];

/** Human-readable title of the officer who verifies a given requested role. */
const APPROVER_LABELS = Object.freeze({
  phn: 'Public Health Nurse',
  health_supervisor: 'Health Supervisor',
});

/**
 * The operational officer a pending applicant is waiting on, as display text.
 *
 * Returns null for a role nobody may approve, so callers can fall back to
 * generic copy instead of naming an officer who would never see the request.
 */
export const approverLabelForRole = (targetRole) => {
  for (const [approverRole, allowed] of Object.entries(STAFF_APPROVALS)) {
    if (allowed.includes(targetRole)) return APPROVER_LABELS[approverRole] || approverRole;
  }
  return null;
};

export default {
  REQUESTABLE_ROLES,
  BARANGAY_ASSIGNED_ROLES,
  FACILITY_ASSIGNED_ROLES,
  STAFF_APPROVALS,
  APPROVER_ROLES,
  canApproveRole,
  approvableRolesFor,
  approverLabelForRole,
};
