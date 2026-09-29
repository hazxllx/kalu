import { randomUUID } from 'node:crypto';
import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { deleteDocument, getDocumentSignedUrl, uploadTransferDocument } from './storage.service.js';
import { validateDocumentUpload } from '../validators/documents.validators.js';
import { notifyResident } from './notifications.service.js';

/**
 * Transfer of Residency — change of the EXISTING resident's barangay.
 *
 * A transfer is NOT a new resident registration and NOT an account claim. The
 * resident already exists and is already linked to the authenticated account
 * (residents.auth_user_id, set at registration). The authenticated session is
 * used only to IDENTIFY that one resident — never to block them, and never to
 * let them pick another resident. A transfer changes ONLY the resident's
 * current barangay after approval; the resident id, the account link and every
 * existing health record (visits, referrals, follow-ups, …) stay attached to
 * that same resident row across any number of transfers.
 *
 * The ONLY thing that blocks a new transfer is an already-open request
 * (status pending/under_review). An approved or rejected request never blocks a
 * future transfer.
 */

const SELF_ROLES = new Set(['resident', 'resident-limited']);
const REVIEW_ROLES = new Set(['admin', 'mho', 'phn', 'health_supervisor']);
// A request is "open" (blocks a new one) only while awaiting review.
const OPEN_STATUSES = new Set(['pending', 'under_review']);
// Documents attach while the request is a draft or open (pre-approval).
const EDITABLE_STATUSES = new Set(['draft', 'pending', 'under_review']);
const HEALTH_RECORD_TYPE = 'transfer_previous_health_record';
const SUPPORTING_TYPE = 'transfer_proof_of_address';

/**
 * Decide how a new transfer document write relates to the already-stored pending
 * documents. Kept pure (no storage / no db) so the rule is unit-testable:
 *   - SUPPORTING_TYPE is a single slot: a new upload REPLACES the previous
 *     pending copy of the same type.
 *   - health records are supplementary and may be uploaded in any number, but an
 *     EXACT re-upload (same type + name + size) is a DUPLICATE and is ignored.
 * Returns { replace, duplicate } where each is the matched existing doc or null.
 */
export const planDocumentWrite = ({ existing = [], documentType, documentMeta }) => {
  const pending = existing.filter(
    (item) => item.documentType === documentType && item.verificationStatus === 'pending',
  );
  if (documentType === SUPPORTING_TYPE) {
    return { replace: pending[0] || null, duplicate: null };
  }
  const duplicate = pending.find(
    (item) => item.fileName === documentMeta.fileName
      && Number(item.sizeBytes) === Number(documentMeta.sizeBytes),
  ) || null;
  return { replace: null, duplicate };
};

const field = (row, snake, camel) => row?.[snake] ?? row?.[camel];

const isMissingTransferSchema = (error) => {
  const details = error?.details || error;
  // Only treat genuinely missing transfer schema objects as a migration gap.
  // (Kept transfer-specific so an unrelated database error is never masked by
  // the "migration not applied" message.)
  return details?.code === 'PGRST205'
    || /transfer_requests|transfer_request_id|from_barangay_id|to_barangay_id|schema cache/i
      .test(String(details?.message || error?.message || ''));
};
const transferSchemaUnavailable = () => new ApiError(
  503,
  'Transfer setup is unavailable until the transfer database migration is applied. Please contact KALUSAGAP support.',
);

const assertSelf = (user) => {
  if (!SELF_ROLES.has(user?.role)) {
    throw ApiError.forbidden('Only a resident account may request a transfer of residency.');
  }
};

/**
 * The resident linked to the authenticated account. This is REQUIRED to know
 * who is transferring — it does not block the transfer. A signed-in account
 * with no linked resident record cannot transfer (there is nothing to move).
 */
const loadOwnResident = async (user) => {
  const resident = await repository.getResidentByAuthUserId(user.id);
  if (!resident) {
    throw ApiError.notFound(
      'No KALUSAGAP resident record is linked to this account yet. Complete resident registration and verification first.',
    );
  }
  return resident;
};

const audit = (requestId, actorId, action, metadata = {}) => repository.insertTransferAuditLog({
  transferRequestId: requestId, actorId, action, metadata,
});

const ownRequest = async (user, id) => {
  const request = await repository.getTransferRequest(id, user.id);
  if (!request) throw ApiError.notFound('Transfer request not found.');
  return request;
};

const latestRequest = async (user) => {
  try {
    return await repository.getLatestTransferRequest(user.id);
  } catch (error) {
    if (isMissingTransferSchema(error)) throw transferSchemaUnavailable();
    throw error;
  }
};

/** Build an id -> name lookup for the barangays in a municipality. */
const barangayIndex = async (municipalityId) => {
  const rows = await repository.listBarangays({ municipalityId: municipalityId || null });
  const byId = new Map();
  for (const row of rows) byId.set(row.id, row.name);
  return { rows, byId };
};

// A barangay is a valid transfer destination when it is not inactive. The
// `barangays.status` column stores 'Active'/'Inactive' (title-case), so the
// check is case-insensitive and treats a missing status as active. This is the
// single source of destination eligibility (used by both the context read and
// the server-side submit validation) so the two never disagree.
const isEligibleBarangay = (row) => String(row?.status ?? '').toLowerCase() !== 'inactive';

/** Active barangays the resident may transfer to (current barangay excluded). */
const eligibleDestinations = (rows, currentBarangayId) => rows
  .filter((row) => isEligibleBarangay(row))
  .filter((row) => row.id !== currentBarangayId)
  .map((row) => ({ id: row.id, name: row.name }));

const shapeRequest = (request, byId = new Map()) => request && ({
  id: request.id,
  status: request.status,
  residentId: field(request, 'resident_id', 'residentId') || null,
  fromBarangayId: field(request, 'from_barangay_id', 'fromBarangayId') || null,
  toBarangayId: field(request, 'to_barangay_id', 'toBarangayId') || null,
  fromBarangay: byId.get(field(request, 'from_barangay_id', 'fromBarangayId')) || '',
  toBarangay: byId.get(field(request, 'to_barangay_id', 'toBarangayId')) || '',
  reason: field(request, 'reason', 'reason') || '',
  rejectionReason: field(request, 'rejection_reason', 'rejectionReason') || '',
  submittedAt: field(request, 'submitted_at', 'submittedAt') || null,
  reviewedAt: field(request, 'reviewed_at', 'reviewedAt') || null,
  createdAt: field(request, 'created_at', 'createdAt') || null,
});

const residentBarangayId = async (resident) => {
  if (resident.barangayId) return resident.barangayId;
  if (resident.barangay) {
    const row = await repository.findBarangayByName(resident.barangay, resident.municipalityId || null);
    return row?.id || null;
  }
  return null;
};

const residentView = (resident, byId) => ({
  id: resident.id,
  name: [resident.firstName, resident.middleName, resident.lastName, resident.suffix]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
  barangayId: resident.barangayId || null,
  barangay: resident.barangay || byId.get(resident.barangayId) || '',
  municipalityId: resident.municipalityId || null,
  verificationStatus: resident.verificationStatus || '',
});

/**
 * Everything the transfer page needs after authentication:
 *   - the resident's CURRENT residency (derived from the session, never chosen),
 *   - the destination barangays (current barangay excluded),
 *   - any OPEN request (so the UI can show the in-progress state and disable
 *     starting another),
 *   - the full transfer history (every request is kept; the resident is never
 *     duplicated).
 */
export const getContext = async ({ user }) => {
  assertSelf(user);
  const resident = await loadOwnResident(user);
  const { rows: barangays, byId } = await barangayIndex(resident.municipalityId);
  const currentBarangayId = await residentBarangayId(resident);

  let history = [];
  try {
    history = await repository.listTransferRequestsByUser(user.id);
  } catch (error) {
    if (isMissingTransferSchema(error)) throw transferSchemaUnavailable();
    throw error;
  }
  const activeRequest = history.find((row) => OPEN_STATUSES.has(row.status)) || null;

  const destinations = eligibleDestinations(barangays, currentBarangayId);

  return {
    resident: residentView({ ...resident, barangayId: currentBarangayId || resident.barangayId }, byId),
    destinations,
    activeRequest: shapeRequest(activeRequest, byId),
    // Only submitted requests are meaningful history; drafts are working state.
    history: history
      .filter((row) => row.status !== 'draft')
      .map((row) => shapeRequest(row, byId)),
  };
};

/**
 * Create (or reuse) the draft request the resident assembles before submitting.
 * The resident_id and from_barangay come from the authenticated resident — never
 * from the client. Blocks when an open request already exists, and refuses a
 * destination equal to the current barangay.
 */
export const startTransfer = async ({ user, toBarangayId, reason = '' }) => {
  assertSelf(user);
  const resident = await loadOwnResident(user);

  const latest = await latestRequest(user);
  if (latest && OPEN_STATUSES.has(latest.status)) {
    throw ApiError.conflict(
      'You already have a pending transfer request. Please wait for the current request to be reviewed before submitting another transfer.',
    );
  }

  const { rows: barangays, byId } = await barangayIndex(resident.municipalityId);
  const fromBarangayId = await residentBarangayId(resident);
  const target = String(toBarangayId || '').trim();

  // Server-side destination validation — never trust the client's id alone.
  if (!target || !byId.has(target)) {
    throw ApiError.unprocessable('Select a valid destination barangay.');
  }
  const eligibleIds = new Set(eligibleDestinations(barangays, fromBarangayId).map((b) => b.id));
  if (fromBarangayId && target === fromBarangayId) {
    throw ApiError.unprocessable('Please select a different barangay from your current residency.');
  }
  if (!eligibleIds.has(target)) {
    throw ApiError.unprocessable('The selected barangay is not an eligible transfer destination.');
  }

  const cleanReason = String(reason || '').trim().slice(0, 500);

  // Reuse an existing draft so a resident who steps back does not accumulate
  // orphaned drafts.
  let request;
  if (latest && latest.status === 'draft') {
    request = await repository.updateTransferRequest(latest.id, {
      resident_id: resident.id,
      from_barangay_id: fromBarangayId,
      to_barangay_id: target,
      reason: cleanReason,
    });
  } else {
    try {
      request = await repository.createTransferRequest({
        authUserId: user.id,
        residentId: resident.id,
        fromBarangayId,
        toBarangayId: target,
        reason: cleanReason,
        status: 'draft',
      });
    } catch (error) {
      if (isMissingTransferSchema(error)) throw transferSchemaUnavailable();
      throw error;
    }
  }
  await audit(request.id, user.id, 'transfer_draft_started', { toBarangayId: target });
  return { requestId: request.id, status: request.status };
};

/**
 * Attach a supporting document or an existing health record to the resident's
 * own draft/open request. The file is validated (type + size) and stored in the
 * private bucket. The supporting proof-of-address is a single slot (replaced on
 * re-upload); existing health records are supplementary and may be uploaded in
 * any number (an exact duplicate re-upload is ignored). Uploading a health
 * record NEVER creates another resident or a new health record — the resident's
 * existing KALUSAGAP record stays attached to the same resident id.
 */
export const uploadDocument = async ({ user, requestId, file, documentType }) => {
  assertSelf(user);
  const request = await ownRequest(user, requestId);
  if (!EDITABLE_STATUSES.has(request.status)) {
    throw ApiError.forbidden('This transfer request can no longer accept documents.');
  }
  if (![HEALTH_RECORD_TYPE, SUPPORTING_TYPE].includes(documentType)) {
    throw ApiError.badRequest('Invalid transfer document type.');
  }
  const validation = validateDocumentUpload({ file, documentType });
  if (validation.error) throw ApiError.badRequest('Invalid document.', validation.error);
  const documentMeta = validation.value;

  const existing = await repository.listDocumentsByTransferRequest(request.id);
  const { replace, duplicate } = planDocumentWrite({ existing, documentType, documentMeta });

  if (duplicate) {
    // Re-selecting the exact same health record: return the already-stored copy
    // without creating a duplicate.
    return {
      id: duplicate.id,
      documentType,
      fileName: duplicate.fileName,
      mimeType: duplicate.mimeType,
      sizeBytes: duplicate.sizeBytes,
      verificationStatus: duplicate.verificationStatus,
      duplicate: true,
    };
  }
  if (replace) {
    // The supporting proof-of-address is a single slot.
    await deleteDocument(replace.storagePath);
    await repository.deleteDocument(replace.id);
    await audit(request.id, user.id, 'transfer_document_replaced', { documentType });
  }

  const documentId = randomUUID();
  const stored = await uploadTransferDocument({ file, transferRequestId: request.id, documentId });
  const document = await repository.insertDocument({
    transferRequestId: request.id,
    documentType,
    fileName: documentMeta.fileName,
    storagePath: stored.storagePath,
    mimeType: documentMeta.mimeType,
    sizeBytes: documentMeta.sizeBytes,
    verificationStatus: 'pending',
    uploadedById: user.id,
  });
  await audit(request.id, user.id, 'transfer_document_uploaded', { documentType });
  return {
    id: document.id,
    documentType,
    fileName: documentMeta.fileName,
    mimeType: documentMeta.mimeType,
    sizeBytes: documentMeta.sizeBytes,
    verificationStatus: 'pending',
  };
};

/** Remove one of the resident's own uploaded documents from a pre-approval request. */
export const removeDocument = async ({ user, requestId, documentId }) => {
  assertSelf(user);
  const request = await ownRequest(user, requestId);
  if (!EDITABLE_STATUSES.has(request.status)) {
    throw ApiError.forbidden('This transfer request can no longer be edited.');
  }
  const docs = await repository.listDocumentsByTransferRequest(request.id);
  const doc = docs.find((item) => item.id === documentId);
  if (!doc) throw ApiError.notFound('Document not found.');
  await deleteDocument(doc.storagePath);
  await repository.deleteDocument(doc.id);
  await audit(request.id, user.id, 'transfer_document_removed', { documentId });
  return { id: documentId, removed: true };
};

/**
 * The resident-facing residency status derived from the transfer request. This
 * is what the dashboard shows instead of a static "Approved":
 *   - no open/decided transfer  -> 'verified' (normal resident)
 *   - pending / under_review     -> 'transfer_pending'
 *   - approved                   -> 'transfer_approved'
 *   - rejected                   -> 'transfer_rejected'
 */
const residencyStatusFrom = (status) => {
  if (OPEN_STATUSES.has(status)) return 'transfer_pending';
  if (status === 'approved') return 'transfer_approved';
  if (status === 'rejected') return 'transfer_rejected';
  return 'verified';
};

/** The resident's current/latest transfer request with its documents (read-only). */
export const getMine = async ({ user }) => {
  assertSelf(user);
  const request = await latestRequest(user);
  if (!request) return null;
  const resident = await repository.getResidentByAuthUserId(user.id);
  const { byId } = await barangayIndex(resident?.municipalityId);
  const documents = await repository.listDocumentsByTransferRequest(request.id);
  // The resident may VIEW their own uploaded documents (read-only, short-lived
  // signed URL) while the transfer is pending. They can never edit the official
  // record through this view.
  const withUrls = await Promise.all(documents.map(async (doc) => ({
    id: doc.id,
    documentType: doc.documentType,
    // Friendly grouping used by the dashboard's "My Health Records" section.
    kind: doc.documentType === HEALTH_RECORD_TYPE ? 'imported_health_record' : 'supporting_document',
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    verificationStatus: doc.verificationStatus,
    readOnly: true,
    url: await getDocumentSignedUrl(doc.storagePath),
  })));
  return {
    ...shapeRequest(request, byId),
    residencyStatus: residencyStatusFrom(request.status),
    documents: withUrls,
  };
};

/**
 * Submit the draft for review. A supporting document is required; the health
 * record is optional. Turns the draft into an OPEN (pending) request, which is
 * what blocks any further transfer until it is reviewed.
 */
export const submit = async ({ user, requestId }) => {
  assertSelf(user);
  const request = await ownRequest(user, requestId);
  if (request.status !== 'draft') {
    if (OPEN_STATUSES.has(request.status)) {
      throw ApiError.conflict('This transfer request has already been submitted for review.');
    }
    throw ApiError.conflict('This transfer request can no longer be submitted.');
  }
  if (!field(request, 'to_barangay_id', 'toBarangayId') || !field(request, 'resident_id', 'residentId')) {
    throw ApiError.unprocessable('Select a destination barangay before submitting.');
  }
  const docs = await repository.listDocumentsByTransferRequest(request.id);
  const hasSupporting = docs.some((doc) => doc.documentType === SUPPORTING_TYPE && doc.verificationStatus === 'pending');
  if (!hasSupporting) {
    throw ApiError.unprocessable('Upload a supporting document before submitting your transfer request.');
  }
  const updated = await repository.updateTransferRequest(request.id, {
    status: 'pending',
    submitted_at: new Date().toISOString(),
  });
  await audit(request.id, user.id, 'transfer_request_submitted');
  // Best-effort resident notification (never rolls back the submission).
  await notifyResident({
    recipientAuthUserId: user.id,
    category: 'information',
    title: 'Residency transfer submitted',
    message: 'Your residency transfer request has been submitted and is awaiting review by the health office.',
    relatedType: 'transfer_request',
    relatedId: request.id,
  });
  return { id: updated.id, status: updated.status, submittedAt: field(updated, 'submitted_at', 'submittedAt') };
};

/** Resident withdraws their own open request, freeing them to submit a new one. */
export const cancel = async ({ user, requestId }) => {
  assertSelf(user);
  const request = await ownRequest(user, requestId);
  if (!OPEN_STATUSES.has(request.status) && request.status !== 'draft') {
    throw ApiError.conflict('Only a pending transfer request can be cancelled.');
  }
  const updated = await repository.updateTransferRequest(request.id, { status: 'cancelled' });
  await audit(request.id, user.id, 'transfer_request_cancelled');
  return { id: updated.id, status: updated.status };
};

// --------------------------------------------------------------------------
// Staff review
// --------------------------------------------------------------------------

const assertReviewer = (user) => {
  if (!REVIEW_ROLES.has(user?.role)) {
    throw ApiError.forbidden('You are not authorized to review transfer requests.');
  }
};

/**
 * BUG-005: is this transfer request inside the reviewer's scope?
 *   admin / mho / phn  -> municipality-wide (single-municipality deployment)
 *   health_supervisor  -> only requests whose ORIGIN or DESTINATION barangay is
 *                         their assigned barangay
 * Scope is derived from the authenticated session, never a client id, so a
 * barangay-scoped reviewer can neither list nor open another barangay's request.
 */
const transferInReviewerScope = (user, request) => {
  if (!user) return false;
  if (['admin', 'mho', 'phn'].includes(user.role)) return true;
  if (user.role === 'health_supervisor') {
    if (!user.barangayId) return false;
    const from = field(request, 'from_barangay_id', 'fromBarangayId');
    const to = field(request, 'to_barangay_id', 'toBarangayId');
    return from === user.barangayId || to === user.barangayId;
  }
  return false;
};

export const listQueue = async ({ user, status = 'pending' }) => {
  assertReviewer(user);
  const result = await repository.listTransferRequests({ status });
  const { byId } = await barangayIndex(user?.municipalityId);
  // BUG-005: a barangay-scoped reviewer only sees requests touching their barangay.
  const rows = result.rows
    .filter((row) => transferInReviewerScope(user, row))
    .map((row) => shapeRequest(row, byId));
  return { ...result, rows, total: rows.length };
};

export const getForReview = async ({ user, requestId }) => {
  assertReviewer(user);
  const request = await repository.getTransferRequest(requestId);
  if (!request) throw ApiError.notFound('Transfer request not found.');
  // BUG-005: out-of-scope requests return 404 even with a known id.
  if (!transferInReviewerScope(user, request)) throw ApiError.notFound('Transfer request not found.');
  const resident = field(request, 'resident_id', 'residentId')
    ? await repository.getResident(field(request, 'resident_id', 'residentId'))
    : null;
  const { byId } = await barangayIndex(resident?.municipalityId || user?.municipalityId);
  const documents = await repository.listDocumentsByTransferRequest(requestId);
  return {
    request: shapeRequest(request, byId),
    resident: resident ? residentView(resident, byId) : null,
    documents: await Promise.all(documents.map(async (doc) => ({
      id: doc.id,
      documentType: doc.documentType,
      fileName: doc.fileName,
      verificationStatus: doc.verificationStatus,
      url: await getDocumentSignedUrl(doc.storagePath),
    }))),
  };
};

/**
 * Approve a transfer: the RPC updates ONLY the resident's current barangay and
 * marks the request approved, transactionally. The resident id, account link
 * and every health record are preserved.
 */
export const approve = async ({ user, requestId }) => {
  assertReviewer(user);
  const request = await repository.getTransferRequest(requestId);
  if (!request) throw ApiError.notFound('Transfer request not found.');
  if (!OPEN_STATUSES.has(request.status)) {
    throw ApiError.conflict('This transfer request is no longer awaiting review.');
  }
  const residentId = field(request, 'resident_id', 'residentId');
  const resident = residentId ? await repository.getResident(residentId) : null;
  if (!resident) throw ApiError.conflict('The resident for this transfer request could not be found.');

  // BUG-005: a barangay-scoped reviewer may only act on transfers touching their
  // own barangay (origin or destination). Derived from the session id, not names.
  if (!transferInReviewerScope(user, request)) {
    throw ApiError.forbidden('This transfer request is outside your assigned barangay.');
  }

  const result = await repository.approveTransferRequest({ requestId, reviewerId: user.id });
  if (!result) throw ApiError.conflict('This transfer request cannot be approved.');
  await audit(requestId, user.id, 'transfer_request_approved', { residentId });
  await audit(requestId, user.id, 'resident_barangay_updated', {
    toBarangayId: field(request, 'to_barangay_id', 'toBarangayId'),
  });
  await notifyResident({
    recipientAuthUserId: resident.authUserId,
    category: 'information',
    title: 'Residency transfer approved',
    message: 'Your residency transfer request has been approved. Your current barangay has been updated and your existing health record remains associated with your account.',
    relatedType: 'transfer_request',
    relatedId: requestId,
  });
  return { id: result.id, status: result.status };
};

export const reject = async ({ user, requestId, reason }) => {
  assertReviewer(user);
  if (!String(reason || '').trim()) throw ApiError.badRequest('A rejection reason is required.');
  const request = await repository.getTransferRequest(requestId);
  if (!request) throw ApiError.notFound('Transfer request not found.');
  // BUG-005: a barangay-scoped reviewer may only reject a request in their scope.
  if (!transferInReviewerScope(user, request)) throw ApiError.notFound('Transfer request not found.');
  if (!OPEN_STATUSES.has(request.status)) {
    throw ApiError.conflict('This transfer request is no longer awaiting review.');
  }
  const updated = await repository.updateTransferRequest(requestId, {
    status: 'rejected',
    rejection_reason: String(reason || '').trim(),
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  });
  await audit(requestId, user.id, 'transfer_request_rejected');
  // The resident's current barangay and health records are unchanged; notify them.
  const residentId = field(request, 'resident_id', 'residentId');
  const resident = residentId ? await repository.getResident(residentId) : null;
  if (resident?.authUserId) {
    await notifyResident({
      recipientAuthUserId: resident.authUserId,
      category: 'alert',
      title: 'Residency transfer rejected',
      message: `Your residency transfer request was rejected. Reason: ${String(reason || '').trim()}. Your current barangay and health records are unchanged.`,
      relatedType: 'transfer_request',
      relatedId: requestId,
    });
  }
  return { id: updated.id, status: updated.status };
};

export default {
  getContext,
  startTransfer,
  planDocumentWrite,
  uploadDocument,
  removeDocument,
  getMine,
  submit,
  cancel,
  listQueue,
  getForReview,
  approve,
  reject,
};
