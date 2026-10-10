/**
 * RHU station assignment + station-level authorization (single source of truth
 * for the API).
 *
 * RHU work is modelled as an ASSIGNMENT on a personnel identity, deliberately
 * separate from the person's system role (`profiles.role`) and from their
 * barangay assignment (`profiles.barangay_id`). One account can therefore be:
 *
 *   User -> System Role -> Personnel Profile -> Barangay (optional)
 *                                             -> RHU Station(s) (optional)
 *
 * Supported stations:
 *   triage        — initial screening / intake at the RHU
 *   consultation  — clinical consultation after triage
 *
 * A person is NEVER given a second account just because they also work a
 * station; the station is an additional assignment on the same profile.
 *
 * Authorization rules enforced here (and re-checked against the database in the
 * service layer / RLS policy):
 *   - Triage: only RHU Personnel assigned to the Triage station (a Health
 *     Supervisor keeps its existing barangay/community intake capability, which
 *     is not gated on a station).
 *   - Consultation: the PHN always (its clinical role), plus RHU Personnel /
 *     Health Supervisor explicitly assigned to the Consultation station. A
 *     Health Supervisor does NOT gain consultation access from the role alone,
 *     and may hold a station with or without a barangay assignment.
 *
 * A person assigned only to Triage cannot consult, and a person assigned only
 * to Consultation cannot triage.
 */

export const RHU_STATIONS = Object.freeze({
  TRIAGE: 'triage',
  CONSULTATION: 'consultation',
});

export const RHU_STATION_VALUES = Object.freeze(Object.values(RHU_STATIONS));

/** Roles that may hold an RHU station assignment. */
export const STATION_ASSIGNED_ROLES = Object.freeze(['rhu_personnel', 'health_supervisor']);

/**
 * Roles whose operational purpose IS a station, so at least one station must be
 * selected at registration. A Health Supervisor may be assigned a station
 * optionally (they may be purely barangay-based).
 */
export const STATION_REQUIRED_ROLES = Object.freeze(['rhu_personnel']);

/**
 * Normalize arbitrary station input (array or comma-separated string) into a
 * deduplicated list of valid station ids, preserving order. Unknown/blank
 * values are dropped rather than trusted.
 */
export const normalizeStations = (input) => {
  let value = input;
  // Multipart/JSON clients may send an array, a JSON string, or a
  // comma-separated string. Decode a JSON array string before splitting so
  // `["triage","consultation"]` is understood as two stations.
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
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
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

/** The stations held by a session/profile user. */
export const stationsOf = (user) => normalizeStations(user?.rhuStations ?? user?.rhu_stations);

export const hasStation = (user, station) => stationsOf(user).includes(station);

/**
 * Display-only fallback: derive station(s) from the free-text
 * `profiles.position` designation when a legacy row predates the
 * `profiles.rhu_stations` column. The authoritative source is the
 * `rhu_stations text[]` column (migration 20261008000000) surfaced on the
 * session user as `rhuStations`; this helper is NOT used for authorization and
 * exists only so an un-migrated designation can still be labelled, e.g.
 *
 *   "Rural Health Unit (RHU) Personnel — Triage"
 *   "Health Supervisor (Barangay Nurse / Midwife) — Consultation"
 */
export const stationsFromPosition = (position) => {
  const value = String(position || '').toLowerCase();
  const out = [];
  if (/\btriage\b/.test(value)) out.push(RHU_STATIONS.TRIAGE);
  if (/\bconsultation\b/.test(value)) out.push(RHU_STATIONS.CONSULTATION);
  return out;
};

/** Human label for a station id. */
export const stationLabel = (station) =>
  station === RHU_STATIONS.TRIAGE
    ? 'Triage'
    : station === RHU_STATIONS.CONSULTATION
      ? 'Consultation'
      : '';

/**
 * Compose the stored `position` from a designation and the selected station(s).
 * Existing "— Triage/Consultation" suffixes are stripped first so re-saving does
 * not stack them. With no stations the designation is returned unchanged.
 */
export const composePosition = (designation, stations) => {
  const base = String(designation || '')
    .replace(/\s*[—\-·|]\s*(Triage|Consultation)(\s*\+\s*(Triage|Consultation))?\s*$/i, '')
    .replace(/\s*\+\s*(Triage|Consultation)\s*$/i, '')
    .trim();
  const labels = stationsOf({ rhuStations: stations }).map(stationLabel).filter(Boolean);
  if (labels.length === 0) return base;
  return `${base ? `${base} — ` : ''}${labels.join(' + ')}`;
};

/** True when the user may work the RHU Triage station. */
export const canTriage = (user) => {
  if (!user) return false;
  if (user.role === 'rhu_personnel') return hasStation(user, RHU_STATIONS.TRIAGE);
  // Health Supervisor retains barangay/community intake, independent of the
  // RHU station model (Station assignment is separate from barangay work).
  if (user.role === 'health_supervisor') return true;
  return false;
};

/** True when the user may work the RHU Consultation station. */
export const canConsult = (user) => {
  if (!user) return false;
  if (user.role === 'phn') return true;
  if (!STATION_ASSIGNED_ROLES.includes(user.role)) return false;
  return hasStation(user, RHU_STATIONS.CONSULTATION);
};

/** True when the user may initiate (but never issue) a medical certificate request. */
export const canInitiateCertificate = (user) =>
  user?.role === 'rhu_personnel' && hasStation(user, RHU_STATIONS.TRIAGE);

export default {
  RHU_STATIONS,
  RHU_STATION_VALUES,
  STATION_ASSIGNED_ROLES,
  STATION_REQUIRED_ROLES,
  normalizeStations,
  stationsOf,
  hasStation,
  canTriage,
  canConsult,
  canInitiateCertificate,
};
