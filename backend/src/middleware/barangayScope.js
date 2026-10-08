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
 * parameter, body field or path param (`barangay`, `barangayId`, `barangay_id`),
 * the request is rejected with 403 before it reaches any controller — so
 * changing a filter, URL or id in the frontend cannot leak another barangay's
 * data. Their OWN barangay is accepted as either the name or the UUID, because
 * the M1 endpoints filter by id while the rest of the API filters by name.
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
 * from the profiles row) and the UUID (what the M1 endpoints filter on). A
 * request is only widened when it names a barangay that is neither of these.
 */
const ownBarangayValues = (req) => {
  const assigned = assignedBarangay(req.user);
  if (!assigned) return [];
  const values = [assigned];
  const ownId = String(req.user?.barangayId ?? '').trim();
  if (ownId) values.push(ownId);
  return values.map((v) => v.toLowerCase());
};

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
