/**
 * KALUSAGAP — Backend Liveness Health-Check Service (`health.service.js`).
 *
 * Architectural layer:
 *   `GET /api/health (unauthenticated) -> health.controller -> health.service`
 *
 * Controllers stay thin: they read the request and send the response, while
 * services like this one hold domain/runtime status logic without exposing
 * sensitive environment or database configuration details.
 */

/**
 * Build the unauthenticated process liveness payload for uptime monitors and load balancers.
 *
 * @returns {Object} `{ status: 'ok', message: string, uptimeSeconds: number }`.
 */
export const getStatus = () => ({
  status: 'ok',
  message: 'KALUSAGAP backend is running',
  uptimeSeconds: Math.floor(process.uptime()),
});

export default { getStatus };
