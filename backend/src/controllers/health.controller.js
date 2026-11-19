import * as healthService from '../services/health.service.js';

/**
 * System Liveness & Health-Check Controller.
 *
 * Mounted at `GET /api/health` outside authentication/authorization middleware
 * (`route -> controller -> health.service`) so uptime monitors, load balancers,
 * and local dev tooling can verify the Express API process is responsive without
 * touching Supabase or exposing user/clinical data.
 */

/**
 * GET /api/health
 * Confirms the API process is up by returning `healthService.getStatus()` directly
 * as a `200 OK` JSON payload. Carries no database or user data.
 */
export const getHealth = (req, res) => {
  res.status(200).json(healthService.getStatus());
};

export default { getHealth };
