// backend/src/controllers/documents.controller.js
import * as documentsService from '../services/documents.service.js';
import ApiError from '../utils/apiError.js';
import { sendCreated, sendData, sendNoContent } from '../utils/apiResponse.js';

/**
 * Resident Identity & Residency Verification Documents Controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   route -> [authenticate -> authorize] -> [multipart upload middleware] -> controller -> documents.service -> Supabase Storage & repository
 *
 * Supports three workflows:
 * 1. Pre-submission automated screening (`screenResidentDocument` and
 *    `screenResidentGovernmentIdPair`) during registration Step 3 — runs quality,
 *    OCR, and front/back ID cross-verification without storing files.
 * 2. Resident self-service document upload, viewing, listing, and deletion
 *    (`uploadResidentDocument`, `getMyDocument`, `listMyDocuments`, `deleteResidentDocument`).
 * 3. Staff verification review (`listResidentDocuments`, `getResidentDocument`,
 *    `reviewResidentDocument`) scoped to the reviewer's barangay/municipality.
 */

/**
 * Screen an uploaded document WITHOUT persisting it. Used by resident
 * registration Step 3 to show the deterministic automated result before the
 * registration is submitted. The result is advisory (a hard rejection blocks
 * submission; flagged/manual-review may proceed). No file is stored.
 *
 * Requires `req.file` (`400` if missing), reads optional `documentType`
 * (default `'proof_of_residency'`) and `governmentIdType` from `req.body`,
 * calls `documentsService.screenUploadedDocument`, and returns `{ screening }` (`200 OK`).
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

/**
 * Screens a front/back government ID upload pair (`req.governmentIdPair`) without
 * persisting either file, evaluating image quality, OCR presence, and front-to-back
 * cross-verification for `req.body.governmentIdType`.
 * Calls `documentsService.screenUploadedGovernmentIdPair` and returns per-side
 * screening summaries plus `crossVerification` (`200 OK` via `sendData`).
 */
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

/**
 * Uploads and persists a resident verification document (`req.file` or
 * `req.governmentIdPair`) for `req.body.residentId` (`400` if missing).
 * Passes `req.user`, `documentType`, `governmentIdType`, `governmentIdTypeOther`,
 * and `req.requestId` to `documentsService.uploadResidentDocument`, responding
 * with `{ document }` (`201 Created` via `sendCreated`).
 */
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

/**
 * Retrieves the authenticated resident's primary verification document for
 * `residentId` (from `req.query.residentId` or `req.params.residentId`; `400` if missing).
 * Ownership is verified in `documentsService.getMyDocument`; returns `{ document }` (`200 OK`).
 */
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

/**
 * Lists all verification documents belonging to the authenticated resident for
 * `req.query.residentId` (`400` if missing) via `documentsService.listMyDocuments`.
 * Returns `{ documents }` (`200 OK`).
 */
export const listMyDocuments = async (req, res) => {
  const residentId = req.query?.residentId;
  if (!residentId) throw ApiError.badRequest('Resident ID is required.');
  const documents = await documentsService.listMyDocuments({ user: req.user, residentId });
  sendData(res, { documents });
};

/**
 * Lists all submitted verification documents for `req.params.residentId` on behalf
 * of authorized health/admin staff (`req.user`). Calls `documentsService.listResidentDocuments`
 * and returns `{ documents }` (`200 OK`).
 */
export const listResidentDocuments = async (req, res) => {
  const { residentId } = req.params;
  const documents = await documentsService.listResidentDocuments({ user: req.user, residentId });
  sendData(res, { documents });
};

/**
 * Retrieves metadata and signed access details for a single resident document
 * (`req.params.residentId`, `req.params.documentId`) for authorized staff (`req.user`).
 * Calls `documentsService.getResidentDocument` and returns `{ document }` (`200 OK`).
 */
export const getResidentDocument = async (req, res) => {
  const { residentId, documentId } = req.params;

  const result = await documentsService.getResidentDocument({
    user: req.user,
    residentId,
    documentId,
  });

  sendData(res, { document: result });
};

/**
 * Records a staff verification review decision/notes (`req.body`) on document
 * `req.params.documentId` belonging to `req.params.residentId`.
 * Calls `documentsService.reviewResidentDocument` and returns `{ document }` (`200 OK`).
 */
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

/**
 * Deletes resident document `req.params.id` for `req.body.residentId` (`400` if missing)
 * after verifying ownership/permissions for `req.user` in `documentsService.deleteResidentDocument`.
 * Responds with `204 No Content` via `sendNoContent`.
 */
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
