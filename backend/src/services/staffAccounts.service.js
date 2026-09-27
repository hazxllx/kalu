/**
 * Staff account registration + verification.
 *
 * Replaces the browser-only `staffRequestStore` / `supervisorVerificationStore`
 * with the real workflow backed by `staff_account_requests`, Supabase Auth and
 * `profiles`:
 *
 *   1. submit   POST /api/staff-accounts/register
 *                 -> creates the Supabase Auth identity, sets the profile role +
 *                    assignment, and records a 'pending' request.
 *                    The account is served as pending_verification, so
 *                    `loadActiveProfile` refuses it with 403 until approved —
 *                    nothing is bypassed.
 *   2. approve  POST /api/staff-accounts/:id/approve   (PHN / Health Supervisor)
 *                 -> profiles.status = 'active'; the applicant can sign in and
 *                    use the system for their role.
 *   3. reject   POST /api/staff-accounts/:id/reject    (PHN / Health Supervisor)
 *                 -> request 'rejected' with a required reason; the profile is
 *                    kept at pending_verification, so sign-in stays refused.
 *
 * Authority is enforced here AND in the database (see config/staffApprovals.js
 * and public.can_approve_staff_role()). System Admin and MHO are not
 * approvers; they can still administer accounts through /api/users.
 *
 * Every decision is written to `health_audit_logs` by a database trigger, so
 * the Audit Trail shows real activity rather than browser-local events.
 */
import { getServiceClient } from '../config/supabase.js';
import {
  BARANGAY_ASSIGNED_ROLES,
  FACILITY_ASSIGNED_ROLES,
  REQUESTABLE_ROLES,
  approvableRolesFor,
  canApproveRole,
} from '../config/staffApprovals.js';
import ApiError from '../utils/apiError.js';
import { notifyResident } from './notifications.service.js';

const TABLE = 'staff_account_requests';
const REQUEST_STATUS = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' });

const REQUEST_SELECT = [
  'id',
  'auth_user_id',
  'email',
  'full_name',
  'phone',
  'position',
  'license_no',
  'license_expiry',
  'role',
  'municipality_id',
  'barangay_id',
  'facility_id',
  'status',
  'rejection_reason',
  'documents',
  'decided_by',
  'decided_at',
  'submitted_at',
  'created_at',
  'updated_at',
  'barangay:barangays(name)',
  'municipality:municipalities(name)',
  'facility:facilities(name)',
  'decided_by_profile:profiles!decided_by(full_name, email, role)',
].join(',');

const dbError = (err, context) => {
  console.error(`staffAccounts: ${context} failed: ${err?.message}`);
  return ApiError(503, 'The account service is temporarily unavailable. Please try again shortly.');
};

const assertApprover = (user) => {
  if (approvableRolesFor(user?.role).length === 0) {
    throw ApiError.forbidden(
      'Your role is not an account approval authority. Health personnel accounts are approved by the PHN (Health Supervisor, RHU Personnel) and by the Health Supervisor (BHW, Resident).',
    );
  }
};

/** Request row -> the shape the queue table renders. */
const toRequest = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    position: row.position,
    licenseNo: row.license_no,
    licenseExpiry: row.license_expiry,
    role: row.role,
    municipality: row.municipality?.name || '',
    municipalityId: row.municipality_id,
    barangay: row.barangay?.name || '',
    barangayId: row.barangay_id,
    facility: row.facility?.name || '',
    facilityId: row.facility_id,
    status: row.status,
    rejectionReason: row.rejection_reason || '',
    documents: Array.isArray(row.documents) ? row.documents : [],
    decidedBy: row.decided_by_profile?.full_name || row.decided_by_profile?.email || '',
    decidedById: row.decided_by,
    decidedAt: row.decided_at,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const requireRequest = async (id) => {
  const supabase = getServiceClient();
  const { data, error } = await supabase.from(TABLE).select(REQUEST_SELECT).eq('id', id).maybeSingle();
  if (error) throw dbError(error, 'request lookup');
  if (!data) throw ApiError.notFound('Account request not found.');
  return data;
};

/** Out-of-authority requests read as "not found" so the API never reveals them. */
const requireApprovable = async (user, id) => {
  const row = await requireRequest(id);
  if (!canApproveRole(user?.role, row.role)) {
    throw ApiError.notFound('Account request not found.');
  }
  return row;
};

const emailTaken = async (email) => {
  const supabase = getServiceClient();
  const { data, error } = await supabase.from(TABLE).select('id, status').ilike('email', email).limit(1);
  if (error) throw dbError(error, 'email availability check');
  return Array.isArray(data) && data.some((r) => r.status !== REQUEST_STATUS.REJECTED);
};

/**
 * Submit a personnel registration.
 *
 * Creates the Supabase Auth identity the applicant will sign in with, points
 * its `profiles` row at the requested role + assignment while leaving
 * `status = 'pending_verification'`, and records the verification request.
 * If anything after the auth user is created fails, the auth user is removed
 * again so a half-registered identity is never left behind.
 */
export const submitRequest = async (input = {}) => {
  assertRoleIsRequestable(input.role);

  const email = String(input.email || '').trim().toLowerCase();
  if (await emailTaken(email)) {
    throw ApiError.conflict('An account request for this email already exists. Contact your approving officer if it needs to be reviewed again.');
  }

  const assignment = await resolveAssignment(input);

  const supabase = getServiceClient();
  const { data: created, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName, requested_role: input.role },
  });

  if (authError) {
    if (/already been registered|already exists/i.test(authError.message || '')) {
      throw ApiError.conflict('An account with this email already exists.');
    }
    throw dbError(authError, 'auth user creation');
  }

  const authUserId = created?.user?.id;
  if (!authUserId) throw ApiError(503, 'The account could not be created. Please try again.');

  try {
    // handle_new_user() has already inserted the profile at the default role and
    // pending_verification status; set the real role + assignment now. The
    // status stays 'pending_verification', which is what keeps the account out
    // of the protected system until an approver activates it.
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        email,
        full_name: input.fullName,
        role: input.role,
        status: 'pending_verification',
        municipality_id: assignment.municipalityId,
        barangay_id: assignment.barangayId,
        facility_id: assignment.facilityId,
        position: input.position || '',
        license_no: input.licenseNo || '',
        contact: input.phone || '',
      })
      .eq('id', authUserId);

    if (profileError) throw dbError(profileError, 'profile provisioning');

    const { data: request, error: insertError } = await supabase
      .from(TABLE)
      .insert({
        auth_user_id: authUserId,
        email,
        full_name: input.fullName,
        phone: input.phone || '',
        position: input.position || '',
        license_no: input.licenseNo || '',
        license_expiry: input.licenseExpiry || null,
        role: input.role,
        municipality_id: assignment.municipalityId,
        barangay_id: assignment.barangayId,
        facility_id: assignment.facilityId,
        status: REQUEST_STATUS.PENDING,
        documents: Array.isArray(input.documents) ? input.documents : [],
      })
      .select(REQUEST_SELECT)
      .single();

    if (insertError) throw dbError(insertError, 'request insert');

    return toRequest(request);
  } catch (err) {
    // Roll the identity back so the email is free again.
    try {
      await supabase.auth.admin.deleteUser(authUserId);
    } catch (cleanupError) {
      console.error(`staffAccounts: could not roll back auth user ${authUserId}: ${cleanupError?.message}`);
    }
    throw err;
  }
};

const assertRoleIsRequestable = (role) => {
  if (!REQUESTABLE_ROLES.includes(role)) {
    throw ApiError.badRequest(`"${role}" is not an operational health personnel role.`);
  }
};

/**
 * Validate the requested assignment. Barangay-scoped roles must name a
 * barangay; facility-scoped roles must name a facility. The municipality is
 * derived from whichever of the two is present, never accepted raw.
 *
 * The assignment may be given as a uuid or as the canonical name the
 * registration form knows (e.g. "San Isidro", "RHU"); names are resolved
 * case-insensitively against the reference tables and must exist, so a name
 * can never invent an assignment.
 */
const resolveAssignment = async (input) => {
  const supabase = getServiceClient();

  const barangayId = input.barangayId || (await lookupByName('barangays', input.barangay, 'barangay'));
  const facilityId = input.facilityId || (await lookupByName('facilities', input.facility, 'facility'));

  if (BARANGAY_ASSIGNED_ROLES.includes(input.role) && !barangayId) {
    throw ApiError.badRequest('A barangay assignment is required for this role.');
  }
  if (FACILITY_ASSIGNED_ROLES.includes(input.role) && !facilityId) {
    throw ApiError.badRequest('A facility assignment is required for RHU Personnel.');
  }

  let municipalityId = input.municipalityId || null;

  if (barangayId) {
    const { data: brgy, error } = await supabase
      .from('barangays')
      .select('id, municipality_id')
      .eq('id', barangayId)
      .maybeSingle();
    if (error) throw dbError(error, 'barangay lookup');
    if (!brgy) throw ApiError.badRequest('The selected barangay does not exist.');
    municipalityId = brgy.municipality_id;
  }

  if (facilityId) {
    const { data: facility, error } = await supabase
      .from('facilities')
      .select('id, municipality_id')
      .eq('id', facilityId)
      .maybeSingle();
    if (error) throw dbError(error, 'facility lookup');
    if (!facility) throw ApiError.badRequest('The selected facility does not exist.');
    municipalityId = municipalityId || facility.municipality_id;
  }

  if (!municipalityId) {
    throw ApiError.badRequest('A municipality could not be resolved for this registration.');
  }

  return {
    municipalityId,
    barangayId: barangayId || null,
    facilityId: facilityId || null,
  };
};

/**
 * Resolve a canonical reference-table name to its uuid.
 * Returns null for a blank name; throws when the name does not exist so a
 * typo is reported instead of silently creating a scopeless account.
 */
const lookupByName = async (table, name, label) => {
  const value = String(name || '').trim();
  if (!value) return null;

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .ilike('name', value)
    .limit(1)
    .maybeSingle();

  if (error) throw dbError(error, `${label} name lookup`);
  if (!data) throw ApiError.badRequest(`The selected ${label} "${value}" does not exist.`);
  return data.id;
};

/** The reviewer's queue, restricted to the roles they are responsible for. */
export const listQueue = async ({ user, status = 'pending', q = '', limit = 100, offset = 0 } = {}) => {
  assertApprover(user);
  const roles = approvableRolesFor(user.role);

  const requested = String(status || 'pending').trim().toLowerCase();
  if (requested !== 'all' && !Object.values(REQUEST_STATUS).includes(requested)) {
    throw ApiError.badRequest('Unknown account request status filter.');
  }

  const supabase = getServiceClient();
  let query = supabase.from(TABLE).select(REQUEST_SELECT, { count: 'exact' }).in('role', roles);

  if (requested !== 'all') query = query.eq('status', requested);

  const term = String(q || '').trim();
  if (term) {
    // The escaped, lower-cased term is matched case-insensitively on both sides
    // so an exact-capitalization query still matches (PostgREST ilike).
    const safe = term.replace(/[,()*%]/g, ' ');
    query = query.or(
      `full_name.ilike.%${safe}%,email.ilike.%${safe}%,license_no.ilike.%${safe}%,position.ilike.%${safe}%`,
    );
  }

  const { data, error, count } = await query
    .order('submitted_at', { ascending: false })
    .range(Math.max(Number(offset) || 0, 0), Math.max(Number(offset) || 0, 0) + Math.min(Math.max(Number(limit) || 100, 1), 200) - 1);

  if (error) throw dbError(error, 'queue list');

  return { rows: (data || []).map(toRequest), total: count ?? (data || []).length, status: requested };
};

export const getRequest = async ({ user, id }) => toRequest(await requireApprovable(user, id));

/** Pending count for the reviewer's own roles — drives the nav badge. */
export const pendingCount = async ({ user } = {}) => {
  assertApprover(user);
  const supabase = getServiceClient();
  const { count, error } = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .in('role', approvableRolesFor(user.role))
    .eq('status', REQUEST_STATUS.PENDING);
  if (error) throw dbError(error, 'pending count');
  return { count: count || 0 };
};

/**
 * Approve a pending request: activate the profile so the applicant can sign in
 * and use the system for their role. Idempotent-safe — an already-decided
 * request is a conflict, never a silent overwrite.
 */
export const approve = async ({ user, id, remarks = '' } = {}) => {
  const row = await requireApprovable(user, id);

  if (row.status === REQUEST_STATUS.APPROVED) {
    throw ApiError.conflict('This account request has already been approved.');
  }
  if (row.status === REQUEST_STATUS.REJECTED) {
    throw ApiError.conflict('This account request was rejected. The applicant must submit a new request.');
  }

  const supabase = getServiceClient();
  const decidedAt = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from(TABLE)
    .update({
      status: REQUEST_STATUS.APPROVED,
      rejection_reason: '',
      decided_by: user.id,
      decided_at: decidedAt,
    })
    .eq('id', id)
    .eq('status', REQUEST_STATUS.PENDING)
    .select(REQUEST_SELECT)
    .maybeSingle();

  if (error) throw dbError(error, 'approve request');
  if (!updated) throw ApiError.conflict('This account request was already decided by someone else.');

  // Activate the account. This is the single change that makes sign-in work:
  // `loadActiveProfile` refuses a staff profile at pending_verification.
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      status: 'active',
      role: updated.role,
      municipality_id: updated.municipality_id,
      barangay_id: updated.barangay_id,
      facility_id: updated.facility_id,
    })
    .eq('id', updated.auth_user_id);

  if (profileError) {
    // The decision is recorded; surface the activation failure instead of
    // leaving the applicant with an approved request and a locked account.
    throw ApiError(503, 'The request was approved but the account could not be activated. Please contact a system administrator.');
  }

  await notifyResident({
    recipientAuthUserId: updated.auth_user_id,
    category: 'information',
    title: 'Account approved',
    message: `Your ${String(updated.role).replace(/_/g, ' ')} account has been approved. You can now sign in and use the system.${
      remarks ? ` Remarks: ${remarks}` : ''
    }`,
    relatedType: 'staff_account_request',
    relatedId: updated.id,
  });

  return toRequest(updated);
};

/** Reject a pending request. A reason is required and stored on the request. */
export const reject = async ({ user, id, reason, remarks = '' } = {}) => {
  const row = await requireApprovable(user, id);

  if (row.status === REQUEST_STATUS.APPROVED) {
    throw ApiError.conflict('This account request has already been approved.');
  }
  if (row.status === REQUEST_STATUS.REJECTED) {
    throw ApiError.conflict('This account request was already rejected.');
  }

  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) throw ApiError.badRequest('A rejection reason is required.');
  const trimmedRemarks = String(remarks || '').trim();
  const stored = trimmedRemarks ? `${trimmedReason} — ${trimmedRemarks}` : trimmedReason;

  const supabase = getServiceClient();
  const { data: updated, error } = await supabase
    .from(TABLE)
    .update({
      status: REQUEST_STATUS.REJECTED,
      rejection_reason: stored,
      decided_by: user.id,
      decided_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', REQUEST_STATUS.PENDING)
    .select(REQUEST_SELECT)
    .maybeSingle();

  if (error) throw dbError(error, 'reject request');
  if (!updated) throw ApiError.conflict('This account request was already decided by someone else.');

  // A rejected account must not be able to reach the protected system. The
  // profile stays at pending_verification (served as 403) and is marked
  // disabled so the state is unambiguous in User Management as well.
  await supabase.from('profiles').update({ status: 'disabled' }).eq('id', updated.auth_user_id);

  await notifyResident({
    recipientAuthUserId: updated.auth_user_id,
    category: 'alert',
    title: 'Account request rejected',
    message: `Your account request was rejected. Reason: ${stored}`,
    relatedType: 'staff_account_request',
    relatedId: updated.id,
  });

  return toRequest(updated);
};

export default {
  REQUEST_STATUS,
  submitRequest,
  listQueue,
  getRequest,
  pendingCount,
  approve,
  reject,
};
