import ApiError from '../utils/apiError.js';
import { assignedBarangay } from '../config/scope.js';

/**
 * @module middleware/barangayScope
 *
 * Geographic barangay data-isolation middleware for KALUSAGAP.
 * Position in request pipeline:
 *   `route -> authenticate -> authorize -> barangayScope -> controller -> service -> repository/Supabase`
 *
 * MUST run after `authenticate`. Resolves the caller's assigned barangay from
 * the verified SESSION (`req.user`) — never from client input — and attaches it
 * to `req.assignedBarangay`:
 *
 *   req.assignedBarangay = 'San Isidro'  -> every downstream query MUST filter
 *                                           to that barangay
 *   req.assignedBarangay = null          -> municipality-wide caller (MHO/PHN/admin)
 *
 * If a barangay-scoped caller (e.g. Health Supervisor or BHW) requests a
 * different barangay through a query parameter or request body field
 * (`barangay`, `barangayId`, `barangay_id`, including nested `body.household`),
 * the request is rejected with 403 before reaching any controller — so
 * tampering with filters or payloads cannot leak or write another barangay's
 * records. Their OWN barangay is accepted as either the barangay name or UUID,
 * because FHSIS M1 endpoints filter by UUID while general endpoints filter by
 * name. Municipality-wide callers may freely drill down with `?barangay=`.
 */

/**
 * Collects all candidate barangay identifiers (names or UUIDs) explicitly
 * requested by the client in `req.query` or `req.body` (including nested
 * `req.body.household` payloads used during resident/household intake).
 *
 * @param {Object} req - Express request object.
 * @returns {Array<string>} Non-empty trimmed barangay strings found in the request.
 */
const requestedBarangays = (req) => {
  const values = [];
  if (req.query && typeof req.query.barangay === 'string' && req.query.barangay.trim()) {
    values.push(req.query.barangay.trim());
  }
  if (req.query && typeof req.query.barangayId === 'string' && req.query.barangayId.trim()) {
    values.push(req.query.barangayId.trim());
  }
  if (req.query && typeof req.query.barangay_id === 'string' && req.query.barangay_id.trim()) {
    values.push(req.query.barangay_id.trim());
  }
  if (req.body && typeof req.body === 'object') {
    const nestedBody = req.body.household && typeof req.body.household === 'object'
      ? req.body.household
      : req.body;
    const bodyBarangay = String(nestedBody.barangay ?? req.body.barangay ?? '').trim();
    if (bodyBarangay) values.push(bodyBarangay);
    const bodyBarangayId = String(
      nestedBody.barangayId ??
        nestedBody.barangay_id ??
        req.body.barangayId ??
        req.body.barangay_id ??
        '',
    ).trim();
    if (bodyBarangayId) values.push(bodyBarangayId);
  }
  return values;
};

/**
 * Every form of the caller's own barangay: the NAME (what `authenticate` reads
 * from the profiles row) and the UUID (what the M1 endpoints filter on),
 * lowercased for case-insensitive matching. A request is only rejected when it
 * names a barangay that matches neither identifier.
 *
 * @param {Object} req - Express request object with `req.user`.
 * @returns {Array<string>} Lowercased allowed barangay identifiers for the caller.
 */
const ownBarangayValues = (req) => {
  const assigned = assignedBarangay(req.user);
  if (!assigned) return [];
  const values = [assigned];
  const ownId = String(req.user?.barangayId ?? '').trim();
  if (ownId) values.push(ownId);
  return values.map((v) => v.toLowerCase());
};

/**
 * Enforces that barangay-scoped users cannot query or mutate outside their
 * assigned barangay, and sets `req.assignedBarangay` for downstream controllers
 * and services.
 *
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next callback.
 */
export const resolveBarangayScope = (req, res, next) => {
  const assigned = assignedBarangay(req.user);

  if (assigned) {
    const allowed = ownBarangayValues(req);
    const requested = requestedBarangays(req).filter((b) => !allowed.includes(b.toLowerCase()));
    if (requested.length > 0) {
      return next(
        ApiError.forbidden('Your account is assigned to Barangay ' + assigned + ' only'),
      );
    }
  }

  req.assignedBarangay = assigned;
  return next();
};

export default resolveBarangayScope;
