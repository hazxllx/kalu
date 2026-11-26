// backend/src/utils/notImplemented.js
import ApiError from './apiError.js';

/**
 * @module utils/notImplemented
 * @description Placeholder controller factory for routes awaiting a verified database schema (ERD).
 *
 * Architectural layer:
 *   `route -> authenticate -> authorize -> controller (notImplemented) -> errorHandler`
 *
 * Keeps authentication and role-based authorization active on scaffolded endpoints
 * while intentionally throwing `501 Not Implemented` (`ApiError.notImplemented`)
 * instead of returning mock or fabricated records. Once a resource's Supabase
 * tables and repository queries are verified, replace this placeholder with a real
 * controller delegating to a service.
 */

/**
 * Creates a controller handler that immediately throws a `501 Not Implemented`
 * `ApiError` naming the unverified resource or action.
 *
 * @example
 *   router.get('/', authenticate, authorize(roles), asyncHandler(notImplemented('residents')));
 *
 * @param {string} resource - Resource or action identifier (e.g., `'residents'` or `'immunizations.list'`) surfaced in logs and error responses.
 * @returns {Function} Express handler function that throws `ApiError` with HTTP status 501.
 */
const notImplemented = (resource) => () => {
  throw ApiError.notImplemented(
    `[${resource}] endpoint is BACKEND-READY but not yet wired to the database. ` +
      'BLOCKED BY UNVERIFIED DATABASE STRUCTURE (ERD).',
  );
};

export default notImplemented;
