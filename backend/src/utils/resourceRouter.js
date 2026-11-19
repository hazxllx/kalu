import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import asyncHandler from './asyncHandler.js';
import notImplemented from './notImplemented.js';

/**
 * @module utils/resourceRouter
 * @description Factory for scaffolded REST resource routers with active authentication and RBAC.
 *
 * Architectural layer:
 *   `route -> authenticate -> authorize(roles) -> controller (notImplemented) -> errorHandler`
 *
 * Enforces the production KALUSAGAP security pipeline (`authenticate` + `authorize`)
 * on every CRUD endpoint immediately, while delegating execution to `notImplemented`
 * (`501 Not Implemented`) until the resource's Supabase tables and repository/service
 * layers are verified. Once a resource schema is confirmed, replace its `createResourceRouter`
 * mount in the route index with dedicated `routes -> controller -> service` modules.
 */

/**
 * Builds an Express `Router` exposing standard CRUD endpoints (`GET /`, `GET /:id`,
 * `POST /`, `PUT /:id`, `DELETE /:id`) guarded by JWT authentication and role-based
 * access control.
 *
 * @param {string} name - Resource identifier prefixed onto 501 action labels (e.g., `'immunizations'`).
 * @param {Object} [opts={}] - Role configuration for read and write operations.
 * @param {Array<string>} [opts.readRoles=[]] - Roles permitted on `GET /` and `GET /:id`.
 * @param {Array<string>} [opts.writeRoles] - Roles permitted on `POST /`, `PUT /:id`, and `DELETE /:id` (defaults to `readRoles` when omitted).
 * @returns {Object} Configured Express `Router` instance.
 */
export const createResourceRouter = (name, { readRoles = [], writeRoles } = {}) => {
  const router = Router();
  // Fall back to readRoles when no separate write-role list is provided.
  const write = writeRoles || readRoles;

  router.get('/', authenticate, authorize(readRoles), asyncHandler(notImplemented(`${name}.list`)));
  router.get('/:id', authenticate, authorize(readRoles), asyncHandler(notImplemented(`${name}.get`)));
  router.post('/', authenticate, authorize(write), asyncHandler(notImplemented(`${name}.create`)));
  router.put('/:id', authenticate, authorize(write), asyncHandler(notImplemented(`${name}.update`)));
  router.delete('/:id', authenticate, authorize(write), asyncHandler(notImplemented(`${name}.remove`)));

  return router;
};

export default createResourceRouter;
