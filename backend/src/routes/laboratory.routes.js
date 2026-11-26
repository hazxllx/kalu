// backend/src/routes/laboratory.routes.js
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import { uploadDocumentFile } from '../middleware/uploadDocumentFile.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendData, sendCreated } from '../utils/apiResponse.js';
import * as laboratory from '../services/laboratory.service.js';

const router = Router();
router.use(authenticate, resolveBarangayScope);
const readers = authorize(['resident', 'health_supervisor', 'phn', 'mho'], {
  permission: (req) => req.user.role === 'resident' ? [] : ['consultation.history.view'],
});
router.get('/', readers, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store, private');
  return sendData(res, await laboratory.list({ user: req.user, residentId: req.query.residentId }));
}));
router.post('/', authorize(['resident']), uploadDocumentFile, asyncHandler(async (req, res) =>
  sendCreated(res, await laboratory.upload({ user: req.user, category: req.body.category, file: req.file }))));
router.get('/:id/file', readers, asyncHandler(async (req, res) => {
  const { file, document } = await laboratory.download({ user: req.user, id: req.params.id });
  res.set({ 'Content-Type': document.contentType, 'Content-Length': String(document.sizeBytes),
    'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Content-Disposition': `inline; filename="laboratory.${document.contentType === 'application/pdf' ? 'pdf' : document.contentType === 'image/png' ? 'png' : 'jpg'}"` });
  return res.send(Buffer.from(await file.arrayBuffer()));
}));
router.patch('/:id', authorize(['health_supervisor', 'phn', 'mho'], {
  allPermissions: ['consultation.records.update', 'consultation.history.view'],
}),
  asyncHandler(async (req, res) => sendData(res, await laboratory.linkConsultation({ user: req.user,
    id: req.params.id, consultationId: req.body?.consultationId }))));
export default router;
