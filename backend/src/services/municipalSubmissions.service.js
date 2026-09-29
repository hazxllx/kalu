/**
 * MHO municipal submission review service (BUG-010).
 *
 * Persists MHO review decisions on barangay TCL/M1 submissions in PostgreSQL
 * (public.municipal_submission_reviews) instead of sessionStorage, so the
 * decision, reviewer, timestamps and notes survive refresh/logout/device.
 *
 * Authorization: only the MHO (or admin) may record a decision, and the
 * municipality is bound to the reviewer's authenticated profile — never taken
 * from the client. RLS enforces the same rules at the database.
 */
import ApiError from '../utils/apiError.js';
import { getServiceClient } from '../config/supabase.js';
import { ROLES } from '../config/roles.js';

const TABLE = 'municipal_submission_reviews';

const DECISION_MAP = {
  reviewed: { status: 'Reviewed', reviewStatus: 'Reviewed', action: 'Reviewed' },
  returned: { status: 'Returned', reviewStatus: 'Returned', action: 'Returned' },
  'needs-correction': { status: 'Needs Correction', reviewStatus: 'Needs Correction', action: 'Correction Requested' },
  'under-review': { status: 'Under Review', reviewStatus: 'Pending Review', action: 'Under Review' },
};

const throwOnError = (error, message) => {
  if (error) throw Object.assign(new Error(error.message || message), { statusCode: 500, details: error });
};

const shape = (row) => ({
  id: row.id,
  submissionRef: row.submission_ref,
  submissionType: row.submission_type,
  period: row.period,
  status: row.status,
  reviewStatus: row.review_status,
  reviewedBy: row.reviewed_by,
  reviewedAt: row.reviewed_at,
  reviewNotes: row.review_notes,
  audit: row.audit || [],
  updatedAt: row.updated_at,
});

/** List the persisted review decisions for the caller's municipality. */
export const listReviews = async ({ user, supabase = getServiceClient() }) => {
  if (!user?.municipalityId) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('municipality_id', user.municipalityId)
    .order('updated_at', { ascending: false });
  throwOnError(error, 'Could not load submission reviews');
  return (data || []).map(shape);
};

/**
 * Record (upsert) an MHO review decision for a submission. municipality is
 * bound from the authenticated MHO profile; a client-supplied municipality is
 * ignored.
 */
export const reviewSubmission = async ({ user, submissionRef, submissionType = '', period = '', barangayId = null, decision, notes = '', supabase = getServiceClient() }) => {
  if (user?.role !== ROLES.MHO && user?.role !== ROLES.ADMIN) {
    throw ApiError.forbidden('Only the Municipal Health Officer may review municipal submissions.');
  }
  if (!user?.municipalityId) throw ApiError.forbidden('Your account has no municipality assignment.');
  if (!submissionRef) throw ApiError.badRequest('A submission reference is required.');
  const mapped = DECISION_MAP[decision];
  if (!mapped) throw ApiError.badRequest(`Unknown review decision: ${decision}`);

  const now = new Date().toISOString();

  // Load any existing review so we can append to its audit trail.
  const { data: existing, error: readError } = await supabase
    .from(TABLE)
    .select('*')
    .eq('municipality_id', user.municipalityId)
    .eq('submission_ref', submissionRef)
    .maybeSingle();
  throwOnError(readError, 'Could not load the existing review');

  const auditEntry = { action: mapped.action, by: user.name || user.email || 'MHO', at: now, notes: notes || '' };
  const audit = [...((existing && existing.audit) || []), auditEntry];

  const row = {
    ...(existing?.id ? { id: existing.id } : {}),
    submission_ref: submissionRef,
    submission_type: submissionType || existing?.submission_type || '',
    period: period || existing?.period || '',
    municipality_id: user.municipalityId, // bound from the session, never the client
    barangay_id: barangayId ?? existing?.barangay_id ?? null,
    status: mapped.status,
    review_status: mapped.reviewStatus,
    reviewed_by: user.id,
    reviewed_at: now,
    review_notes: notes ?? '',
    audit,
    created_by: existing?.created_by || user.id,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'municipality_id,submission_ref' })
    .select('*')
    .single();
  throwOnError(error, 'Could not save the submission review');
  return shape(data);
};

export default { listReviews, reviewSubmission };
