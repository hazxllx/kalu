import ApiError from '../utils/apiError.js';
import { canTriage, canConsult, RHU_STATIONS, STATION_ASSIGNED_ROLES } from '../config/rhuStations.js';

/**
 * Station authorization middleware factory.
 *
 * Runs AFTER `authenticate` (which resolves the profile) and, where used, after
 * `authorize(...)`. It enforces the RHU STATION assignment separately from the
 * account's role and barangay assignment:
 *
 *   authorizeStation(RHU_STATIONS.TRIAGE)
 *     -> RHU Personnel must hold the Triage station; Health Supervisor retains
 *        its barangay/community intake capability.
 *
 *   authorizeStation(RHU_STATIONS.CONSULTATION)
 *     -> PHN always; RHU Personnel / Health Supervisor only when assigned the
 *        Consultation station. Role alone never grants consultation.
 *
 * The station gate only constrains STATION-ASSIGNED roles (RHU Personnel and
 * Health Supervisor); a role that is not part of the RHU station model (PHN,
 * MHO, ...) is governed solely by `authorize(...)` and passes straight through.
 * This is what lets the PHN/MHO keep their existing capabilities while an RHU
 * Personnel account is restricted to its assigned station.
 *
 * This is the API-layer boundary; the service layer re-checks the same rule so
 * a handler reached by another path is still protected.
 */
const authorizeStation = (station) => (req, res, next) => {
  const user = req.user;
  if (!user) return next(ApiError.unauthorized());

  if (!STATION_ASSIGNED_ROLES.includes(user.role)) return next();

  const allowed =
    station === RHU_STATIONS.TRIAGE
      ? canTriage(user)
      : station === RHU_STATIONS.CONSULTATION
        ? canConsult(user)
        : false;

  if (!allowed) {
    return next(
      station === RHU_STATIONS.CONSULTATION
        ? ApiError.forbidden(
            'You are not assigned to the RHU Consultation station. Contact the PHN to be assigned.',
          )
        : ApiError.forbidden(
            'You are not assigned to the RHU Triage station. Contact the PHN to be assigned.',
          ),
    );
  }
  return next();
};

export default authorizeStation;
