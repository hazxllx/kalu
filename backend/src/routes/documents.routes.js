// backend/src/routes/documents.routes.js
/**
 * Resident identity document upload, rule-based pre-screening, and verification review routes.
 *
 * Mounted directly under `/api` (`/api/resident-documents/...` and
 * `/api/verifications/:residentId/documents/...`).
 *
 * Request pipeline:
 *   route -> authenticate -> authorize(roles) -> [upload middleware] -> [validate] -> controller -> service -> Supabase Storage + DB
 *
 * Handles document upload for resident registration verification and clinical
 * identity checks. Includes non-persistent pre-screening, persistent multipart
 * upload into the verification queue, resident self-inspection/deletion of pending
 * uploads, and barangay-scoped staff verification review. All uploaded files are
 * validated for MIME type, size, and binary file-signature authenticity, while OCR
 * results are cached server-side for cross-checking without exposing raw text.
 */
import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import uploadDocumentFile, {
  uploadGovernmentIdPairFiles,
  uploadResidentDocumentFiles,
} from '../middleware/uploadDocumentFile.js';
import asyncHandler from '../utils/asyncHandler.js';
import { FEATURE_ROLES } from '../config/roles.js';
import * as documentsController from '../controllers/documents.controller.js';
import { validateDocumentUpload, validateDocumentReview } from '../validators/documents.validators.js';

const router = Router();

// POST /api/resident-documents/screen — Pre-screen a single document WITHOUT storing it (registration Step 3).
// Runs deterministic rule-based screening via `uploadDocumentFile` multipart input so the resident sees
// immediate feedback before submission; no file is persisted.
router.post(
  '/resident-documents/screen',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  uploadDocumentFile,
  asyncHandler(documentsController.screenResidentDocument),
);

// POST /api/resident-documents/screen-id-pair — Pre-screen front and back government ID images together (`uploadGovernmentIdPairFiles`).
// OCR text remains in server memory; returns only advisory per-side results and value-free comparison metadata.
router.post(
  '/resident-documents/screen-id-pair',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  uploadGovernmentIdPairFiles,
  asyncHandler(documentsController.screenResidentGovernmentIdPair),
);

// POST /api/resident-documents/upload — Persist a resident registration document (proof of residency, government ID
// front/back, or identity photo) via `uploadResidentDocumentFiles` and `validateDocumentUpload`.
router.post(
  '/resident-documents/upload',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  uploadResidentDocumentFiles,
  validate((body, req) => validateDocumentUpload({ ...body, file: req.file }), 'body'),
  asyncHandler(documentsController.uploadResidentDocument),
);

// GET /api/resident-documents/me — Retrieve the authenticated resident's primary/latest verification document summary.
router.get(
  '/resident-documents/me',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  asyncHandler(documentsController.getMyDocument),
);

// GET /api/resident-documents/me/list — List all verification documents uploaded by the authenticated resident.
router.get(
  '/resident-documents/me/list',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  asyncHandler(documentsController.listMyDocuments),
);

// DELETE /api/resident-documents/:id — Delete the authenticated resident's own pending document (`:id` param).
router.delete(
  '/resident-documents/:id',
  authenticate,
  authorize(FEATURE_ROLES.residentSelf),
  asyncHandler(documentsController.deleteResidentDocument),
);

// GET /api/verifications/:residentId/documents — Staff: list a resident's uploaded documents with signed URLs (`FEATURE_ROLES.verification`; barangay-scoped in service).
router.get(
  '/verifications/:residentId/documents',
  authenticate,
  authorize(FEATURE_ROLES.verification),
  asyncHandler(documentsController.listResidentDocuments),
);

// GET /api/verifications/:residentId/documents/:documentId — Staff: retrieve metadata and signed URL for a single resident document (scope-enforced in service).
router.get(
  '/verifications/:residentId/documents/:documentId',
  authenticate,
  authorize(FEATURE_ROLES.verification),
  asyncHandler(documentsController.getResidentDocument),
);

// PATCH /api/verifications/:residentId/documents/:documentId/review — Staff: approve or reject a resident document (`validateDocumentReview` on `req.body`).
router.patch(
  '/verifications/:residentId/documents/:documentId/review',
  authenticate,
  authorize(FEATURE_ROLES.verification),
  validate(validateDocumentReview),
  asyncHandler(documentsController.reviewResidentDocument),
);

export default router;
