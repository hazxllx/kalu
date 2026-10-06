import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { uploadOfficialLogo } from '../middleware/uploadOfficialLogo.js';
import { FEATURE_ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/documentBranding.controller.js';

const router = Router();
const BRANDING_USER_ROLES = [
  'admin',
  'mho',
  'phn',
  'rhu_personnel',
  'health_supervisor',
  'bhw',
];

router.use(authenticate);

router.get('/admin/logos', authorize(FEATURE_ROLES.system), asyncHandler(controller.getAdminLogos));
router.post(
  '/admin/logos/:logoType',
  authorize(FEATURE_ROLES.system),
  uploadOfficialLogo,
  asyncHandler(controller.uploadLogo),
);
router.delete('/admin/logos/:logoType', authorize(FEATURE_ROLES.system), asyncHandler(controller.removeLogo));
router.get('/for/:documentType', authorize(BRANDING_USER_ROLES), asyncHandler(controller.getForDocument));

export default router;
