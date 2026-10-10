/**
 * RHU station assignment helpers (frontend mirror of
 * `backend/src/config/rhuStations.js`).
 *
 * The station assignment is separate from the account role and barangay
 * assignment and is read from the authenticated profile (`GET /api/auth/me` →
 * `rhuStations`). It only drives navigation/UI affordances here; the backend
 * enforces the same rule on every API call.
 */

export const RHU_STATIONS = Object.freeze({
  TRIAGE: 'triage',
  CONSULTATION: 'consultation',
});

export const RHU_STATION_VALUES = Object.freeze(Object.values(RHU_STATIONS));

export const normalizeStations = (input) => {
  let value = input;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        value = JSON.parse(trimmed);
      } catch {
        value = trimmed;
      }
    }
  }
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const station = String(entry ?? '').trim().toLowerCase();
    if (!station || !RHU_STATION_VALUES.includes(station) || seen.has(station)) continue;
    seen.add(station);
    out.push(station);
  }
  return out;
};

export const stationsOf = (user) => normalizeStations(user?.rhuStations);

export const hasStation = (user, station) => stationsOf(user).includes(station);

/** True when the user may work the RHU Triage station. */
export const canTriage = (user) => {
  if (!user) return false;
  if (user.role === 'rhu_personnel') return hasStation(user, RHU_STATIONS.TRIAGE);
  if (user.role === 'health_supervisor') return true;
  return false;
};

/** True when the user may work the RHU Consultation station. */
export const canConsult = (user) => {
  if (!user) return false;
  if (user.role === 'phn') return true;
  if (!['rhu_personnel', 'health_supervisor'].includes(user.role)) return false;
  return hasStation(user, RHU_STATIONS.CONSULTATION);
};

/** True when the user may initiate (but never issue) a medical certificate request. */
export const canInitiateCertificate = (user) =>
  user?.role === 'rhu_personnel' && hasStation(user, RHU_STATIONS.TRIAGE);

export default {
  RHU_STATIONS,
  RHU_STATION_VALUES,
  normalizeStations,
  stationsOf,
  hasStation,
  canTriage,
  canConsult,
  canInitiateCertificate,
};
