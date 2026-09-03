import ApiError from '../utils/apiError.js';
import { assignedBarangay } from '../config/scope.js';

/**
 * Barangay scope middleware. MUST run after `authenticate`.
 *
 * Resolves the caller's assigned barangay from the SESSION (`req.user`) —
 * never from the request — and attaches it to `req.assignedBarangay`:
 *
 *   req.assignedBarangay = 'San Isidro'  → every downstream query MUST filter
 *                                          to that barangay
 *   req.assignedBarangay = null          → municipality-wide caller (MHO/admin)
 *
 * If a barangay-scoped caller asks for a different barangay through a query
 * parameter, body field or path param (`barangay`, `barangayId`), the request
 * is rejected with 403 before it reaches any controller — so changing a
 * filter, URL or id in the frontend cannot leak another barangay's data.
 * Municipality-wide callers may still drill down with `?barangay=`.
 */
const requestedBarangays = (req) => {
  const values = [];
  if (req.query && typeof req.query.barangay === 'string' && req.query.barangay.trim()) {
    values.push(req.query.barangay.trim());
  }
  if (req.query && typeof req.query.barangayId === 'string' && req.query.barangayId.trim()) {
    values.push(req.query.barangayId.trim());
  }
  if (req.body && typeof req.body === 'object') {
    const bodyBarangay = String(req.body.barangay ?? '').trim();
    if (bodyBarangay) values.push(bodyBarangay);
  }
  return values;
};

export const resolveBarangayScope = (req, res, next) => {
  const assigned = assignedBarangay(req.user);

  if (assigned) {
    const requested = requestedBarangays(req).filter((b) => b.toLowerCase() !== assigned.toLowerCase());
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
