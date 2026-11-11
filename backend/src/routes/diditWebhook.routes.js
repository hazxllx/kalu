import { Router } from 'express';

import diditService from '../services/didit.service.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router();

// Public by design: Didit authenticates this endpoint using its signed event.
router.post('/', asyncHandler(async (req, res) => {
  const result = await diditService.handleWebhook({ body: req.body, headers: req.headers });
  res.status(200).json(result);
}));

export default router;
