import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import { uploadDocument, deleteDocument, getDocumentSignedUrl } from '../services/storage.service.js';
import { validateDocumentUpload, validateDocumentReview } from '../validators/documents.validators.js';

const SELF_ROLES = ['resident', 'resident-limited'];
const REVIEW_ROLES = ['health_supervisor', 'phn', 'admin'];

export const uploadResidentDocument = async ({ user, residentId, file, documentType = 'proof_of_residency' }) => {
  if (!SELF_ROLES.includes(user?.role)) {
    throw ApiError.forbidden('Only a resident account may upload documents.');
  }

  const validation = validateDocumentUpload({ file, documentType });
  if (validation.error) {
    throw ApiError.badRequest('Invalid document.', validation.error);
  }

  const resident = await repository.getResident(residentId);
  if (!resident) {
    throw ApiError.notFound('Resident not found.');
  }

  if (resident.authUserId !== user.id) {
    throw ApiError.forbidden('You may only upload documents for your own account.');
  }

  const existing = await repository.listDocumentsByResident(residentId);
  const pending = existing.find((d) => d.verificationStatus === 'pending');
  if (pending) {
    throw ApiError.conflict('A pending document already exists. Please wait for review or remove it first.');
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
    fileName: validation.fileName,
    storagePath,
    mimeType: validation.mimeType,
    sizeBytes: validation.sizeBytes,
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

export const getResidentDocument = async ({ user, residentId, documentId }) => {
  const resident = await repository.getResident(residentId);
  if (!resident) {
    throw ApiError.notFound('Resident not found.');
  }

  const isAdmin = user?.role === 'admin';
  const isInScope =
    user?.role === 'health_supervisor' &&
    resident.barangayId === user?.barangayId;

  if (!isAdmin && !isInScope) {
    throw ApiError.forbidden('You are not authorized to view this document.');
  }

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
