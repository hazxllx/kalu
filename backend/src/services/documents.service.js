import ApiError from '../utils/apiError.js';
import repository from '../repositories/index.js';
import {
  uploadDocument,
  downloadDocumentFile,
  deleteDocument,
  getDocumentSignedUrl,
} from '../services/storage.service.js';
import {
  GOVERNMENT_ID_TYPES,
  validateDocumentUpload,
  validateDocumentReview,
} from '../validators/documents.validators.js';
import {
  applyGovernmentIdCrossVerification,
  crossVerifyGovernmentIdSides,
  screenDocument,
} from './documentVerification.service.js';
import {
  IMAGE_QUALITY,
  SCREENING_MESSAGES,
  SCREENING_REASON,
  SCREENING_STATUS,
} from '../config/documentScreening.js';
import { isMinorAge } from '../config/guardianPolicy.js';

const SELF_ROLES = ['resident', 'resident-limited'];
const REVIEW_ROLES = ['health_supervisor', 'phn', 'admin'];
const COMPARABLE_FIELD_NAMES = new Set([
  'name',
  'surname',
  'givenName',
  'middleName',
  'dateOfBirth',
  'idNumber',
]);

const screeningReasonForStorage = (screening) => {
  const comparison = screening?.crossVerification;
  if (!comparison) return screening?.reason || null;
  const pairReason = comparison.status === 'conflict'
    ? SCREENING_REASON.ID_SIDE_FIELDS_CONFLICT
    : comparison.status === 'consistent'
      ? SCREENING_REASON.ID_SIDE_FIELDS_CONSISTENT
      : SCREENING_REASON.ID_SIDE_COMPARISON_INCONCLUSIVE;
  const conflictingFields = (comparison.conflictingFields || [])
    .filter((field) => COMPARABLE_FIELD_NAMES.has(field));
  const fields = conflictingFields.length ? `|${conflictingFields.join(',')}` : '';
  const sideReason = screening.sideReason || screening.reason;
  return `${pairReason}${fields};SIDE:${sideReason}`;
};

/**
 * Run the deterministic document screening step. Screening is ADVISORY for
 * quality/flagged cases, but a hard `automated_rejected` result blocks the
 * upload (see uploadResidentDocument). If screening itself throws, the upload
 * must still succeed and the document routes to manual review rather than being
 * rejected — an unexpected screening failure is not evidence against the file.
 */
const runScreening = async ({ file, documentType, governmentIdType, ocr, requestId, onOcrText }) => {
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    return await screenDocument({
      buffer,
      mimeType: file.type,
      documentType,
      governmentIdType,
      sizeBytes: file.size,
      ocr,
      requestId,
      onOcrText,
    });
  } catch {
    if (requestId) {
      const safeType = ['government_id_front', 'government_id_back', 'identity_photo', 'proof_of_residency'].includes(documentType)
        ? documentType
        : 'other';
      console.info(JSON.stringify({
        event: 'document_screening',
        requestId,
        documentSlot: safeType,
        side: safeType === 'government_id_front' ? 'front' : safeType === 'government_id_back' ? 'back' : 'single',
        governmentIdType: ['philsys', 'drivers_license', 'passport', 'umid', 'prc_id', 'postal_id', 'other'].includes(governmentIdType)
          ? governmentIdType
          : 'other',
        stage: 'file_read',
        ocrProvider: 'not_started',
        ocrProviderAvailability: 'unknown',
        ocrExecutionStatus: 'not_started',
        ocrCharacterCount: 0,
        failedRule: 'SCREENING_TECHNICAL_ERROR',
        finalStatus: SCREENING_STATUS.PENDING_MANUAL_REVIEW,
        finalReason: SCREENING_REASON.SCREENING_TECHNICAL_ERROR,
      }));
    }
    return {
      status: SCREENING_STATUS.PENDING_MANUAL_REVIEW,
      reason: SCREENING_REASON.SCREENING_TECHNICAL_ERROR,
      quality: IMAGE_QUALITY.NOT_ANALYZED,
      ocrDetected: false,
      message: 'We could not complete the automatic document check. Staff review is required.',
    };
  }
};

/**
 * Screen an uploaded file WITHOUT persisting it. Used by the resident
 * registration Step 3 to show the automated result before submission. Nothing
 * is stored and no document row is created, so repeated checks cannot leave
 * stale state behind. The selected government ID type (when the slot is a
 * government ID) narrows the indicator set to that ID's terminology.
 */
export const screenUploadedDocument = async ({
  file,
  documentType = 'proof_of_residency',
  governmentIdType,
  ocr,
  requestId,
} = {}) => {
  if (!file) throw ApiError.badRequest('Please select a document to check.');
  return runScreening({ file, documentType, governmentIdType, ocr, requestId });
};

/** Screen both ID sides together without storing either image or OCR text. */
export const screenUploadedGovernmentIdPair = async ({
  frontFile,
  backFile,
  governmentIdType,
  requestId,
} = {}) => {
  if (!frontFile || !backFile) {
    throw ApiError.badRequest('Please provide both the front and back of your government ID.');
  }
  const normalizedIdType = String(governmentIdType || '').trim().toLowerCase();
  if (!GOVERNMENT_ID_TYPES.includes(normalizedIdType)) {
    throw ApiError.badRequest('Select your government ID type before screening both sides.');
  }

  let frontText = '';
  let backText = '';
  const [frontScreening, backScreening] = await Promise.all([
    runScreening({
      file: frontFile,
      documentType: 'government_id_front',
      governmentIdType: normalizedIdType,
      requestId,
      onOcrText: (text) => { frontText = text; },
    }),
    runScreening({
      file: backFile,
      documentType: 'government_id_back',
      governmentIdType: normalizedIdType,
      requestId,
      onOcrText: (text) => { backText = text; },
    }),
  ]);
  const comparison = crossVerifyGovernmentIdSides(frontText, backText);
  return applyGovernmentIdCrossVerification(frontScreening, backScreening, comparison);
};

const persistGovernmentIdPair = async ({
  user,
  residentId,
  frontFile,
  backFile,
  governmentIdType,
  governmentIdTypeOther,
  screeningPair,
}) => {
  const frontValidation = validateDocumentUpload({
    file: frontFile,
    documentType: 'government_id_front',
    governmentIdType,
    governmentIdTypeOther,
  });
  const backValidation = validateDocumentUpload({
    file: backFile,
    documentType: 'government_id_back',
    governmentIdType,
    governmentIdTypeOther,
  });
  if (frontValidation.error || backValidation.error) {
    throw ApiError.badRequest('Invalid government ID pair.', {
      ...(frontValidation.error ? { governmentIdFront: frontValidation.error } : {}),
      ...(backValidation.error ? { governmentIdBack: backValidation.error } : {}),
    });
  }

  if ([screeningPair.front, screeningPair.back].some(
    (screening) => screening.status === SCREENING_STATUS.AUTOMATED_REJECTED,
  )) {
    throw ApiError.unprocessable('One or both government ID images need to be replaced.', {
      screening: {
        governmentIdFront: screeningPair.front,
        governmentIdBack: screeningPair.back,
      },
    });
  }

  const existing = await repository.listDocumentsByResident(residentId);
  const replacedRows = existing.filter(
    (document) =>
      document.verificationStatus === 'pending'
      && ['government_id_front', 'government_id_back'].includes(document.documentType),
  );

  const persistSide = async (file, documentType, documentMeta, screening) => {
    const documentId = crypto.randomUUID();
    const { storagePath, url } = await uploadDocument({ file, residentId, documentId });
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
      screeningStatus: screening.status,
      screeningReason: screeningReasonForStorage(screening),
      screeningQuality: screening.quality,
      screeningOcrDetected: screening.ocrDetected,
      screeningCheckedAt: new Date().toISOString(),
    });
    return {
      ...document,
      url,
      screening: {
        status: screening.status,
        reason: screening.reason,
        quality: screening.quality,
        ocrDetected: screening.ocrDetected,
        message: screening.message,
      },
    };
  };

  const frontDocument = await persistSide(
    frontFile,
    'government_id_front',
    frontValidation.value,
    screeningPair.front,
  );
  const backDocument = await persistSide(
    backFile,
    'government_id_back',
    backValidation.value,
    screeningPair.back,
  );
  for (const document of replacedRows) {
    await deleteDocument(document.storagePath);
    await repository.deleteDocument(document.id);
  }
  return {
    ...frontDocument,
    screening: {
      ...frontDocument.screening,
      crossVerification: screeningPair.front.crossVerification,
      crossVerificationMessage: screeningPair.front.crossVerificationMessage,
      counterpartScreening: {
        documentType: backDocument.documentType,
        ...backDocument.screening,
        crossVerification: screeningPair.back.crossVerification,
        crossVerificationMessage: screeningPair.back.crossVerificationMessage,
      },
    },
  };
};

export const uploadResidentDocument = async ({
  user,
  residentId,
  file,
  documentType = 'proof_of_residency',
  governmentIdType = null,
  governmentIdTypeOther = null,
  governmentIdPair = null,
  ocr,
  requestId,
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
  if (documentType === 'student_id' && !isMinorAge(resident.birthDate)) {
    throw ApiError.unprocessable('Student ID documents are only accepted for residents under 18.');
  }

  if (governmentIdPair && documentType === 'government_id_front') {
    const pairScreening = await screenUploadedGovernmentIdPair({
      frontFile: governmentIdPair.governmentIdFront,
      backFile: governmentIdPair.governmentIdBack,
      governmentIdType,
      requestId,
    });
    const submittedFront = Buffer.from(await file.arrayBuffer());
    const pairedFront = Buffer.from(await governmentIdPair.governmentIdFront.arrayBuffer());
    if (!submittedFront.equals(pairedFront)) {
      throw ApiError.badRequest('The front upload does not match the submitted government ID pair.');
    }
    return persistGovernmentIdPair({
      user,
      residentId,
      frontFile: governmentIdPair.governmentIdFront,
      backFile: governmentIdPair.governmentIdBack,
      governmentIdType,
      governmentIdTypeOther,
      screeningPair: pairScreening,
    });
  }

  const existing = await repository.listDocumentsByResident(residentId);
  const isGovernmentIdSide = ['government_id_front', 'government_id_back'].includes(documentType);
  const oppositeType = documentType === 'government_id_front' ? 'government_id_back' : 'government_id_front';
  const counterpart = isGovernmentIdSide
    ? existing.find((doc) =>
      doc.verificationStatus === 'pending'
      && doc.documentType === oppositeType
      && String(doc.governmentIdType || '').trim().toLowerCase() === String(documentMeta.governmentIdType || '').trim().toLowerCase(),
    )
    : null;

  // Deterministic pre-screening (file readability only — never authenticity).
  // Screen BEFORE taking the slot or uploading to storage so a rejected upload
  // (e.g. a game/website screenshot with no document indicators) can never
  // overwrite a valid pending document or create a document row that the UI
  // might mistake for an accepted upload.
  let uploadedOcrText = '';
  let screening;
  if (governmentIdPair && isGovernmentIdSide && !counterpart) {
    const pairType = documentType === 'government_id_front' ? 'governmentIdFront' : 'governmentIdBack';
    if (!governmentIdPair[pairType]) {
      throw ApiError.badRequest('The corresponding image is missing from the submitted ID pair.');
    }
    const currentBuffer = Buffer.from(await file.arrayBuffer());
    const pairedCurrentBuffer = Buffer.from(await governmentIdPair[pairType].arrayBuffer());
    if (!currentBuffer.equals(pairedCurrentBuffer)) {
      throw ApiError.badRequest('The selected document does not match the corresponding image in the ID pair.');
    }
    const pairScreening = await screenUploadedGovernmentIdPair({
      frontFile: governmentIdPair.governmentIdFront,
      backFile: governmentIdPair.governmentIdBack,
      governmentIdType,
      requestId,
    });
    screening = pairScreening[documentType === 'government_id_front' ? 'front' : 'back'];
  } else if (documentType === 'student_id') {
    // Student IDs are reviewed by staff; OCR heuristics must never reject one.
    screening = {
      status: SCREENING_STATUS.PENDING_MANUAL_REVIEW,
      reason: SCREENING_REASON.DOCUMENT_NOT_AUTOMATICALLY_SCREENED,
      quality: IMAGE_QUALITY.NOT_ANALYZED,
      ocrDetected: false,
      message: 'Student ID uploaded and awaiting staff review.',
    };
  } else {
    screening = await runScreening({
      file,
      documentType,
      governmentIdType,
      ocr,
      requestId,
      onOcrText: (text) => { uploadedOcrText = text; },
    });
  }

  let crossVerification = screening.crossVerification || null;
  let counterpartScreeningUpdate = null;
  let counterpartScreeningResult = null;

  if (counterpart) {
    try {
      const counterpartFile = await downloadDocumentFile({
        storagePath: counterpart.storagePath,
        fileName: counterpart.fileName,
        mimeType: counterpart.mimeType,
      });
      let counterpartText = '';
      const counterpartScreening = await runScreening({
        file: counterpartFile,
        documentType: counterpart.documentType,
        governmentIdType: counterpart.governmentIdType,
        requestId,
        onOcrText: (text) => { counterpartText = text; },
      });
      const comparison = documentType === 'government_id_front'
        ? crossVerifyGovernmentIdSides(uploadedOcrText, counterpartText)
        : crossVerifyGovernmentIdSides(counterpartText, uploadedOcrText);
      const pair = documentType === 'government_id_front'
        ? applyGovernmentIdCrossVerification(screening, counterpartScreening, comparison)
        : applyGovernmentIdCrossVerification(counterpartScreening, screening, comparison);
      screening = documentType === 'government_id_front' ? pair.front : pair.back;
      const updatedCounterpartScreening = documentType === 'government_id_front' ? pair.back : pair.front;
      counterpartScreeningResult = updatedCounterpartScreening;
      crossVerification = screening.crossVerification;
      counterpartScreeningUpdate = {
        screeningStatus: updatedCounterpartScreening.status,
        screeningReason: screeningReasonForStorage(updatedCounterpartScreening),
        screeningQuality: updatedCounterpartScreening.quality,
        screeningOcrDetected: updatedCounterpartScreening.ocrDetected,
        screeningCheckedAt: new Date().toISOString(),
      };
    } catch {
      crossVerification = {
        status: 'inconclusive',
        comparedFields: [],
        conflictingFields: [],
        message: SCREENING_MESSAGES.ID_SIDE_COMPARISON_INCONCLUSIVE,
      };
      counterpartScreeningUpdate = {
        screeningStatus: SCREENING_STATUS.AUTOMATED_FLAGGED,
        screeningReason: screeningReasonForStorage({
          ...screening,
          crossVerification,
          reason: SCREENING_REASON.ID_SIDE_COMPARISON_INCONCLUSIVE,
          sideReason: screening.sideReason || screening.reason,
        }),
        screeningCheckedAt: new Date().toISOString(),
      };
      counterpartScreeningResult = {
        documentType: counterpart.documentType,
        status: SCREENING_STATUS.AUTOMATED_FLAGGED,
        reason: SCREENING_REASON.ID_SIDE_COMPARISON_INCONCLUSIVE,
        quality: counterpart.screeningQuality || IMAGE_QUALITY.NOT_ANALYZED,
        ocrDetected: false,
        message: SCREENING_MESSAGES.ID_SIDE_COMPARISON_INCONCLUSIVE,
        crossVerification,
      };
      screening = {
        ...screening,
        status: SCREENING_STATUS.AUTOMATED_FLAGGED,
        reason: SCREENING_REASON.ID_SIDE_COMPARISON_INCONCLUSIVE,
        message: SCREENING_MESSAGES.ID_SIDE_COMPARISON_INCONCLUSIVE,
        crossVerification,
      };
      if (requestId) {
        console.info(JSON.stringify({
          event: 'government_id_cross_verification',
          requestId,
          documentSlot: documentType,
          stage: 'counterpart_read',
          status: 'inconclusive',
          reason: SCREENING_REASON.ID_SIDE_COMPARISON_INCONCLUSIVE,
        }));
      }
    }
  }

  if (screening.status === SCREENING_STATUS.AUTOMATED_REJECTED) {
    // Server-side enforcement: an automatically rejected required document MUST
    // NOT be persisted as a submitted document. The frontend blocks this too,
    // but the backend never trusts the frontend.
    throw ApiError.unprocessable(screening.message || 'The uploaded document could not be accepted.', {
      screening: {
        status: screening.status,
        reason: screening.reason,
        quality: screening.quality,
        ocrDetected: screening.ocrDetected,
      },
    });
  }

  // A resident has exactly one current file per slot (ID front, ID back,
  // identity photo, …). If a PENDING file already occupies this slot — the
  // original submission, or an earlier resubmission attempt — replace it: the
  // old private object and its row are removed first so the Health Supervisor
  // only ever reviews the latest document and no stale/duplicate file is left
  // behind. Non-pending (already-reviewed) files are never touched here.
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

  // Persist the screening result WITH the exact file it was computed from. The
  // result is never reused across a replacement: a new upload always re-runs
  // screening on its own buffer and stores a fresh result + timestamp.
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
    screeningStatus: screening.status,
    screeningReason: screeningReasonForStorage(screening),
    screeningQuality: screening.quality,
    screeningOcrDetected: screening.ocrDetected,
    screeningCheckedAt: new Date().toISOString(),
  });
  if (counterpart && counterpartScreeningUpdate) {
    await repository.updateDocument(counterpart.id, counterpartScreeningUpdate);
  }

  return {
    ...document,
    url,
    screening: {
      status: screening.status,
      reason: screening.reason,
      quality: screening.quality,
      ocrDetected: screening.ocrDetected,
      message: screening.message,
      ...(crossVerification ? { crossVerification } : {}),
      ...(screening.crossVerificationMessage
        ? { crossVerificationMessage: screening.crossVerificationMessage }
        : {}),
      ...(counterpartScreeningResult
        ? {
          counterpartScreening: {
            documentType: counterpart.documentType,
            status: counterpartScreeningResult.status,
            reason: counterpartScreeningResult.reason,
            quality: counterpartScreeningResult.quality,
            ocrDetected: counterpartScreeningResult.ocrDetected,
            message: counterpartScreeningResult.message,
            crossVerification: counterpartScreeningResult.crossVerification,
            crossVerificationMessage: crossVerification?.message || '',
          },
        }
        : {}),
    },
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

export const listMyDocuments = async ({ user, residentId }) => {
  if (!SELF_ROLES.includes(user?.role)) throw ApiError.forbidden();
  const resident = await repository.getResident(residentId);
  if (!resident || resident.authUserId !== user.id) {
    throw ApiError.forbidden('You may only view your own documents.');
  }
  const documents = await repository.listDocumentsByResident(residentId);
  return Promise.all(documents.map(async (doc) => ({
    id: doc.id,
    documentType: doc.documentType,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    verificationStatus: doc.verificationStatus,
    rejectionReason: doc.rejectionReason || '',
    createdAt: doc.createdAt,
    url: await getDocumentSignedUrl(doc.storagePath),
  })));
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
      rejectionReason: doc.rejectionReason || '',
      createdAt: doc.createdAt,
      screening: {
        status: doc.screeningStatus || null,
        reason: doc.screeningReason || null,
        quality: doc.screeningQuality || null,
        ocrDetected: Boolean(doc.screeningOcrDetected),
        checkedAt: doc.screeningCheckedAt || null,
      },
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
  assertReviewerScope(user, resident);

  const validation = validateDocumentReview(patch);
  if (validation.error) {
    throw ApiError.badRequest('Invalid review.', validation.error);
  }

  const document = await repository.getDocument(documentId);
  if (!document || document.residentId !== residentId) {
    throw ApiError.notFound('Document not found.');
  }
  if (document.documentType === 'student_id' && !isMinorAge(resident.birthDate)) {
    throw ApiError.conflict('Student ID verification is only available for minor residents.');
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
  screenUploadedDocument,
  screenUploadedGovernmentIdPair,
  uploadResidentDocument,
  getMyDocument,
  listMyDocuments,
  getResidentDocument,
  reviewResidentDocument,
  deleteResidentDocument,
};
