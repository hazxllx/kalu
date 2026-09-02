import ApiError from './apiError.js';

/**
 * Controller placeholder for endpoints whose implementation depends on the
 * verified KALUSAGAP database structure (ERD).
 *
 * It intentionally throws 501 instead of returning fake data, so the API never
 * pretends a database operation succeeded. Each usage names the resource and
 * the schema it is blocked on, which surfaces clearly in the response and logs.
 *
 *   router.get('/', authenticate, authorize(roles), notImplemented('residents'));
 *
 * Replace with a real controller (delegating to a service) once the schema for
 * that resource is confirmed.
 */
const notImplemented = (resource) => () => {
  throw ApiError.notImplemented(
    `[${resource}] endpoint is BACKEND-READY but not yet wired to the database. ` +
      'BLOCKED BY UNVERIFIED DATABASE STRUCTURE (ERD).',
  );
};

export default notImplemented;
