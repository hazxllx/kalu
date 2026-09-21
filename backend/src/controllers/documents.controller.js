import * as documentsService from '../services/documents.service.js';
import ApiError from '../utils/apiError.js';
import { sendCreated, sendData, sendNoContent } from '../utils/apiResponse.js';

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
  uploadResidentDocument,
  getMyDocument,
  getResidentDocument,
  reviewResidentDocument,
  deleteResidentDocument,
};
