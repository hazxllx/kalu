import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import * as advisoriesController from '../controllers/advisories.controller.js';
import { validateAdvisory, validateId, validateStatus } from '../validators/advisories.validators.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(advisoriesController.listActive));

router.use(authenticate);
router.get('/admin', authorize('admin'), asyncHandler(advisoriesController.listAll));
router.post('/', authorize('admin'), validate(validateAdvisory), asyncHandler(advisoriesController.create));
router.put('/:id', authorize('admin'), validate(validateId, 'params'), validate(validateAdvisory), asyncHandler(advisoriesController.update));
router.patch('/:id/status', authorize('admin'), validate(validateId, 'params'), validate(validateStatus), asyncHandler(advisoriesController.setStatus));
router.delete('/:id', authorize('admin'), validate(validateId, 'params'), asyncHandler(advisoriesController.remove));

export default router;
