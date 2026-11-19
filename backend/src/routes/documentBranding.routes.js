/**
 * Official document branding routes (`/api/document-branding`).
 *
 * Request pipeline:
 *   route -> authenticate -> authorize(roles) -> [uploadOfficialLogo] -> controller -> service -> Supabase Storage + DB
 *
 * System administrators upload and manage official municipal/RHU logos displayed
 * on generated medical certificates, referrals, and clinical reports. Authorized
 * clinical and administrative staff retrieve resolved branding metadata for
 * document rendering. Logo uploads are screened for MIME type, file size, and
 * file signature authenticity.
 */
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { uploadOfficialLogo } from '../middleware/uploadOfficialLogo.js';
import { FEATURE_ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/documentBranding.controller.js';

const router = Router();

// Staff roles allowed to read official branding assets when rendering printable clinical documents.
const BRANDING_USER_ROLES = [
  'admin',
  'mho',
  'phn',
  'rhu_personnel',
  'health_supervisor',
  'bhw',
];

// All branding endpoints require an authenticated active profile.
router.use(authenticate);

// GET /api/document-branding/admin/logos — List configured official logo slots and metadata (`FEATURE_ROLES.system`).
router.get('/admin/logos', authorize(FEATURE_ROLES.system), asyncHandler(controller.getAdminLogos));

// POST /api/document-branding/admin/logos/:logoType — Upload or replace an official logo for `:logoType` (`uploadOfficialLogo` multipart file).
router.post(
  '/admin/logos/:logoType',
  authorize(FEATURE_ROLES.system),
  uploadOfficialLogo,
  asyncHandler(controller.uploadLogo),
);

// DELETE /api/document-branding/admin/logos/:logoType — Delete the configured official logo for `:logoType` (`FEATURE_ROLES.system`).
router.delete('/admin/logos/:logoType', authorize(FEATURE_ROLES.system), asyncHandler(controller.removeLogo));

// GET /api/document-branding/for/:documentType — Retrieve resolved branding header/logo assets for `:documentType` (`BRANDING_USER_ROLES`).
router.get('/for/:documentType', authorize(BRANDING_USER_ROLES), asyncHandler(controller.getForDocument));

export default router;
