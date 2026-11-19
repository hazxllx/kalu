import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { FEATURE_ROLES } from '../config/roles.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/scheduleRequests.controller.js';

const router = Router();
router.use(authenticate);
router.post('/', authorize(FEATURE_ROLES.residentSelf), asyncHandler(controller.submit));
router.get('/', authorize(['health_supervisor', 'rhu_personnel', ...FEATURE_ROLES.residentSelf]), asyncHandler(controller.list));
router.put('/:id', authorize(['health_supervisor', 'rhu_personnel']), asyncHandler(controller.decide));
export default router;
