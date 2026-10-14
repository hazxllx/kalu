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
 *   Health Supervisor  -> RHU Personnel  (municipality RHU; PHN/MHO oversight)
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
const HISTORY_TABLE = 'report_status_history';

export const REPORT_STATUS = Object.freeze({
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  RECEIVED: 'Received',
  REVIEWED: 'Reviewed',
  NEEDS_REVISION: 'Needs Revision',
  REJECTED: 'Rejected',
});

export const REPORT_STATUSES = Object.freeze(Object.values(REPORT_STATUS));

/** Recipient actions follow an explicit, monotonic workflow. */
export const REPORT_TRANSITIONS = Object.freeze({
  [REPORT_STATUS.SUBMITTED]: [REPORT_STATUS.RECEIVED],
  [REPORT_STATUS.RECEIVED]: [REPORT_STATUS.REVIEWED, REPORT_STATUS.NEEDS_REVISION, REPORT_STATUS.REJECTED],
  [REPORT_STATUS.NEEDS_REVISION]: [],
  [REPORT_STATUS.DRAFT]: [],
  [REPORT_STATUS.REVIEWED]: [],
  [REPORT_STATUS.REJECTED]: [],
});

/**
 * Current report-content snapshot schema version. The frontend stamps the same
 * version into the snapshot it builds (see
 * frontend/src/features/reports/lib/reportSnapshot.js); bump both together when
 * the snapshot shape changes so old snapshots stay identifiable.
 */
export const REPORT_CONTENT_SCHEMA_VERSION = 1;

/** Max serialized size (bytes) of a submitted content snapshot. */
export const REPORT_CONTENT_MAX_BYTES = 1_000_000;

/** A plain JSON object (snapshot) — not an array, scalar, or null. */
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Recipient roles a given sender role is allowed to route a report to. */
export const REPORT_ROUTES = Object.freeze({
  [ROLES.PHN]: [ROLES.MHO],
  [ROLES.HEALTH_SUPERVISOR]: [ROLES.RHU_PERSONNEL],
  [ROLES.MHO]: [ROLES.MHO],
});

export const REPORT_RECIPIENT_ROLES = Object.freeze([
  ROLES.RHU_PERSONNEL,
  ROLES.PHN,
  ROLES.MHO,
]);

/** Statuses a recipient may set when acting on a received report. */
const RECIPIENT_DECISIONS = new Set([
  REPORT_STATUS.RECEIVED,
  REPORT_STATUS.REVIEWED,
  REPORT_STATUS.NEEDS_REVISION,
  REPORT_STATUS.REJECTED,
]);

const text = (v) => String(v ?? '').trim();
const throwOnError = (error, fallback) => {
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
};

export const assertNoDuplicateSubmission = async (supabase, row) => {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id')
    .eq('created_by', row.created_by)
    .eq('report_type', row.report_type)
    .eq('report_period', row.report_period)
    .eq('recipient_role', row.recipient_role)
    .neq('status', REPORT_STATUS.DRAFT)
    .maybeSingle();
  throwOnError(error, 'Could not check for an existing report');
  if (data) throw ApiError.conflict('This report has already been submitted for the selected period.');
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
  // `content` is only selected by the detail/create/review queries, never the
  // list query, so a listed row has no `content` key at all. Expose
  // `hasContent` only when the column was actually read.
  const contentRead = Object.prototype.hasOwnProperty.call(row, 'content');
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
    ...(contentRead
      ? {
          content: row.content ?? null,
          contentSchemaVersion: row.content_schema_version ?? null,
          hasContent: row.content != null,
        }
      : {}),
    ...(Array.isArray(row.history) ? { history: row.history.map(toHistoryEntry) } : {}),
  };
};

const toHistoryEntry = (row) => ({
  action: row.action || '',
  previousStatus: row.previous_status || '',
  status: row.new_status || '',
  explanation: row.explanation || '',
  actorName: row.actor?.full_name || row.actor?.email || '',
  actorRole: row.actor?.role || '',
  at: row.created_at || '',
});

const SENDER_EMBED = 'sender:profiles!created_by(full_name, email, role)';
const REVIEWER_EMBED = 'reviewer:profiles!reviewed_by(full_name, email, role)';
const BARANGAY_EMBED = 'barangay:barangays(name)';
const EMBEDS = `${SENDER_EMBED}, ${REVIEWER_EMBED}, ${BARANGAY_EMBED}`;
// Scalar columns common to every query. `content` is intentionally excluded
// here so list/inbox queries stay lean (a submitted snapshot can be large).
const BASE_COLUMNS = [
  'id', 'report_type', 'report_period', 'title', 'created_by', 'sender_role',
  'recipient_role', 'municipality_id', 'barangay_id', 'status', 'remarks',
  'submitted_at', 'reviewed_by', 'reviewed_at', 'created_at', 'updated_at',
].join(', ');
// List/inbox: metadata + embeds, WITHOUT the content snapshot.
const LIST_SELECT = `${BASE_COLUMNS}, ${EMBEDS}`;
// Detail/create/review: everything the list has PLUS the persisted snapshot.
const DETAIL_SELECT = `${BASE_COLUMNS}, content, content_schema_version, ${EMBEDS}`;

const assertStaff = (user) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');
  if (!REPORT_ROUTES[user.role] && !REPORT_RECIPIENT_ROLES.includes(user.role)) {
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
  let query = supabase.from(TABLE).select(LIST_SELECT).order('created_at', { ascending: false }).limit(200);

  if (box === 'outgoing') {
    query = query.eq('created_by', user.id);
  } else {
    // MHO has read-only municipality oversight of PHN inbox submissions.
    const recipientRoles = [user.role];
    if (user.role === ROLES.PHN || user.role === ROLES.MHO) recipientRoles.push(ROLES.RHU_PERSONNEL);
    query = query.in('recipient_role', recipientRoles);
    if (!user.municipalityId) return [];
    query = query.eq('municipality_id', user.municipalityId);
    if (user.role === ROLES.HEALTH_SUPERVISOR) {
      if (!user.barangayId) return [];
      query = query.eq('barangay_id', user.barangayId);
    }
    query = query.neq('created_by', user.id);
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
  if ([ROLES.PHN, ROLES.MHO].includes(user.role) && row.recipient_role === ROLES.RHU_PERSONNEL) {
    return Boolean(user.municipalityId && row.municipality_id === user.municipalityId);
  }
  if (row.recipient_role !== user.role) return false;
  if (!user.municipalityId || row.municipality_id !== user.municipalityId) return false;
  if (user.role === ROLES.HEALTH_SUPERVISOR && row.barangay_id && row.barangay_id !== user.barangayId) return false;
  return true;
};

export const getById = async ({ user, id, supabase = getServiceClient() }) => {
  assertStaff(user);
  const { data, error } = await supabase.from(TABLE).select(DETAIL_SELECT).eq('id', id).maybeSingle();
  throwOnError(error, 'Could not load report');
  if (!data || !inScope(user, data)) throw ApiError.notFound('Report not found.');
  const { data: history, error: historyError } = await supabase
    .from(HISTORY_TABLE)
    .select('id, action, previous_status, new_status, explanation, created_at, actor:profiles!actor_id(full_name, email, role)')
    .eq('report_id', id)
    .order('created_at', { ascending: true });
  throwOnError(historyError, 'Could not load report history');
  return toReport({ ...data, history: history || [] });
};

/** Auth-user ids for the routed recipient or its authorized operational observers. */
const recipientAuthUserIds = async (supabase, { recipientRole, municipalityId, barangayId }) => {
  const roles = recipientRole === ROLES.RHU_PERSONNEL
    ? [ROLES.PHN, ROLES.MHO]
    : [recipientRole];
  let query = supabase.from('profiles').select('id').in('role', roles).eq('status', 'active');
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

  // The submitted report snapshot. Validated/sanitized upstream, but re-checked
  // here (defense in depth): only a plain object within the size cap is stored,
  // otherwise the report is persisted with NO snapshot rather than a bad one.
  let content = null;
  const candidate = payload.content;
  if (isPlainObject(candidate)) {
    let bytes = 0;
    try {
      bytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
    } catch {
      bytes = REPORT_CONTENT_MAX_BYTES + 1; // non-serializable -> reject below
    }
    if (bytes <= REPORT_CONTENT_MAX_BYTES) content = candidate;
    else throw ApiError.unprocessable('The report content is too large to submit.');
  }

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
    // One atomic INSERT writes the submission AND its snapshot together, so a
    // report can never be left Submitted with its content missing.
    content,
    content_schema_version: content ? REPORT_CONTENT_SCHEMA_VERSION : null,
  };

  if (!asDraft) {
    await assertNoDuplicateSubmission(supabase, row);
  }

  const { data, error } = await supabase.from(TABLE).insert(row).select(DETAIL_SELECT).single();
  if (error?.code === '23505') {
    throw ApiError.conflict('This report has already been submitted for the selected period.');
  }
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
 * The routed recipient acts on a report, following the explicit transition
 * graph. PHN/MHO oversight of RHU reports is read-only; only the addressed
 * recipient may acknowledge or decide.
 */
export const review = async ({ user, id, status, remarks = '', supabase = getServiceClient() }) => {
  assertStaff(user);
  const target = text(status);
  if (!RECIPIENT_DECISIONS.has(target)) {
    throw ApiError.unprocessable('Invalid report review status.');
  }
  const { data: existing, error: readError } = await supabase.from(TABLE).select(DETAIL_SELECT).eq('id', id).maybeSingle();
  throwOnError(readError, 'Could not load report');
  if (!existing) throw ApiError.notFound('Report not found.');

  // Only the routed recipient (not the sender) may review.
  const isRecipient =
    existing.created_by !== user.id &&
    existing.recipient_role === user.role &&
    Boolean(user.municipalityId && existing.municipality_id === user.municipalityId) &&
    (user.role !== ROLES.HEALTH_SUPERVISOR || existing.barangay_id === user.barangayId);
  if (!isRecipient) throw ApiError.forbidden('Only the addressed report recipient may review this report.');
  if (!(REPORT_TRANSITIONS[existing.status] || []).includes(target)) {
    throw ApiError.conflict(`A ${existing.status} report cannot be moved to ${target}.`);
  }
  if ([REPORT_STATUS.NEEDS_REVISION, REPORT_STATUS.REJECTED].includes(target) && !text(remarks)) {
    throw ApiError.unprocessable('An explanation is required when requesting revisions or rejecting a report.');
  }

  const row = {
    status: target,
    remarks: text(remarks) || existing.remarks || '',
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from(TABLE).update(row).eq('id', id).select(DETAIL_SELECT).single();
  throwOnError(error, 'Could not update report');

  // Notify the sender that their report advanced.
  await notifyResident({
    recipientAuthUserId: existing.created_by,
    category: [REPORT_STATUS.NEEDS_REVISION, REPORT_STATUS.REJECTED].includes(target) ? 'alert' : 'information',
    title: `Report ${target.toLowerCase()}`,
    message: `Your ${existing.report_type} was marked ${target.toLowerCase()}.`,
    relatedType: TABLE,
    relatedId: id,
  });

  return toReport(data);
};

/** Sender replaces a report marked Needs Revision and submits that same record. */
export const resubmit = async ({ user, id, content, supabase = getServiceClient() }) => {
  assertStaff(user);
  if (!isPlainObject(content)) throw ApiError.unprocessable('The revised report content must be an object.');
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(content), 'utf8');
  } catch {
    bytes = REPORT_CONTENT_MAX_BYTES + 1;
  }
  if (bytes > REPORT_CONTENT_MAX_BYTES) {
    throw ApiError.unprocessable('The report content is too large to submit.');
  }

  const { data: existing, error: readError } = await supabase
    .from(TABLE)
    .select(DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle();
  throwOnError(readError, 'Could not load report');
  if (!existing || existing.created_by !== user.id) throw ApiError.notFound('Report not found.');
  if (existing.status !== REPORT_STATUS.NEEDS_REVISION) {
    throw ApiError.conflict('Only a report marked Needs Revision can be resubmitted.');
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      content,
      content_schema_version: REPORT_CONTENT_SCHEMA_VERSION,
      status: REPORT_STATUS.SUBMITTED,
      remarks: '',
      submitted_at: now,
      reviewed_by: null,
      reviewed_at: null,
    })
    .eq('id', id)
    .select(DETAIL_SELECT)
    .single();
  throwOnError(error, 'Could not resubmit report');

  const recipients = await recipientAuthUserIds(supabase, {
    recipientRole: existing.recipient_role,
    municipalityId: existing.municipality_id,
    barangayId: existing.barangay_id,
  });
  await Promise.all(
    recipients.map((recipientId) =>
      notifyResident({
        recipientAuthUserId: recipientId,
        category: 'information',
        title: 'Report resubmitted',
        message: `A revised ${existing.report_type}${existing.report_period ? ` for ${existing.report_period}` : ''} was submitted.`,
        relatedType: TABLE,
        relatedId: id,
      }),
    ),
  );
  return toReport(data);
};

export const meta = () => ({
  statuses: REPORT_STATUSES,
  transitions: REPORT_TRANSITIONS,
  routes: REPORT_ROUTES,
});

export default {
  REPORT_STATUS,
  REPORT_STATUSES,
  REPORT_TRANSITIONS,
  REPORT_ROUTES,
  REPORT_RECIPIENT_ROLES,
  REPORT_CONTENT_SCHEMA_VERSION,
  REPORT_CONTENT_MAX_BYTES,
  assertNoDuplicateSubmission,
  resolveRecipientRole,
  list,
  getById,
  create,
  review,
  resubmit,
  meta,
};
