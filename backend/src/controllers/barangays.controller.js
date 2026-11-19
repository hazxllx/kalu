/**
 * Admin Barangay Management endpoints (admin-only). Thin controllers: read the
 * request, delegate to the service, return the standard envelope.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   route -> [authenticate -> authorize(admin)] -> controller -> barangays.service -> repository / Supabase
 * Also exposes `listPublicBarangays` for unauthenticated resident registration dropdowns.
 *
 * Barangays are status-managed (Active/Inactive); the permanent-delete
 * controller was removed with the delete endpoint.
 */
import * as barangaysService from '../services/barangays.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * Lists active barangays available for public selection (e.g. resident self-registration).
 * Delegates to `barangaysService.listPublicBarangays` and returns `200 OK` via `sendData`.
 */
export const listPublicBarangays = async (_req, res) => {
  sendData(res, await barangaysService.listPublicBarangays());
};

/**
 * Lists barangays for administrative management with optional `q`, `municipalityId`,
 * and `status` filters from `req.query`. Calls `barangaysService.listBarangays`
 * and returns `200 OK` via `sendData`.
 */
export const listBarangays = async (req, res) => {
  const result = await barangaysService.listBarangays({
    q: req.query.q,
    municipalityId: req.query.municipalityId,
    status: req.query.status,
  });
  sendData(res, result);
};

/**
 * Returns lightweight barangay option items for staff/admin select controls.
 * Calls `barangaysService.getBarangayOptions` and returns `200 OK` via `sendData`.
 */
export const getBarangayOptions = async (_req, res) => {
  sendData(res, await barangaysService.getBarangayOptions());
};

/**
 * Retrieves a single barangay record by `req.params.id` via `barangaysService.getBarangay`
 * and returns `200 OK` via `sendData`.
 */
export const getBarangay = async (req, res) => {
  sendData(res, await barangaysService.getBarangay({ id: req.params.id }));
};

/**
 * Creates a new barangay record using `req.body.barangay` (or `req.body`) and
 * `req.user.id` for audit attribution. Calls `barangaysService.createBarangay`
 * and responds with `{ barangay }` (`201 Created`).
 */
export const createBarangay = async (req, res) => {
  const barangay = await barangaysService.createBarangay({
    actorId: req.user.id,
    input: req.body?.barangay || req.body || {},
  });
  sendData(res, { barangay }, { status: 201 });
};

/**
 * Updates barangay details (`req.params.id`) with `req.body.barangay` (or `req.body`),
 * recording `req.user.id` as the actor. Calls `barangaysService.updateBarangay`
 * and returns `{ barangay }` (`200 OK`).
 */
export const updateBarangay = async (req, res) => {
  const barangay = await barangaysService.updateBarangay({
    id: req.params.id,
    actorId: req.user.id,
    patch: req.body?.barangay || req.body || {},
  });
  sendData(res, { barangay });
};

// Dedicated Active/Inactive status change (replaces delete-based management).
/**
 * Toggles a barangay's operational status (`Active` / `Inactive`) via `req.params.id`
 * and `req.body.status` (replaces destructive deletion), audited under `req.user.id`.
 * Calls `barangaysService.updateBarangayStatus` and returns `{ barangay }` (`200 OK`).
 */
export const updateBarangayStatus = async (req, res) => {
  const barangay = await barangaysService.updateBarangayStatus({
    id: req.params.id,
    actorId: req.user.id,
    status: req.body?.status,
  });
  sendData(res, { barangay });
};

export default {
  listPublicBarangays,
  listBarangays,
  getBarangayOptions,
  getBarangay,
  createBarangay,
  updateBarangay,
  updateBarangayStatus,
};
