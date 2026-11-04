/**
 * Historical staff account request review, backed exclusively by Supabase.
 * Public personnel submission is disabled. Request, profile, lifecycle, audit
 * and durable notification changes are committed together by the review RPC.
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
  approvableRolesFor,
  canApproveRole,
} from '../config/staffApprovals.js';
import ApiError from '../utils/apiError.js';
import repository from '../repositories/supabaseRepository.js';
import { getDocumentSignedUrl } from './storage.service.js';

const TABLE = 'staff_account_requests';
const DOCUMENTS_TABLE = 'staff_registration_documents';
const REQUEST_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  RESUBMISSION_REQUIRED: 'resubmission_required',
});

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
  'rhu_stations',
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
  return new ApiError(503, 'The account service is temporarily unavailable. Please try again shortly.');
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
    rhuStations: Array.isArray(row.rhu_stations) ? row.rhu_stations : [],
    status: row.status,
    rejectionReason: row.rejection_reason || '',
    documents: Array.isArray(row.documents) ? row.documents : [],
    decidedBy: row.decided_by_profile?.full_name || row.decided_by_profile?.email || '',
    decidedById: row.decided_by,
    decidedAt: row.decided_at,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.profileStatus !== undefined ? { profileStatus: row.profileStatus, active: row.profileStatus === 'active' } : {}),
  };
};

const requireRequest = async (id) => {
  const supabase = getServiceClient();
  const { data, error } = await supabase.from(TABLE).select(REQUEST_SELECT).eq('id', id).maybeSingle();
  if (error) throw dbError(error, 'request lookup');
  if (!data) throw ApiError.notFound('Account request not found.');
  return data;
};

/**
 * BUG-006: approval authority is not only role-based but scoped.
 *   PHN               -> municipality-wide (own municipality)
 *   Health Supervisor -> their assigned barangay only
 * Scope is derived from the authenticated approver, never a client id, so a
 * Health Supervisor cannot approve/reject a request from another barangay and a
 * PHN cannot act outside their municipality.
 */
const inApproverScope = (user, row) => {
  if (!user || !row) return false;
  if (user.role === 'phn') return Boolean(user.municipalityId) && row.municipality_id === user.municipalityId;
  if (user.role === 'health_supervisor') return Boolean(user.barangayId && user.municipalityId)
    && row.barangay_id === user.barangayId && row.municipality_id === user.municipalityId;
  return false;
};

/** Apply the approver's municipality/barangay scope to a queue/count query. */
const applyApproverScope = (query, user) => {
  if (user.role === 'phn') return query.eq('municipality_id', user.municipalityId || '__none__');
  if (user.role === 'health_supervisor') return query.eq('barangay_id', user.barangayId || '__none__')
    .eq('municipality_id', user.municipalityId || '__none__');
  return query;
};

/** Out-of-authority requests read as "not found" so the API never reveals them. */
const requireApprovable = async (user, id) => {
  const row = await requireRequest(id);
  if (!canApproveRole(user?.role, row.role) || !inApproverScope(user, row)) {
    throw ApiError.notFound('Account request not found.');
  }
  return row;
};

// Keep the exported entry point denied as well as the route: internal callers
// cannot accidentally resurrect the former public Auth provisioning flow.
export const submitRequest = async () => {
  throw ApiError.forbidden('Public health personnel registration is disabled. Contact a system administrator.');
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
  query = applyApproverScope(query, user); // BUG-006: municipality/barangay scope

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

export const getRequest = async ({ user, id }) => {
  const row = await requireApprovable(user, id);
  const request = toRequest(row);
  request.verificationDocuments = await loadRequestDocuments(id);
  return request;
};

/**
 * Load the uploaded verification documents for a request and attach a fresh,
 * short-lived signed URL for each. Only ever called for a request the caller is
 * authorized to approve (see requireApprovable). No public URL is exposed.
 */
const loadRequestDocuments = async (requestId) => {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('id, document_type, storage_path, original_filename, mime_type, file_size, review_status, uploaded_at')
    .eq('request_id', requestId)
    .order('uploaded_at', { ascending: true });
  if (error) throw dbError(error, 'document lookup');
  const rows = data || [];
  return Promise.all(
    rows.map(async (d) => {
      const url = await getDocumentSignedUrl(d.storage_path);
      return {
        id: d.id,
        documentType: d.document_type,
        originalFilename: d.original_filename || '',
        mimeType: d.mime_type || '',
        fileSize: d.file_size || 0,
        reviewStatus: d.review_status || 'pending_manual_review',
        uploadedAt: d.uploaded_at,
        url,
      };
    }),
  );
};

/** Pending count for the reviewer's own roles — drives the nav badge. */
export const pendingCount = async ({ user } = {}) => {
  assertApprover(user);
  const supabase = getServiceClient();
  const { count, error } = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .in('role', approvableRolesFor(user.role))
    .eq('status', REQUEST_STATUS.PENDING)
    .match(
      user.role === 'phn'
        ? { municipality_id: user.municipalityId || '__none__' }
        : user.role === 'health_supervisor'
          ? { barangay_id: user.barangayId || '__none__', municipality_id: user.municipalityId || '__none__' }
          : {},
    );
  if (error) throw dbError(error, 'pending count');
  return { count: count || 0 };
};

const decideRequest = async ({ user, id, decision, reason = '', remarks = '' }) => {
  assertApprover(user);
  const row = await requireApprovable(user, id);
  if (row.auth_user_id === user.id) throw ApiError.forbidden('You cannot review your own account request.');
  const explanation = String(reason || '').trim();
  if (decision !== REQUEST_STATUS.APPROVED && !explanation) {
    throw ApiError.badRequest('A reason is required for this decision.');
  }
  const note = String(remarks || '').trim();
  const stored = [explanation, note].filter(Boolean).join(' - ');
  if (stored.length > 1000) throw ApiError.badRequest('The decision reason must not exceed 1000 characters.');
  const updated = await repository.reviewPersonnelAccountRequest({
    requestId: id,
    actorId: user.id,
    decision,
    reason: stored,
  });
  if (!updated) throw ApiError.conflict('This account request could not be reviewed. Refresh the queue and try again.');
  return toRequest({
    ...row,
    ...updated,
    decided_by_profile: updated.decided_by === user.id
      ? { full_name: user.name, email: user.email, role: user.role }
      : row.decided_by_profile,
  });
};

export const approve = (input = {}) => decideRequest({ ...input, decision: REQUEST_STATUS.APPROVED });
export const reject = (input = {}) => decideRequest({ ...input, decision: REQUEST_STATUS.REJECTED });
export const requestResubmission = (input = {}) => decideRequest({ ...input, decision: REQUEST_STATUS.RESUBMISSION_REQUIRED });

/** Internal read for the admin-only account history endpoint. */
export const getAccountRequestHistory = async ({ accountId }) => {
  const { data, error } = await getServiceClient().from(TABLE).select(REQUEST_SELECT)
    .eq('auth_user_id', accountId).order('submitted_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw dbError(error, 'account request history');
  if (!data) return null;
  return { ...toRequest(data), verificationDocuments: await loadRequestDocuments(data.id) };
};

export default {
  REQUEST_STATUS,
  submitRequest,
  listQueue,
  getRequest,
  pendingCount,
  approve,
  reject,
  requestResubmission,
};
