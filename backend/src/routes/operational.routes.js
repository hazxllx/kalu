import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/operational.controller.js';

const router = Router();
const kinds = ['followups', 'tcl', 'maternal', 'immunizations', 'notifications'];
const staff = ['admin', 'mho', 'phn', 'health_supervisor'];
router.use(authenticate, resolveBarangayScope);

// The controller/service are generic over the record `kind`. The literal path
// segment is the source of truth for the kind, so bind it onto `req.params.kind`
// before the handler runs (the path has no `:kind` placeholder to populate it).
const withKind = (kind) => (req, _res, next) => {
  req.params.kind = kind;
  next();
};

for (const kind of kinds) {
  const roles = kind === 'notifications' ? ['admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw', 'resident', 'resident-limited'] : staff;
  router.get(`/${kind}`, withKind(kind), authorize(roles), asyncHandler(controller.list));
  if (kind === 'notifications') {
    // Recipients may mark their own notifications read.
    router.put(`/${kind}/:id`, withKind(kind), authorize(roles), asyncHandler(controller.update));
  } else {
    router.post(`/${kind}`, withKind(kind), authorize(staff), asyncHandler(controller.create));
    router.put(`/${kind}/:id`, withKind(kind), authorize(staff), asyncHandler(controller.update));
  }
}

export default router;