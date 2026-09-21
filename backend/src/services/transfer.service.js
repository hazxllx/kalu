import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { sendTransferOtp } from './email.service.js';
import { deleteDocument, getDocumentSignedUrl, uploadTransferDocument } from './storage.service.js';
import { validateDocumentUpload } from '../validators/documents.validators.js';
import env from '../config/env.js';
import { assignedBarangay } from '../config/scope.js';

const SELF_ROLES = new Set(['resident', 'resident-limited']);
const REVIEW_ROLES = new Set(['admin', 'mho', 'phn', 'health_supervisor']);
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const OPEN_STATUSES = new Set(['pending', 'under_review']);
// Server-side OTP purpose. This value is mixed into the HMAC so a Transfer of
// Residency code is cryptographically domain-separated from any other OTP in
// the system (e.g. the Supabase Auth "Confirm Signup" registration email).
// A registration verification code can never satisfy this hash, and a transfer
// code can never satisfy a registration verification — the two OTP purposes are
// not interchangeable. The dedicated `transfer_requests` table further isolates
// transfer OTP state from registration state.
const OTP_PURPOSE = 'transfer_residency';
const field = (row, snake, camel) => row?.[snake] ?? row?.[camel];
const isMissingTransferSchema = (error) => {
  const details = error?.details || error;
  return details?.code === 'PGRST205' || /transfer_requests|transfer_request_id|schema cache/i.test(String(details?.message || error?.message || ''));
};
const transferSchemaUnavailable = () => new ApiError(503, 'Transfer setup is unavailable until the transfer database migration is applied. Please contact KALUSAGAP support.');

const otpHash = (otp, purpose = OTP_PURPOSE) =>
  createHmac('sha256', env.otpPepper || 'development-only-change-me').update(`${purpose}:${otp}`).digest('hex');
const makeOtp = () => String(randomInt(0, 10000)).padStart(4, '0');
const audit = (requestId, actorId, action, metadata = {}) => repository.insertTransferAuditLog({
  transferRequestId: requestId, actorId, action, metadata,
});
const ownRequest = async (user, id = null) => {
  const request = id ? await repository.getTransferRequest(id, user.id) : await repository.getLatestTransferRequest(user.id);
  if (!request) throw ApiError.notFound('Transfer request not found.');
  return request;
};
const assertSelf = (user) => {
  if (!SELF_ROLES.has(user?.role)) throw ApiError.forbidden('Only a resident account may submit a transfer request.');
};
const safeRequest = (request) => request && ({
  id: request.id,
  status: request.status,
  targetResidentId: request.target_resident_id || request.targetResidentId || null,
  submittedAt: request.submitted_at || request.submittedAt || null,
  reviewedAt: request.reviewed_at || request.reviewedAt || null,
  rejectionReason: request.rejection_reason || request.rejectionReason || '',
});

export const requestOtp = async ({ user }) => {
  assertSelf(user);
  if (await repository.getResidentByAuthUserId(user.id)) {
    throw ApiError.conflict('Your account is already associated with an existing resident record.');
  }
  let current;
  try {
    current = await repository.getLatestTransferRequest(user.id);
  } catch (error) {
    if (isMissingTransferSchema(error)) throw transferSchemaUnavailable();
    throw error;
  }
    if (current && OPEN_STATUSES.has(current.status) && field(current, 'otp_expires_at', 'otpExpiresAt') &&
      Date.now() - new Date(field(current, 'updated_at', 'updatedAt') || field(current, 'created_at', 'createdAt')).getTime() < RESEND_COOLDOWN_MS) {
    throw ApiError.tooManyRequests('Please wait before requesting another verification code.');
  }
  const otp = makeOtp();
  const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();
  let request;
  if (current && OPEN_STATUSES.has(current.status)) {
    request = await repository.updateTransferRequest(current.id, {
      otp_hash: otpHash(otp), otp_expires_at: expires, otp_attempts: 0,
      otp_verified_at: null, otp_locked_until: null,
    });
  } else {
    try {
      request = await repository.createTransferRequest({ authUserId: user.id, otpHash: otpHash(otp), otpExpiresAt: expires });
    } catch (error) {
      if (isMissingTransferSchema(error)) throw transferSchemaUnavailable();
      throw error;
    }
  }
  try {
    // The recipient is ALWAYS the authenticated account's own email, derived
    // server-side from the verified session (never an address supplied by the
    // client), so an authenticated user cannot direct their OTP to another
    // account.
    await sendTransferOtp({ email: user.email, otp });
  } catch (error) {
    await repository.updateTransferRequest(request.id, { status: 'cancelled' });
    throw new ApiError(503, 'Verification email delivery is temporarily unavailable. Please try again later.');
  }
  await audit(request.id, user.id, 'otp_sent');
  return { requestId: request.id, expiresAt: expires, resendAfter: new Date(Date.now() + RESEND_COOLDOWN_MS).toISOString() };
};

export const verifyOtp = async ({ user, requestId, otp }) => {
  assertSelf(user);
  if (!/^\d{4}$/.test(String(otp || ''))) throw ApiError.badRequest('Verification code must contain exactly four digits.');
  const request = await ownRequest(user, requestId);
  if (!OPEN_STATUSES.has(request.status)) throw ApiError.conflict('This transfer request is no longer active.');
  if (request.otp_locked_until && new Date(request.otp_locked_until) > new Date()) throw ApiError.tooManyRequests('Too many failed verification attempts. Request a new code later.');
  const storedHash = field(request, 'otp_hash', 'otpHash');
  const expiresAt = field(request, 'otp_expires_at', 'otpExpiresAt');
  if (!storedHash || !expiresAt || new Date(expiresAt) <= new Date()) throw ApiError.badRequest('This verification code has expired. Request a new code.');
  const matches = timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(otpHash(String(otp)), 'hex'));
  if (!matches) {
    const attempts = Number(field(request, 'otp_attempts', 'otpAttempts') || 0) + 1;
    await repository.updateTransferRequest(request.id, { otp_attempts: attempts, otp_locked_until: attempts >= MAX_ATTEMPTS ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null });
    await audit(request.id, user.id, 'otp_failed');
    throw ApiError.unauthorized('Invalid verification code.');
  }
  await repository.updateTransferRequest(request.id, { otp_hash: null, otp_expires_at: null, otp_attempts: 0, otp_verified_at: new Date().toISOString(), otp_locked_until: null });
  await audit(request.id, user.id, 'otp_verified');
  return { requestId: request.id, verified: true };
};

export const uploadDocument = async ({ user, requestId, file, documentType, governmentIdType, governmentIdTypeOther }) => {
  assertSelf(user);
  const request = await ownRequest(user, requestId);
  if (!OPEN_STATUSES.has(request.status) || !request.otp_verified_at) throw ApiError.forbidden('Complete email verification before uploading transfer documents.');
  const allowed = ['government_id_front', 'government_id_back', 'transfer_previous_health_record', 'transfer_proof_of_address'];
  if (!allowed.includes(documentType)) throw ApiError.badRequest('Invalid transfer document type.');
  const validation = validateDocumentUpload({ file, documentType, governmentIdType, governmentIdTypeOther });
  if (validation.error) throw ApiError.badRequest('Invalid document.', validation.error);
  const documentMeta = validation.value;
  const existing = await repository.listDocumentsByTransferRequest(request.id);
  const previous = existing.find((item) => item.documentType === documentType && item.verificationStatus === 'pending');
  if (previous) {
    await deleteDocument(previous.storagePath);
    await repository.deleteDocument(previous.id);
    await audit(request.id, user.id, 'document_replaced', { documentType });
  }
  const documentId = randomUUID();
  const stored = await uploadTransferDocument({ file, transferRequestId: request.id, documentId });
  const document = await repository.insertDocument({ transferRequestId: request.id, documentType, governmentIdType: documentMeta.governmentIdType, fileName: documentMeta.fileName, storagePath: stored.storagePath, mimeType: documentMeta.mimeType, sizeBytes: documentMeta.sizeBytes, verificationStatus: 'pending', uploadedById: user.id });
  await audit(request.id, user.id, 'document_uploaded', { documentType });
  return { id: document.id, documentType, verificationStatus: 'pending' };
};

export const getMine = async ({ user }) => {
  assertSelf(user);
  const request = await repository.getLatestTransferRequest(user.id);
  if (!request) return null;
  const documents = await repository.listDocumentsByTransferRequest(request.id);
  return { id: request.id, status: request.status, submittedAt: request.submitted_at || request.submittedAt || null, email: user.email, documents: documents.map((doc) => ({ id: doc.id, documentType: doc.documentType, verificationStatus: doc.verificationStatus })) };
};

export const submit = async ({ user, requestId }) => {
  assertSelf(user);
  const request = await ownRequest(user, requestId);
  if (!field(request, 'otp_verified_at', 'otpVerifiedAt')) throw ApiError.forbidden('Verify your email before submitting the transfer request.');
  const docs = await repository.listDocumentsByTransferRequest(request.id);
  const required = ['government_id_front', 'government_id_back', 'transfer_previous_health_record', 'transfer_proof_of_address'];
  if (required.some((type) => !docs.some((doc) => doc.documentType === type && doc.verificationStatus === 'pending'))) throw ApiError.unprocessable('Upload all required transfer documents before submitting.');
  const updated = await repository.updateTransferRequest(request.id, { status: 'pending', submitted_at: new Date().toISOString() });
  await audit(request.id, user.id, 'transfer_request_created');
  return { id: updated.id, status: updated.status, submittedAt: field(updated, 'submitted_at', 'submittedAt') };
};

export const listQueue = async ({ user, status = 'pending' }) => {
  if (!REVIEW_ROLES.has(user?.role)) throw ApiError.forbidden('You are not authorized to review transfer requests.');
  const result = await repository.listTransferRequests({ status });
  return { ...result, rows: result.rows.map(safeRequest) };
};

export const getForReview = async ({ user, requestId }) => {
  if (!REVIEW_ROLES.has(user?.role)) throw ApiError.forbidden('You are not authorized to review transfer requests.');
  const request = await repository.getTransferRequest(requestId);
  if (!request) throw ApiError.notFound('Transfer request not found.');
  const documents = await repository.listDocumentsByTransferRequest(requestId);
  return { request: safeRequest(request), documents: await Promise.all(documents.map(async (doc) => ({ id: doc.id, documentType: doc.documentType, verificationStatus: doc.verificationStatus, url: await getDocumentSignedUrl(doc.storagePath) }))) };
};

export const approve = async ({ user, requestId, residentId }) => {
  if (!REVIEW_ROLES.has(user?.role)) throw ApiError.forbidden('You are not authorized to approve transfer requests.');
  if (!residentId) throw ApiError.badRequest('A resident record must be selected by authorized personnel.');
  const request = await repository.getTransferRequest(requestId);
  if (!request) throw ApiError.notFound('Transfer request not found.');
  const resident = await repository.getResident(residentId);
  if (!resident || resident.authUserId || (assignedBarangay(user) && String(resident.barangay || '').toLowerCase() !== String(assignedBarangay(user)).toLowerCase()) || (user.municipalityId && resident.municipalityId && user.municipalityId !== resident.municipalityId)) {
    throw ApiError.conflict('This transfer request requires additional verification.');
  }
  const result = await repository.approveTransferRequest({ requestId, reviewerId: user.id, residentId });
  if (!result) throw ApiError.conflict('This transfer request cannot be approved.');
  await audit(requestId, user.id, 'transfer_request_approved', { residentId });
  await audit(requestId, user.id, 'resident_account_linked');
  return { id: result.id, status: result.status };
};

export const reject = async ({ user, requestId, reason }) => {
  if (!REVIEW_ROLES.has(user?.role)) throw ApiError.forbidden('You are not authorized to reject transfer requests.');
  if (!String(reason || '').trim()) throw ApiError.badRequest('A rejection reason is required.');
  const request = await repository.getTransferRequest(requestId);
  if (!request) throw ApiError.notFound('Transfer request not found.');
  const updated = await repository.updateTransferRequest(requestId, { status: 'rejected', rejection_reason: String(reason || '').trim(), reviewed_by: user.id, reviewed_at: new Date().toISOString() });
  await audit(requestId, user.id, 'transfer_request_rejected');
  return { id: updated.id, status: updated.status };
};

export default { requestOtp, verifyOtp, uploadDocument, getMine, submit, listQueue, getForReview, approve, reject };