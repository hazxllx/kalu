// backend/src/controllers/recentActivities.controller.js
import * as recentActivitiesService from '../services/recentActivities.service.js';
import { isApprovedBarangayName } from '../config/barangays.js';
import ApiError from '../utils/apiError.js';
import { sendData } from '../utils/apiResponse.js';

export const createRecentActivitiesController = ({ service = recentActivitiesService, ...dependencies } = {}) => ({
  getRecentActivities: async (req, res) => {
    const requested = req.query?.barangay;
    if (requested != null && (typeof requested !== 'string' || (requested.trim() && !isApprovedBarangayName(requested)))) {
      throw ApiError.unprocessable('The selected barangay is not supported.');
    }
    const data = await service.getRecentActivities({
      actorId: req.user?.id || null,
      barangay: req.assignedBarangay || requested?.trim() || null,
    }, dependencies);
    res.set('Cache-Control', 'private, no-store');
    sendData(res, data);
  },
});

export const { getRecentActivities } = createRecentActivitiesController();
