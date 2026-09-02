import * as healthService from '../services/health.service.js';

/**
 * GET /api/health
 * Confirms the API process is up. Carries no database or user data.
 */
export const getHealth = (req, res) => {
  res.status(200).json(healthService.getStatus());
};

export default { getHealth };
