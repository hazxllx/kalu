/**
 * Business logic for the health-check endpoint.
 *
 * Controllers stay thin: they read the request and send the response, while
 * services like this one hold the logic. Once the ERD is final, services are
 * also the only layer that talks to Supabase/PostgreSQL.
 */
export const getStatus = () => ({
  status: 'ok',
  message: 'KALUSAGAP backend is running',
});

export default { getStatus };
