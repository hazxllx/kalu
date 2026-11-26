// backend/src/routes/calendarActivities.routes.js
import { Router } from 'express';
import { FEATURE_ROLES } from '../config/roles.js';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import validate from '../middleware/validate.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/calendarActivities.controller.js';
import {
  activityIdValidator, createActivityValidator, listActivitiesValidator, updateActivityValidator,
} from '../validators/calendarActivities.validators.js';

const router = Router();
router.use(authenticate, authorize(FEATURE_ROLES.calendarActivities));

router.get('/', validate(listActivitiesValidator, 'query'), asyncHandler(controller.list));
router.post('/', validate(createActivityValidator), asyncHandler(controller.create));
router.patch('/:id', validate(activityIdValidator, 'params'), validate(updateActivityValidator), asyncHandler(controller.update));
router.delete('/:id', validate(activityIdValidator, 'params'), asyncHandler(controller.remove));

export default router;
