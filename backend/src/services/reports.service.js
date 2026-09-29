/**
 * Reports service — role-routed report submission (real, persisted).
 *
 * Backs public.reports (see
 * supabase/migrations/20260928160000_reports_submission.sql) and replaces the
 * browser-only report state that never reached a recipient.
 *
 * Delivery model (recipient is a ROLE within the sender's scope, never a
 * hard-coded PHN):
 *   PHN                -> MHO            (municipality-wide)
 *   Health Supervisor  -> RHU Personnel  (municipality RHU)
 *   RHU Personnel      -> MHO            (municipality-wide)
 *
 * SECURITY MODEL (defense in depth, mirroring referrals/medicalCertificates):
 *   - the sender is always the authenticated user; created_by is never trusted
 *     from the body,
 *   - the recipient_role is validated against the sender's allowed routes,
 *   - municipality/barangay scope is taken from the session, not the body,
 *   - reads are filtered to the caller's own reports (outgoing) or the reports
 *     routed to their role + scope (incoming),
 *   - Supabase RLS enforces the same boundary independently.
 *
 * `supabase` is injectable so the unit tests can drive it without a live
 * database.
 */
import { getServiceClient } from '../config/supabase.js';
import { ROLES } from '../config/roles.js';
import ApiError from '../utils/apiError.js';
import { notifyResident } from './notifications.service.js';

const TABLE = 'reports';

export const REPORT_STATUS = Object.freeze({
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  RECEIVED: 'Received',
  REVIEWED: 'Reviewed',
  REJECTED: 'Rejected',
});

export const REPORT_STATUSES = Object.freeze(Object.values(REPORT_STATUS));

/** Recipient roles a given sender role is allowed to route a report to. */
export const REPORT_ROUTES = Object.freeze({
  [ROLES.PHN]: [ROLES.MHO],
  [ROLES.HEALTH_SUPERVISOR]: [ROLES.RHU_PERSONNEL],
  [ROLES.RHU_PERSONNEL]: [ROLES.MHO],
  [ROLES.MHO]: [ROLES.MHO],
});

/** Statuses a recipient may set when acting on a received report. */
const RECIPIENT_DECISIONS = new Set([REPORT_STATUS.RECEIVED, REPORT_STATUS.REVIEWED, REPORT_STATUS.REJECTED]);

const text = (v) => String(v ?? '').trim();
const throwOnError = (error, fallback) => {
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
};

/** The recipient role for a sender, validating any explicit request. */
export const resolveRecipientRole = (senderRole, requested) => {
  const allowed = REPORT_ROUTES[senderRole];
  if (!allowed || allowed.length === 0) {
    throw ApiError.forbidden('Your role is not authorized to submit reports.');
  }
  const want = text(requested);
  if (!want) return allowed[0];
  if (!allowed.includes(want)) {
    throw ApiError.unprocessable(`Reports from your role cannot be routed to "${want}".`);
  }
  return want;
};

/** Row -> the report shape the UI consumes. */
const toReport = (row) => {
  if (!row) return null;
  const sender = row.sender || null;
  const reviewer = row.reviewer || null;
  return {
    id: row.id,
    reportType: row.report_type || '',
    reportPeriod: row.report_period || '',
    title: row.title || '',
    createdBy: row.created_by,
    senderName: sender?.full_name || sender?.email || '',
    senderRole: row.sender_role || '',
    recipientRole: row.recipient_role || '',
    municipalityId: row.municipality_id || null,
    barangayId: row.barangay_id || null,
    barangay: row.barangay?.name || '',
    status: row.status,
    remarks: row.remarks || '',
    submittedAt: row.submitted_at || '',
    reviewedAt: row.reviewed_at || '',
    reviewedByName: reviewer?.full_name || reviewer?.email || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const SENDER_EMBED = 'sender:profiles!created_by(full_name, email, role)';
const REVIEWER_EMBED = 'reviewer:profiles!reviewed_by(full_name, email, role)';
const BARANGAY_EMBED = 'barangay:barangays(name)';
const SELECT = `*, ${SENDER_EMBED}, ${REVIEWER_EMBED}, ${BARANGAY_EMBED}`;

const assertStaff = (user) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');
  if (!REPORT_ROUTES[user.role]) {
    throw ApiError.forbidden('Your role is not authorized to use reports.');
  }
};

/**
 * Reports for the caller.
 *   box = 'incoming' -> reports routed TO the caller's role within their scope
 *   box = 'outgoing' -> reports the caller submitted
 */
export const list = async ({ user, box = 'incoming', status = null, supabase = getServiceClient() }) => {
  assertStaff(user);
  let query = supabase.from(TABLE).select(SELECT).order('created_at', { ascending: false }).limit(200);

  if (box === 'outgoing') {
    query = query.eq('created_by', user.id);
  } else {
    // Incoming: routed to the caller's role within their municipality (and
    // barangay when the caller is barangay-scoped).
    query = query.eq('recipient_role', user.role);
    if (!user.municipalityId) return [];
    query = query.eq('municipality_id', user.municipalityId);
    if (user.role === ROLES.HEALTH_SUPERVISOR) {
      if (!user.barangayId) return [];
      query = query.eq('barangay_id', user.barangayId);
    }
    // A submitted report is delivered; drafts never leave the sender.
    query = query.neq('status', REPORT_STATUS.DRAFT);
  }

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  throwOnError(error, 'Could not load reports');
  return (data || []).map(toReport);
};

/** Whether the caller may see a specific report (sender or in-scope recipient). */
const inScope = (user, row) => {
  if (!row) return false;
  if (row.created_by === user.id) return true;
  if (row.recipient_role !== user.role) return false;
  if (user.municipalityId && row.municipality_id && row.municipality_id !== user.municipalityId) return false;
  if (user.role === ROLES.HEALTH_SUPERVISOR && row.barangay_id && row.barangay_id !== user.barangayId) return false;
  return true;
};

export const getById = async ({ user, id, supabase = getServiceClient() }) => {
  assertStaff(user);
  const { data, error } = await supabase.from(TABLE).select(SELECT).eq('id', id).maybeSingle();
  throwOnError(error, 'Could not load report');
  if (!data || !inScope(user, data)) throw ApiError.notFound('Report not found.');
  return toReport(data);
};

/** Recipient auth-user ids for a routed report, for notification. */
const recipientAuthUserIds = async (supabase, { recipientRole, municipalityId, barangayId }) => {
  let query = supabase.from('profiles').select('id').eq('role', recipientRole).eq('status', 'active');
  if (municipalityId) query = query.eq('municipality_id', municipalityId);
  if (recipientRole === ROLES.HEALTH_SUPERVISOR && barangayId) query = query.eq('barangay_id', barangayId);
  const { data, error } = await query;
  if (error) return [];
  return (data || []).map((p) => p.id).filter(Boolean);
};

export const create = async ({ user, payload = {}, supabase = getServiceClient() }) => {
  assertStaff(user);
  const reportType = text(payload.reportType || payload.report_type);
  if (!reportType) throw ApiError.unprocessable('A report type is required.');
  if (!user.municipalityId) throw ApiError.unprocessable('Your account has no municipality assignment.');

  const recipientRole = resolveRecipientRole(user.role, payload.recipientRole || payload.recipient_role);

  const asDraft = text(payload.status) === REPORT_STATUS.DRAFT;
  const row = {
    report_type: reportType,
    report_period: text(payload.reportPeriod || payload.report_period),
    title: text(payload.title),
    created_by: user.id,
    sender_role: user.role,
    recipient_role: recipientRole,
    municipality_id: user.municipalityId,
    barangay_id: user.role === ROLES.HEALTH_SUPERVISOR ? user.barangayId || null : null,
    status: asDraft ? REPORT_STATUS.DRAFT : REPORT_STATUS.SUBMITTED,
    remarks: text(payload.remarks),
    submitted_at: asDraft ? null : new Date().toISOString(),
  };

  const { data, error } = await supabase.from(TABLE).insert(row).select(SELECT).single();
  throwOnError(error, 'Could not submit report');

  // Notify the routed recipients (per authenticated recipient account). Skipped
  // for drafts, and best-effort — a notification failure never fails the submit.
  if (!asDraft) {
    const recipients = await recipientAuthUserIds(supabase, {
      recipientRole,
      municipalityId: row.municipality_id,
      barangayId: row.barangay_id,
    });
    const senderName = data.sender?.full_name || data.sender?.email || 'A health worker';
    await Promise.all(
      recipients.map((recipientId) =>
        notifyResident({
          recipientAuthUserId: recipientId,
          category: 'information',
          title: 'New report submitted',
          message: `${senderName} submitted a ${reportType}${row.report_period ? ` for ${row.report_period}` : ''}.`,
          relatedType: TABLE,
          relatedId: data.id,
        }),
      ),
    );
  }

  return toReport(data);
};

/**
 * Recipient acts on a report (Received / Reviewed / Rejected). Only the routed
 * recipient within scope may do this; the sender cannot review their own.
 */
export const review = async ({ user, id, status, remarks = '', supabase = getServiceClient() }) => {
  assertStaff(user);
  const target = text(status);
  if (!RECIPIENT_DECISIONS.has(target)) {
    throw ApiError.unprocessable('Invalid report review status.');
  }
  const { data: existing, error: readError } = await supabase.from(TABLE).select(SELECT).eq('id', id).maybeSingle();
  throwOnError(readError, 'Could not load report');
  if (!existing) throw ApiError.notFound('Report not found.');

  // Only the routed recipient (not the sender) may review.
  const isRecipient =
    existing.recipient_role === user.role &&
    (!user.municipalityId || existing.municipality_id === user.municipalityId) &&
    (user.role !== ROLES.HEALTH_SUPERVISOR || existing.barangay_id === user.barangayId);
  if (!isRecipient) throw ApiError.forbidden('Only the report recipient may review this report.');
  if (existing.status === REPORT_STATUS.DRAFT) throw ApiError.conflict('This report has not been submitted yet.');
  if (target === REPORT_STATUS.REJECTED && !text(remarks)) {
    throw ApiError.unprocessable('A reason is required to reject a report.');
  }

  const row = {
    status: target,
    remarks: text(remarks) || existing.remarks || '',
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from(TABLE).update(row).eq('id', id).select(SELECT).single();
  throwOnError(error, 'Could not update report');

  // Notify the sender that their report advanced.
  await notifyResident({
    recipientAuthUserId: existing.created_by,
    category: target === REPORT_STATUS.REJECTED ? 'alert' : 'information',
    title: `Report ${target.toLowerCase()}`,
    message: `Your ${existing.report_type} was marked ${target.toLowerCase()}.`,
    relatedType: TABLE,
    relatedId: id,
  });

  return toReport(data);
};

export const meta = () => ({
  statuses: REPORT_STATUSES,
  routes: REPORT_ROUTES,
});

export default { REPORT_STATUS, REPORT_STATUSES, REPORT_ROUTES, resolveRecipientRole, list, getById, create, review, meta };
