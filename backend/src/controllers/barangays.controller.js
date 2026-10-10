/**
 * Admin Barangay Management endpoints (admin-only). Thin controllers: read the
 * request, delegate to the service, return the standard envelope.
 */
import * as barangaysService from '../services/barangays.service.js';
import { sendData } from '../utils/apiResponse.js';

export const listBarangays = async (req, res) => {
  const result = await barangaysService.listBarangays({
    q: req.query.q,
    municipalityId: req.query.municipalityId,
    status: req.query.status,
  });
  sendData(res, result);
};

export const getBarangayOptions = async (_req, res) => {
  sendData(res, await barangaysService.getBarangayOptions());
};

export const getBarangay = async (req, res) => {
  sendData(res, await barangaysService.getBarangay({ id: req.params.id }));
};

export const createBarangay = async (req, res) => {
  const barangay = await barangaysService.createBarangay({
    actorId: req.user.id,
    input: req.body?.barangay || req.body || {},
  });
  sendData(res, { barangay }, { status: 201 });
};

export const updateBarangay = async (req, res) => {
  const barangay = await barangaysService.updateBarangay({
    id: req.params.id,
    actorId: req.user.id,
    patch: req.body?.barangay || req.body || {},
  });
  sendData(res, { barangay });
};

export const deleteBarangay = async (req, res) => {
  const result = await barangaysService.deleteBarangay({
    id: req.params.id,
    actorId: req.user.id,
  });
  sendData(res, result);
};

export default {
  listBarangays,
  getBarangayOptions,
  getBarangay,
  createBarangay,
  updateBarangay,
  deleteBarangay,
};
