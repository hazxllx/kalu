// backend/src/routes/operational.routes.js
/**
 * Operational tracking routes (follow-ups, TCL forms, maternal records/visits,
 * immunizations, and user notifications).
 *
 * Role in KALUSAGAP:
 * Exposes generic resident-scoped CRUD endpoints across core community health
 * operational tables, plus recipient-scoped in-app notification state updates.
 *
 * Architectural pipeline:
 *   route -> authenticate -> resolveBarangayScope -> withKind(kind)
 *         -> authorize(roles, dynamicPermission) -> [operationalIdempotency]
 *         -> operational.controller -> operational.service -> Supabase
 *
 * Scope & security:
 * Clinical/operational kinds are restricted to `staff` (`admin`, `mho`, `phn`,
 * `health_supervisor`) and scoped to the caller's assigned barangay (or
 * municipality-wide for MHO/PHN/Admin). Notifications are additionally open to
 * `rhu_personnel`, `bhw`, `resident`, and `resident-limited`, strictly scoped
 * by the service to the authenticated recipient's own rows.
 */
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import authorize from '../middleware/authorize.js';
import { createIdempotencyMiddleware } from '../middleware/idempotency.js';
import { resolveBarangayScope } from '../middleware/barangayScope.js';
import ApiError from '../utils/apiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as controller from '../controllers/operational.controller.js';
import * as service from '../services/operational.service.js';

const router = Router();
const kinds = ['followups', 'tcl', 'maternal', 'maternalvisits', 'immunizations', 'notifications'];
const staff = ['admin', 'mho', 'phn', 'health_supervisor'];
router.use(authenticate, resolveBarangayScope);

// Durable `Idempotency-Key` middleware for offline-capable POST/PUT writes.
// Before replaying a cached response, `validateReplay` re-verifies that the
// current caller still has geography/ownership scope over the cached record ID.
const operationalIdempotency = createIdempotencyMiddleware({
  durable: true,
  validateReplay: async (req, responseBody) => {
    const recordId = responseBody?.data?.record?.id ?? responseBody?.record?.id;
    if (!recordId) throw ApiError.notFound('Operational record not found.');
    await service.verifyRecordScope({
      user: req.user,
      kind: req.params.kind,
      id: recordId,
    });
  },
});

// The controller/service are generic over the record `kind`. The literal path
// segment is the source of truth for the kind, so bind it onto `req.params.kind`
// before the handler runs (the path has no `:kind` placeholder to populate it).
const withKind = (kind) => (req, _res, next) => {
  req.params.kind = kind;
  next();
};

/**
 * Resolves granular RBAC permission IDs when `req.params.kind === 'followups'`.
 * Returns an empty array for all other operational kinds so role-level checks govern.
 * - GET  -> `followups.view`
 * - POST -> `followups.create`
 * - PUT  -> `followups.complete` when transitioning `status` to `Completed` or `Missed`;
 *           otherwise `followups.edit`.
 *
 * @param {string} method - HTTP verb (`GET`, `POST`, or `PUT`).
 * @returns {Function} Request-aware permission resolver for `authorize`.
 */
export const followUpPermission = (method) => (req) => {
  if (req.params.kind !== 'followups') return [];
  if (method === 'GET') return ['followups.view'];
  if (method === 'POST') return ['followups.create'];
  const payload = req.body?.record || req.body || {};
  if (['Completed', 'Missed'].includes(String(payload.status || ''))) {
    return ['followups.complete'];
  }
  return ['followups.edit'];
};

// Dynamically mount routes for each operational `kind`:
// - GET    /:kind           : Lists scoped records (query filters: residentId, status, pagination).
// - PUT    /notifications/read-all : Marks all caller notifications read (`controller.markAllRead`).
// - PUT    /notifications/:id      : Updates read state of notification `:id` (`controller.update`).
// - POST   /:kind           : Creates a clinical/operational record from `req.body` (idempotent).
// - PUT    /:kind/:id       : Updates record `:id` from `req.body` (idempotent).
// - DELETE /maternal/:id    : Deletes maternal record `:id` (`controller.remove`).
for (const kind of kinds) {
  const roles = kind === 'notifications' ? ['admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw', 'resident', 'resident-limited'] : staff;
  router.get(
    `/${kind}`,
    withKind(kind),
    authorize(roles, { permission: followUpPermission('GET') }),
    asyncHandler(controller.list),
  );
  if (kind === 'notifications') {
    // Recipients may mark all of their own notifications read in one request.
    // Registered before the `:id` route so "read-all" is not captured as an id.
    router.put(`/${kind}/read-all`, withKind(kind), authorize(roles), asyncHandler(controller.markAllRead));
    // Recipients may mark their own notifications read.
    router.put(`/${kind}/:id`, withKind(kind), authorize(roles), asyncHandler(controller.update));
  } else {
    router.post(
      `/${kind}`,
      withKind(kind),
      authorize(staff, { permission: followUpPermission('POST') }),
      operationalIdempotency,
      asyncHandler(controller.create),
    );
    router.put(
      `/${kind}/:id`,
      withKind(kind),
      authorize(staff, { permission: followUpPermission('PUT') }),
      operationalIdempotency,
      asyncHandler(controller.update),
    );
    // Maternal records support deletion (spec PART 13). Other operational kinds
    // keep their append-only history, so no DELETE route is exposed for them.
    if (kind === 'maternal') {
      router.delete(`/${kind}/:id`, withKind(kind), authorize(staff), asyncHandler(controller.remove));
    }
  }
}

export default router;
