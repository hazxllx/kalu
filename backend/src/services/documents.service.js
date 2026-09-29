import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { uploadDocument, deleteDocument, getDocumentSignedUrl } from '../services/storage.service.js';
import { validateDocumentUpload, validateDocumentReview } from '../validators/documents.validators.js';

const SELF_ROLES = ['resident', 'resident-limited'];
const REVIEW_ROLES = ['health_supervisor', 'phn', 'admin'];

export const uploadResidentDocument = async ({
  user,
  residentId,
  file,
  documentType = 'proof_of_residency',
  governmentIdType = null,
  governmentIdTypeOther = null,
}) => {
  if (!SELF_ROLES.includes(user?.role)) {
    throw ApiError.forbidden('Only a resident account may upload documents.');
  }

  const validation = validateDocumentUpload({ file, documentType, governmentIdType, governmentIdTypeOther });
  if (validation.error) {
    throw ApiError.badRequest('Invalid document.', validation.error);
  }
  const documentMeta = validation.value;

  const resident = await repository.getResident(residentId);
  if (!resident) {
    throw ApiError.notFound('Resident not found.');
  }

  if (resident.authUserId !== user.id) {
    throw ApiError.forbidden('You may only upload documents for your own account.');
  }

  // A resident has exactly one current file per slot (ID front, ID back,
  // identity photo, …). If a PENDING file already occupies this slot — the
  // original submission, or an earlier resubmission attempt — replace it: the
  // old private object and its row are removed first so the Health Supervisor
  // only ever reviews the latest document and no stale/duplicate file is left
  // behind. Non-pending (already-reviewed) files are never touched here.
  const existing = await repository.listDocumentsByResident(residentId);
  const sameSlot = existing.find(
    (d) => d.verificationStatus === 'pending' && d.documentType === documentType,
  );
  if (sameSlot) {
    try {
      await deleteDocument(sameSlot.storagePath);
    } catch {
      /* best-effort: still drop the row so the slot is replaced */
    }
    await repository.deleteDocument(sameSlot.id);
  }

  const documentId = crypto.randomUUID();
  const { storagePath, url } = await uploadDocument({
    file,
    residentId,
    documentId,
  });

  const document = await repository.insertDocument({
    residentId,
    documentType,
    governmentIdType: documentMeta.governmentIdType,
    fileName: documentMeta.fileName,
    storagePath,
    mimeType: documentMeta.mimeType,
    sizeBytes: documentMeta.sizeBytes,
    verificationStatus: 'pending',
    uploadedById: user.id,
  });

  return {
    ...document,
    url,
  };
};

export const getMyDocument = async ({ user, residentId }) => {
  if (!SELF_ROLES.includes(user?.role)) {
    throw ApiError.forbidden();
  }

  const resident = await repository.getResident(residentId);
  if (!resident || resident.authUserId !== user.id) {
    throw ApiError.forbidden('You may only view your own documents.');
  }

  const documents = await repository.listDocumentsByResident(residentId);
  const latest = documents[0] || null;
  if (!latest) return null;

  const url = await getDocumentSignedUrl(latest.storagePath);
  return { ...latest, url };
};

/** Staff can review a resident's documents only within their scope. */
const assertReviewerScope = (user, resident) => {
  if (user?.role === 'admin') return;
  if (user?.role === 'health_supervisor' && resident.barangayId === user?.barangayId) return;
  if (user?.role === 'phn' && resident.municipalityId && resident.municipalityId === user?.municipalityId) return;
  throw ApiError.forbidden("You are not authorized to view this resident's documents.");
};

/**
 * Staff: list a resident's uploaded documents (latest first) with fresh signed
 * URLs from private storage. Scope-enforced; the caller may only see residents
 * inside their barangay (Health Supervisor) or municipality (PHN).
 */
export const listResidentDocuments = async ({ user, residentId }) => {
  if (!REVIEW_ROLES.includes(user?.role)) {
    throw ApiError.forbidden('You are not authorized to view resident documents.');
  }
  const resident = await repository.getResident(residentId);
  if (!resident) throw ApiError.notFound('Resident not found.');
  assertReviewerScope(user, resident);

  const documents = await repository.listDocumentsByResident(residentId);
  return Promise.all(
    documents.map(async (doc) => ({
      id: doc.id,
      documentType: doc.documentType,
      governmentIdType: doc.governmentIdType || null,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      verificationStatus: doc.verificationStatus,
      createdAt: doc.createdAt,
      url: await getDocumentSignedUrl(doc.storagePath),
    })),
  );
};

export const getResidentDocument = async ({ user, residentId, documentId }) => {
  // BUG-015: this read must allow the SAME reviewers the route authorizes and
  // that listResidentDocuments already allows — Admin, Health Supervisor (own
  // barangay) and PHN (own municipality) — instead of silently excluding the
  // PHN. Scope is still enforced via assertReviewerScope.
  if (!REVIEW_ROLES.includes(user?.role)) {
    throw ApiError.forbidden('You are not authorized to view this document.');
  }
  const resident = await repository.getResident(residentId);
  if (!resident) {
    throw ApiError.notFound('Resident not found.');
  }
  assertReviewerScope(user, resident);

  const document = await repository.getDocument(documentId);
  if (!document || document.residentId !== residentId) {
    throw ApiError.notFound('Document not found.');
  }

  const url = await getDocumentSignedUrl(document.storagePath);
  return { ...document, url };
};

export const reviewResidentDocument = async ({ user, residentId, documentId, patch }) => {
  if (!REVIEW_ROLES.includes(user?.role)) {
    throw ApiError.forbidden('You are not authorized to review documents.');
  }

  const resident = await repository.getResident(residentId);
  if (!resident) {
    throw ApiError.notFound('Resident not found.');
  }

  const isAdmin = user.role === 'admin';
  const isInScope =
    user.role === 'health_supervisor' &&
    resident.barangayId === user.barangayId;

  if (!isAdmin && !isInScope) {
    throw ApiError.forbidden('You are not authorized to review documents outside your scope.');
  }

  const validation = validateDocumentReview(patch);
  if (validation.error) {
    throw ApiError.badRequest('Invalid review.', validation.error);
  }

  const document = await repository.getDocument(documentId);
  if (!document || document.residentId !== residentId) {
    throw ApiError.notFound('Document not found.');
  }

  const updated = await repository.updateDocument(documentId, {
    verificationStatus: validation.verificationStatus,
    rejectionReason: validation.rejectionReason,
    reviewedById: user.id,
    reviewedAt: new Date().toISOString(),
  });

  return updated;
};

export const deleteResidentDocument = async ({ user, residentId, documentId }) => {
  if (!SELF_ROLES.includes(user?.role)) {
    throw ApiError.forbidden();
  }

  const resident = await repository.getResident(residentId);
  if (!resident || resident.authUserId !== user.id) {
    throw ApiError.forbidden('You may only remove your own documents.');
  }

  const document = await repository.getDocument(documentId);
  if (!document || document.residentId !== residentId) {
    throw ApiError.notFound('Document not found.');
  }

  if (document.verificationStatus !== 'pending') {
    throw ApiError.badRequest('Only pending documents can be removed.');
  }

  await deleteDocument(document.storagePath);
  await repository.deleteDocument(documentId);
  return { success: true };
};

export default {
  uploadResidentDocument,
  getMyDocument,
  getResidentDocument,
  reviewResidentDocument,
  deleteResidentDocument,
};
