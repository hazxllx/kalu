import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import asyncHandler from './asyncHandler.js';
import notImplemented from './notImplemented.js';

/**
 * Builds a standard REST resource router with authentication + role-based
 * authorization already wired in, and handlers that report 501 until the
 * verified schema is connected (see `notImplemented`).
 *
 * This enforces the real security pipeline for every resource today —
 *   request -> authenticate -> authorize(roles) -> controller
 * — without faking any database result. When a resource's schema is verified,
 * replace this factory call in the route index with a dedicated
 * routes/controller/service trio for that resource.
 *
 * @param {string} name  resource label used in the 501 message
 * @param {object} opts
 * @param {string[]} opts.readRoles   roles allowed to list/read
 * @param {string[]} opts.writeRoles  roles allowed to create/update/delete
 *                                     (defaults to readRoles)
 */
export const createResourceRouter = (name, { readRoles = [], writeRoles } = {}) => {
  const router = Router();
  const write = writeRoles || readRoles;

  router.get('/', authenticate, authorize(readRoles), asyncHandler(notImplemented(`${name}.list`)));
  router.get('/:id', authenticate, authorize(readRoles), asyncHandler(notImplemented(`${name}.get`)));
  router.post('/', authenticate, authorize(write), asyncHandler(notImplemented(`${name}.create`)));
  router.put('/:id', authenticate, authorize(write), asyncHandler(notImplemented(`${name}.update`)));
  router.delete('/:id', authenticate, authorize(write), asyncHandler(notImplemented(`${name}.remove`)));

  return router;
};

export default createResourceRouter;
