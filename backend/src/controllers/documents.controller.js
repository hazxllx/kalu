import * as documentsService from '../services/documents.service.js';
import ApiError from '../utils/apiError.js';
import { sendCreated, sendData, sendNoContent } from '../utils/apiResponse.js';

/**
 * Screen an uploaded document WITHOUT persisting it. Used by resident
 * registration Step 3 to show the deterministic automated result before the
 * registration is submitted. The result is advisory (a hard rejection blocks
 * submission; flagged/manual-review may proceed). No file is stored.
 */
export const screenResidentDocument = async (req, res) => {
  if (!req.file) {
    throw ApiError.badRequest('Please select a document to check.');
  }
  const documentType = req.body?.documentType || 'proof_of_residency';
  const governmentIdType = req.body?.governmentIdType || null;
  const screening = await documentsService.screenUploadedDocument({
    file: req.file,
    documentType,
    governmentIdType,
    requestId: req.requestId,
  });
  sendData(res, {
    screening: {
      status: screening.status,
      reason: screening.reason,
      quality: screening.quality,
      ocrDetected: screening.ocrDetected,
      message: screening.message,
    },
  });
};

export const screenResidentGovernmentIdPair = async (req, res) => {
  const pair = req.governmentIdPair || {};
  const screening = await documentsService.screenUploadedGovernmentIdPair({
    frontFile: pair.governmentIdFront,
    backFile: pair.governmentIdBack,
    governmentIdType: req.body?.governmentIdType,
    requestId: req.requestId,
  });
  sendData(res, {
    governmentIdFront: {
      status: screening.front.status,
      reason: screening.front.reason,
      quality: screening.front.quality,
      ocrDetected: screening.front.ocrDetected,
      message: screening.front.message,
      crossVerification: screening.front.crossVerification,
      crossVerificationMessage: screening.front.crossVerificationMessage,
    },
    governmentIdBack: {
      status: screening.back.status,
      reason: screening.back.reason,
      quality: screening.back.quality,
      ocrDetected: screening.back.ocrDetected,
      message: screening.back.message,
      crossVerification: screening.back.crossVerification,
      crossVerificationMessage: screening.back.crossVerificationMessage,
    },
    crossVerification: screening.front.crossVerification,
  });
};

export const uploadResidentDocument = async (req, res) => {
  const file = req.file;
  const body = req.body || {};
  const documentType = body.documentType || 'proof_of_residency';
  const residentId = body.residentId;
  const governmentIdType = body.governmentIdType;
  const governmentIdTypeOther = body.governmentIdTypeOther;

  if (!residentId) {
    throw ApiError.badRequest('Resident ID is required.');
  }

  const result = await documentsService.uploadResidentDocument({
    user: req.user,
    residentId,
    file,
    documentType,
    governmentIdType,
    governmentIdTypeOther,
    governmentIdPair: req.governmentIdPair,
    requestId: req.requestId,
  });

  sendCreated(res, { document: result });
};

export const getMyDocument = async (req, res) => {
  const residentId = req.query?.residentId || req.params?.residentId;
  if (!residentId) {
    throw ApiError.badRequest('Resident ID is required.');
  }

  const result = await documentsService.getMyDocument({
    user: req.user,
    residentId,
  });

  sendData(res, { document: result });
};

export const listMyDocuments = async (req, res) => {
  const residentId = req.query?.residentId;
  if (!residentId) throw ApiError.badRequest('Resident ID is required.');
  const documents = await documentsService.listMyDocuments({ user: req.user, residentId });
  sendData(res, { documents });
};

export const listResidentDocuments = async (req, res) => {
  const { residentId } = req.params;
  const documents = await documentsService.listResidentDocuments({ user: req.user, residentId });
  sendData(res, { documents });
};

export const getResidentDocument = async (req, res) => {
  const { residentId, documentId } = req.params;

  const result = await documentsService.getResidentDocument({
    user: req.user,
    residentId,
    documentId,
  });

  sendData(res, { document: result });
};

export const reviewResidentDocument = async (req, res) => {
  const { residentId, documentId } = req.params;
  const patch = req.body || {};

  const result = await documentsService.reviewResidentDocument({
    user: req.user,
    residentId,
    documentId,
    patch,
  });

  sendData(res, { document: result });
};

export const deleteResidentDocument = async (req, res) => {
  const { id } = req.params;
  const residentId = req.body?.residentId;

  if (!residentId) {
    throw ApiError.badRequest('Resident ID is required.');
  }

  await documentsService.deleteResidentDocument({
    user: req.user,
    residentId,
    documentId: id,
  });

  sendNoContent(res);
};

export default {
  screenResidentDocument,
  screenResidentGovernmentIdPair,
  uploadResidentDocument,
  getMyDocument,
  listMyDocuments,
  listResidentDocuments,
  getResidentDocument,
  reviewResidentDocument,
  deleteResidentDocument,
};
