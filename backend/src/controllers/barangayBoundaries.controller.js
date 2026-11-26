// backend/src/controllers/barangayBoundaries.controller.js
import { assignedBarangay, BARANGAY_SCOPED_ROLES } from '../config/scope.js';
import { getBarangayBoundaries as loadBoundaries } from '../services/barangayBoundaries.service.js';
import ApiError from '../utils/apiError.js';
import { sendData } from '../utils/apiResponse.js';

export const createBarangayBoundariesController = ({ service = loadBoundaries, ...dependencies } = {}) =>
  async (req, res) => {
    const assigned = assignedBarangay(req.user);
    if (BARANGAY_SCOPED_ROLES.includes(req.user?.role) && !assigned) {
      throw ApiError.forbidden('An assigned barangay is required.');
    }
    const requested = req.query?.barangay;
    if (requested !== undefined && (typeof requested !== 'string' || !requested.trim())) {
      throw ApiError.unprocessable('Select a valid barangay.');
    }
    if (assigned && requested && assigned.toLowerCase() !== requested.trim().toLowerCase()) {
      throw ApiError.forbidden('The requested barangay is outside your assigned scope.');
    }
    const data = await service({
      actorId: req.user?.id || null,
      municipalityId: req.user?.municipalityId || null,
      barangay: assigned || requested?.trim() || null,
    }, dependencies);
    // Responses differ by authenticated assignment; shared caches must not reuse them.
    res.set('Cache-Control', 'private, no-store');
    sendData(res, data);
  };

export const getBarangayBoundaries = createBarangayBoundariesController();
export default { getBarangayBoundaries };
