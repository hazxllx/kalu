import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';
import { deriveStage } from '../config/referralStage.js';
import { stationsOf } from '../config/rhuStations.js';
import { isApprovedBarangayName } from '../config/barangays.js';

/**
 * Health Supervisor referral coordination service.
 *
 * Backs public.health_referrals (see
 * supabase/migrations/20260923100000_health_supervisor_referrals.sql): the
 * canonical workflow where a Health Supervisor / PHN routes a resident to a
 * real authorized recipient at a registered facility. Assigned recipients
 * decide/progress/complete; the original sender tracks the same immutable ID.
 *
 * SECURITY MODEL (defense in depth):
 *   - authenticate + authorize middleware gate the route by session + role,
 *   - every read is filtered to the caller's barangay/municipality scope HERE,
 *     never trusting a client-supplied barangay/resident id,
 *   - a resident only ever sees referrals linked to their own account,
 *   - Supabase RLS mirrors the same boundary for any direct token access.
 *
 * The service uses the service-role client (RLS-bypassing) but is only reached
 * after the middleware pipeline has run. `supabase` is injectable so the unit
 * tests can drive it without a live database.
 */

const TABLE = 'health_referrals';
const LEGACY_MAP = 'health_referral_legacy_map';
const HISTORY_TABLE = 'health_referral_history';
const WRITE_ROLES = new Set(['health_supervisor', 'phn']);
const MUNICIPALITY_ROLES = new Set(['mho', 'phn']);
const RECIPIENT_ROLES = new Set(['phn', 'health_supervisor', 'rhu_personnel']);
const RESIDENT_ROLES = new Set(['resident', 'resident-limited']);

export const REFERRAL_STATUSES = Object.freeze(['Pending', 'Accepted', 'In Progress', 'Completed', 'Rejected', 'Cancelled']);
export const REFERRAL_TRANSITIONS = Object.freeze({
  Pending: ['Accepted', 'Rejected', 'Cancelled'],
  Accepted: ['In Progress', 'Cancelled'],
  'In Progress': ['Completed', 'Cancelled'],
  Completed: [],
  Rejected: [],
  Cancelled: [],
});
const VALID_PRIORITIES = ['Low', 'Medium', 'High'];
const CLOSED_STATUSES = new Set(['Completed', 'Rejected', 'Cancelled']);
const REFERRAL_PAGE_SIZE = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ZONED_DATE_TIME_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:[zZ]|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/;

/**
 * The resident columns every referral response embeds.
 *
 * READ and WRITE responses MUST share this list. The create/update/status
 * endpoints used to return `.select('*')` with no embed, so the frontend
 * mapper (which reads `row.resident.first_name`) fell back to a placeholder
 * name and silently overwrote the correct resident name in the table after any
 * edit. One constant keeps the payload identical on every path.
 */
const BARANGAY_SCOPE = 'barangay_scope:barangays!barangay_id(id, name, status, municipality_id)';
const RESIDENT_EMBED =
  `resident:residents!inner(id, first_name, middle_name, last_name, barangay, barangay_id, sex, birth_date, current_address, permanent_address, auth_user_id, municipality_id, ${BARANGAY_SCOPE})`;
const PROFILE_COLUMNS = `id, full_name, role, status, municipality_id, barangay_id, facility_id, rhu_stations, ${BARANGAY_SCOPE}`;
const FACILITY_COLUMNS = `id, name, type, address, municipality_id, barangay_id, ${BARANGAY_SCOPE}`;
const REFERRAL_SELECT = `*, ${RESIDENT_EMBED}, sender:profiles!created_by(id, full_name, role), recipient:profiles!recipient_personnel_id(${PROFILE_COLUMNS}), recipient_facility:facilities!recipient_facility_id(${FACILITY_COLUMNS}), legacy_links:${LEGACY_MAP}(legacy_referral_id, legacy_snapshot, source_visit_matches_resident)`;

const text = (v) => String(v ?? '').trim();
const throwOnError = (error, fallback) => {
  if (['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42883', '42703', '42P01'].includes(error?.code)) {
    throw new ApiError(503, 'The canonical referral schema is unavailable. Deploy migration 20261106010000 and refresh the database schema cache.').withCode('REFERRAL_SCHEMA_UNAVAILABLE');
  }
  if (error?.code === '42501') throw ApiError.forbidden(error.message || fallback);
  if (error?.code === 'P0002') throw ApiError.notFound(error.message || fallback);
  if (['23505', '40001'].includes(error?.code)) throw ApiError.conflict(error.message || fallback);
  if (['22023', '22P02', '23514', '23502'].includes(error?.code)) throw ApiError.unprocessable(error.message || fallback);
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
};

const isValidDateOnly = (value) => {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const dateKeyInTimeZone = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const sameInstant = (left, right) => {
  const leftTime = typeof left === 'string' && left.trim() ? Date.parse(left) : NaN;
  const rightTime = typeof right === 'string' && right.trim() ? Date.parse(right) : NaN;
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
};

export const assertReferralDates = (payload, { existing = null, now = new Date() } = {}) => {
  const referralDate = payload.referral_date;
  const scheduledAt = payload.scheduled_at;
  const timeZone = text(payload.client_time_zone) || Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (referralDate !== undefined && referralDate !== null && referralDate !== '') {
    if (!isValidDateOnly(referralDate)) {
      throw ApiError.unprocessable('Enter a valid referral date.', { field: 'referral_date' });
    }
    let today;
    try {
      today = dateKeyInTimeZone(now, timeZone);
    } catch {
      throw ApiError.unprocessable('Enter a valid local time zone.', { field: 'client_time_zone' });
    }
    if (referralDate > today) {
      throw ApiError.unprocessable('Referral date cannot be later than today.', { field: 'referral_date' });
    }
  }

  if (scheduledAt !== undefined && scheduledAt !== null && scheduledAt !== '') {
    const dateTimeMatch = typeof scheduledAt === 'string' && ZONED_DATE_TIME_PATTERN.exec(scheduledAt);
    if (
      !dateTimeMatch ||
      !isValidDateOnly(dateTimeMatch[1]) ||
      !Number.isFinite(Date.parse(scheduledAt))
    ) {
      throw ApiError.unprocessable('Enter a valid scheduled date and time.', { field: 'scheduled_at' });
    }
    if (existing && sameInstant(scheduledAt, existing.scheduled_at)) return;
    if (Date.parse(scheduledAt) <= now.getTime()) {
      throw ApiError.unprocessable('Scheduled date and time cannot be in the past.', { field: 'scheduled_at' });
    }
  }
};

const assertWriter = (user) => {
  if (!user?.id || !WRITE_ROLES.has(user.role) || user.status === 'disabled' || user.status === 'pending_verification') {
    throw ApiError.forbidden('You are not authorized to manage referrals.');
  }
  if (!user.municipalityId || (user.role === 'health_supervisor' && !user.barangayId)) {
    throw ApiError.forbidden('Your account needs a current municipality and barangay assignment.');
  }
};

/**
 * Resolve the resident referenced by an operation and confirm it is inside the
 * caller's barangay/municipality scope. Returns the resident row, or throws
 * 404 (so an out-of-scope resident is indistinguishable from a missing one and
 * cannot be probed). Never trusts a client-supplied barangay.
 */
const residentInScope = async (supabase, user, residentId) => {
  const id = text(residentId);
  if (!id) throw ApiError.badRequest('A resident is required for a referral.');
  const { data, error } = await supabase
    .from('residents')
    .select(`id, barangay, barangay_id, municipality_id, auth_user_id, ${BARANGAY_SCOPE}`)
    .eq('id', id)
    .maybeSingle();
  throwOnError(error, 'Could not load resident');
  if (!data) throw ApiError.notFound('Resident record not found.');

  const outOfBarangay = user.role === 'health_supervisor' && (!user.barangayId || data.barangay_id !== user.barangayId);
  const outOfMunicipality = !user.municipalityId || !data.municipality_id || user.municipalityId !== data.municipality_id;
  if (outOfBarangay || outOfMunicipality) throw ApiError.notFound('Resident record not found.');
  return data;
};

const normalizeRecipientRole = (role) => text(role) === 'midwife' ? 'health_supervisor' : text(role);
const currentResident = (row) => row.resident || {};
const hasCurrentBarangay = (row) => Boolean(row?.barangay_id && row.barangay_scope?.id === row.barangay_id
  && row.barangay_scope.municipality_id === row.municipality_id && row.barangay_scope.status === 'Active'
  && isApprovedBarangayName(row.barangay_scope.name));

const hasSenderScope = (user, row) => {
  const resident = currentResident(row);
  if (!user?.municipalityId || resident.municipality_id !== user.municipalityId) return false;
  if (user.role === 'health_supervisor') return Boolean(user.barangayId && resident.barangay_id === user.barangayId);
  return MUNICIPALITY_ROLES.has(user.role);
};

/** Use the live profile and facility, not a saved role/name or JWT metadata. */
export const recipientRouteIsValid = ({ recipient, facility, resident, role, station = null }) => {
  if (!recipient || !facility || !resident?.municipality_id || !RECIPIENT_ROLES.has(role)) return false;
  if (recipient.status !== 'active' || recipient.role !== role || recipient.municipality_id !== resident.municipality_id || facility.municipality_id !== resident.municipality_id) return false;
  if (!hasCurrentBarangay(resident) || (facility.barangay_id && !hasCurrentBarangay(facility))
    || (role === 'health_supervisor' && !hasCurrentBarangay(recipient))) return false;
  const account = recipient.account;
  if (account && (account.approval_status !== 'approved' || account.setup_required || account.suspended_at)) return false;
  if (role === 'phn') return !station && facility.type === 'rhu' && recipient.facility_id === facility.id;
  if (facility.type === 'rhu') {
    return recipient.facility_id === facility.id && ['triage', 'consultation'].includes(station) && stationsOf(recipient).includes(station);
  }
  return role === 'health_supervisor' && !station && facility.type === 'barangay_health_station'
    && Boolean(recipient.barangay_id) && recipient.barangay_id === resident.barangay_id
    && facility.barangay_id === recipient.barangay_id && (!recipient.facility_id || recipient.facility_id === facility.id);
};

const isCurrentRecipient = (user, row) => {
  if (!user?.id || row.recipient_personnel_id !== user.id || row.recipient_role !== user.role) return false;
  const recipient = row.recipient || {};
  if (recipient.id !== user.id) return false;
  // authenticate refreshes the caller's assignment on every request. Require
  // both that assignment and the live embedded recipient to agree.
  if (recipient.facility_id !== (user.facilityId || null) || recipient.municipality_id !== user.municipalityId) return false;
  if (user.role === 'health_supervisor' && recipient.barangay_id !== user.barangayId) return false;
  if (row.recipient_station && !stationsOf(user).includes(row.recipient_station)) return false;
  return recipientRouteIsValid({ recipient, facility: row.recipient_facility, resident: currentResident(row), role: row.recipient_role, station: row.recipient_station });
};

const assertReader = (user) => {
  if (!user?.id || (!RESIDENT_ROLES.has(user.role) && !RECIPIENT_ROLES.has(user.role) && !['mho', 'admin'].includes(user.role))) {
    throw ApiError.forbidden('You are not authorized to view referrals.');
  }
  if (user.status === 'disabled' || (!RESIDENT_ROLES.has(user.role) && user.status === 'pending_verification')) {
    throw ApiError.forbidden('Your account cannot access referrals.');
  }
};

const canRead = (user, row) => {
  if (user.role !== 'admin' && row.legacy_links?.some((link) => link.source_visit_matches_resident === false)) return false;
  if (RESIDENT_ROLES.has(user.role)) return currentResident(row).auth_user_id === user.id;
  return user.role === 'admin' || hasSenderScope(user, row) || isCurrentRecipient(user, row);
};

const capabilitiesFor = (user, row) => {
  const sender = WRITE_ROLES.has(user.role) && row.created_by === user.id && hasSenderScope(user, row);
  const recipient = isCurrentRecipient(user, row);
  const allowed = (REFERRAL_TRANSITIONS[row.status] || []).filter((status) => status === 'Cancelled' ? sender : recipient);
  return {
    can_edit: sender && row.status === 'Pending',
    can_assign: sender && !CLOSED_STATUSES.has(row.status),
    is_sender: sender,
    is_recipient: recipient,
    allowed_statuses: allowed,
    can_screen: recipient && row.recipient_station === 'triage' && ['Accepted', 'In Progress'].includes(row.status),
  };
};

const resolveId = async (supabase, id) => {
  const value = text(id);
  const { data, error } = await supabase.from(LEGACY_MAP).select('health_referral_id').eq('legacy_referral_id', value).maybeSingle();
  throwOnError(error, 'Could not resolve historical referral');
  if (data) return data.health_referral_id;
  if (UUID_PATTERN.test(value)) return value;
  throw ApiError.notFound('Referral not found.');
};

const stageFor = (row, visit) => {
  if (row.status === 'Rejected') return { key: 'rejected', label: 'Rejected' };
  if (!visit && row.status === 'Completed') return { key: 'completed', label: 'Referral completed' };
  if (!visit && row.status === 'Accepted') return { key: 'accepted', label: 'Accepted' };
  if (!visit && row.status === 'In Progress') return { key: 'in_progress', label: 'In Progress' };
  return deriveStage(row, visit);
};

/** Map the resident's own account id -> resident row (for the resident view). */
const ownResident = async (supabase, user) => {
  const { data, error } = await supabase
    .from('residents')
    .select('id, auth_user_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  throwOnError(error, 'Could not load resident record');
  return data || null;
};

// Clinical columns of the linked RHU encounter visit surfaced alongside a
// referral (triage + consultation live on the same visit).
const ENCOUNTER_SELECT = [
  'id', 'resident_id', 'referral_id', 'status', 'visit_date', 'chief_complaint', 'clinical_history',
  'findings', 'treatment_given', 'recommendation', 'phn_assessment', 'phn_notes',
  'phn_personnel', 'recorded_by_id', 'recorded_by_name', 'recorded_by_role', 'responsible_personnel_name',
  'facility_id', 'bp', 'hr', 'rr', 'o2sat', 'temperature', 'height_cm', 'weight_kg',
  'bmi', 'bmi_category', 'blood_sugar', 'received_at', 'reviewed_at', 'completed_at',
  'created_at',
].join(', ');

/** Attach the derived progress stage to a list of referral rows (batched). */
const attachStages = async (supabase, rows) => {
  const ids = (rows || []).map((r) => r.id).filter(Boolean);
  if (!ids.length) return rows || [];
  const visits = [];
  for (let offset = 0; offset < ids.length; offset += REFERRAL_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('visits')
      .select('id, referral_id, status, completed_at, created_at')
      .in('referral_id', ids.slice(offset, offset + REFERRAL_PAGE_SIZE))
      .order('created_at', { ascending: false });
    throwOnError(error, 'Could not load referral stages');
    visits.push(...(data || []));
  }
  const newestByReferral = new Map();
  for (const v of visits) {
    if (!newestByReferral.has(v.referral_id)) newestByReferral.set(v.referral_id, v);
  }
  return rows.map((r) => ({ ...r, stage: stageFor(r, newestByReferral.get(r.id) || null) }));
};

/** Load the single most-recent RHU encounter visit linked to a referral. */
const linkedEncounter = async (supabase, referralId) => {
  const { data, error } = await supabase
    .from('visits')
    .select(ENCOUNTER_SELECT)
    .eq('referral_id', referralId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  throwOnError(error, 'Could not load receiving encounter');
  return data || null;
};

/**
 * Mark a referral Completed when its linked RHU encounter visit is completed.
 * Idempotent; never downgrades a Completed/Cancelled referral. Called from the
 * consultation-completion path (service-role), so RLS is bypassed by design.
 */
export const markCompletedFromVisit = async (referralId, { supabase = getServiceClient() } = {}) => {
  if (!referralId) return null;
  const { data, error } = await supabase.rpc('canonical_referral_complete_from_visit', { p_id: referralId });
  throwOnError(error, 'Could not complete linked referral');
  return data;
};

/**
 * List referrals visible to the caller. Scope is enforced server-side:
 *   health_supervisor -> own current barangay, plus individual valid assignments
 *   mho / phn         -> existing municipality oversight; assigned-only inbox
 *   rhu_personnel     -> individual current facility/role/station assignments
 *   resident          -> only their own referrals (BHW has no referral rights)
 */
export const list = async ({ user, residentId = null, status = null, box = 'all', supabase = getServiceClient() }) => {
  assertReader(user);
  if (!['all', 'incoming', 'outgoing'].includes(box)) throw ApiError.badRequest('Invalid referral inbox.');
  if (status && !REFERRAL_STATUSES.includes(status)) throw ApiError.unprocessable('Invalid referral status.');
  const scopes = [];
  if (RESIDENT_ROLES.has(user?.role)) {
    const mine = await ownResident(supabase, user);
    if (!mine) return [];
    scopes.push([['resident_id', mine.id]]);
  } else if (box === 'incoming' || user.role === 'rhu_personnel') {
    if (!RECIPIENT_ROLES.has(user.role)) throw ApiError.forbidden('Your role cannot receive referrals.');
    if (!user.municipalityId) return [];
    scopes.push([['recipient_personnel_id', user.id], ['resident.municipality_id', user.municipalityId]]);
  } else if (box === 'outgoing') {
    if (!WRITE_ROLES.has(user.role) || !user.municipalityId) return [];
    scopes.push([['created_by', user.id], ['resident.municipality_id', user.municipalityId]]);
  } else if (user.role === 'health_supervisor') {
    if (!user.barangayId || !user.municipalityId) return [];
    scopes.push([['resident.barangay_id', user.barangayId], ['resident.municipality_id', user.municipalityId]]);
    scopes.push([['recipient_personnel_id', user.id], ['resident.municipality_id', user.municipalityId]]);
  } else if (MUNICIPALITY_ROLES.has(user.role)) {
    if (!user.municipalityId) return [];
    scopes.push([['resident.municipality_id', user.municipalityId]]);
  } else {
    scopes.push([]);
  }
  const rows = new Map();
  for (const filters of scopes) {
    let query = supabase.from(TABLE).select(REFERRAL_SELECT).order('created_at', { ascending: false }).order('id', { ascending: false });
    for (const [column, value] of filters) query = query.eq(column, value);
    if (residentId) query = query.eq('resident_id', residentId);
    if (status) query = query.eq('status', status);
    for (let offset = 0; ; offset += REFERRAL_PAGE_SIZE) {
      const { data, error } = await query.range(offset, offset + REFERRAL_PAGE_SIZE - 1);
      throwOnError(error, 'Could not load referrals');
      for (const row of data || []) {
        if (canRead(user, row) && (box !== 'incoming' || isCurrentRecipient(user, row))) {
          rows.set(row.id, { ...row, capabilities: capabilitiesFor(user, row) });
        }
      }
      if (!data || data.length < REFERRAL_PAGE_SIZE) break;
    }
  }
  return attachStages(supabase, [...rows.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id.localeCompare(a.id)));
};

/** Fetch one referral, enforcing the same scope as list(). */
export const getById = async ({ user, id, supabase = getServiceClient() }) => {
  assertReader(user);
  const canonicalId = await resolveId(supabase, id);
  const { data, error } = await supabase.from(TABLE).select(REFERRAL_SELECT).eq('id', canonicalId).maybeSingle();
  throwOnError(error, 'Could not load referral');
  if (!data || !canRead(user, data)) throw ApiError.notFound('Referral not found.');
  const [visit, historyResult, legacyResult] = await Promise.all([
    linkedEncounter(supabase, canonicalId),
    supabase.from(HISTORY_TABLE).select('*').eq('referral_id', canonicalId).order('version', { ascending: true }),
    supabase.from(LEGACY_MAP).select('legacy_referral_id, legacy_snapshot, source_visit_matches_resident').eq('health_referral_id', canonicalId).order('legacy_referral_id', { ascending: true }),
  ]);
  throwOnError(historyResult.error, 'Could not load referral history');
  throwOnError(legacyResult.error, 'Could not load historical referral document');
  const encounter = visit && visit.resident_id === data.resident_id && (!data.recipient_facility_id || visit.facility_id === data.recipient_facility_id) ? visit : null;
  return { ...data, stage: stageFor(data, encounter), encounter, history: historyResult.data || [], legacy_links: legacyResult.data || [], capabilities: capabilitiesFor(user, data) };
};

export const assertIncomingReferral = async ({ user, id, supabase = getServiceClient() }) => {
  const row = await getById({ user, id, supabase });
  if (!isCurrentRecipient(user, row)) throw ApiError.notFound('Referral not found.');
  if (!['Accepted', 'In Progress'].includes(row.status)) throw ApiError.conflict('Accept the referral before starting an encounter.');
  return row;
};

export const getByVisitId = async ({ user, visitId, supabase = getServiceClient() }) => {
  assertReader(user);
  const { data, error } = await supabase.from(TABLE).select('id').eq('treatment_visit_id', text(visitId)).order('created_at', { ascending: false }).limit(1).maybeSingle();
  throwOnError(error, 'Could not load source referral');
  if (!data) throw ApiError.notFound('Referral not found.');
  return getById({ user, id: data.id, supabase });
};

/** Minimal, authenticated routing directory. No email, license or contact PII. */
export const listRecipients = async ({ user, residentId = null, supabase = getServiceClient() }) => {
  assertWriter(user);
  if (!residentId) throw ApiError.badRequest('Select a resident before choosing a referral recipient.');
  const resident = await residentInScope(supabase, user, residentId);
  const [profiles, facilities] = await Promise.all([
    // personnel_accounts references profiles through several audit columns;
    // name its identity FK so PostgREST does not have to guess the relation.
    supabase.from('profiles').select(`${PROFILE_COLUMNS}, account:personnel_accounts!account_id(approval_status, setup_required, suspended_at)`).eq('municipality_id', user.municipalityId).eq('status', 'active').in('role', [...RECIPIENT_ROLES]).order('full_name', { ascending: true }),
    supabase.from('facilities').select(FACILITY_COLUMNS).eq('municipality_id', user.municipalityId).order('name', { ascending: true }),
  ]);
  throwOnError(profiles.error, 'Could not load referral recipients');
  throwOnError(facilities.error, 'Could not load referral facilities');
  const routes = [];
  for (const recipient of profiles.data || []) {
    if (recipient.id === user.id) continue;
    for (const facility of facilities.data || []) {
      const stations = facility.type === 'rhu' && recipient.role !== 'phn' ? stationsOf(recipient) : [null];
      for (const station of stations) {
        if (recipientRouteIsValid({ recipient, facility, resident, role: recipient.role, station })) {
          routes.push({ id: recipient.id, name: recipient.full_name, role: recipient.role, facility_id: facility.id, facility_name: facility.name, station });
        }
      }
    }
  }
  return routes;
};

const resolveRecipient = async (supabase, resident, payload, existing = null) => {
  const personnelId = text(payload.recipient_personnel_id ?? existing?.recipient_personnel_id);
  const facilityId = text(payload.recipient_facility_id ?? existing?.recipient_facility_id);
  if (!UUID_PATTERN.test(personnelId) || !UUID_PATTERN.test(facilityId)) {
    throw ApiError.unprocessable('Select a receiving facility and an assigned recipient.');
  }
  const [personnel, destination] = await Promise.all([
    supabase.from('profiles').select(`${PROFILE_COLUMNS}, account:personnel_accounts!account_id(approval_status, setup_required, suspended_at)`).eq('id', personnelId).maybeSingle(),
    supabase.from('facilities').select(FACILITY_COLUMNS).eq('id', facilityId).maybeSingle(),
  ]);
  throwOnError(personnel.error, 'Could not validate referral recipient');
  throwOnError(destination.error, 'Could not validate receiving facility');
  const role = normalizeRecipientRole(payload.recipient_role ?? personnel.data?.role);
  let station = payload.recipient_station !== undefined ? text(payload.recipient_station) || null : existing?.recipient_station || null;
  if (!station && payload.recipient_station === undefined && destination.data?.type === 'rhu' && role !== 'phn') {
    const stations = stationsOf(personnel.data);
    if (stations.length === 1) station = stations[0];
  }
  if (!recipientRouteIsValid({ recipient: personnel.data, facility: destination.data, resident, role, station })) {
    throw ApiError.unprocessable('Choose a current authorized recipient, role, station and facility in this municipality.');
  }
  return { recipient_personnel_id: personnelId, recipient_facility_id: facilityId, recipient_role: role, recipient_station: station, destination_facility: destination.data.name };
};

const sanitizeWrite = (payload = {}) => {
  const row = {};
  if (payload.referring_facility !== undefined) row.referring_facility = text(payload.referring_facility);
  if (payload.reason !== undefined) row.reason = text(payload.reason);
  if (payload.destination_facility !== undefined) row.destination_facility = text(payload.destination_facility);
  if (payload.destination_service !== undefined) row.destination_service = text(payload.destination_service);
  if (payload.priority !== undefined) {
    if (!VALID_PRIORITIES.includes(payload.priority)) throw ApiError.unprocessable('Invalid referral priority.');
    row.priority = payload.priority;
  }
  if (payload.referral_date !== undefined) row.referral_date = payload.referral_date || null;
  if (payload.scheduled_at !== undefined) row.scheduled_at = payload.scheduled_at || null;
  if (payload.chief_complaints !== undefined) row.chief_complaints = text(payload.chief_complaints);
  if (payload.medical_history !== undefined) row.medical_history = text(payload.medical_history);
  if (payload.physical_exam_findings !== undefined) row.physical_exam_findings = text(payload.physical_exam_findings);
  if (payload.impression !== undefined) row.impression = text(payload.impression);
  if (payload.treatment_visit_id !== undefined) row.treatment_visit_id = text(payload.treatment_visit_id) || null;
  if (payload.notes !== undefined) row.notes = text(payload.notes);
  if (payload.laboratory_test_required !== undefined) row.laboratory_test_required = Boolean(payload.laboratory_test_required);
  if (payload.laboratory_test !== undefined) row.laboratory_test = text(payload.laboratory_test);
  if (payload.additional_instructions !== undefined) row.additional_instructions = text(payload.additional_instructions);
  if (payload.referral_category !== undefined) row.referral_category = text(payload.referral_category);
  return row;
};

const assertNoProtectedWrite = (payload, { creating = false } = {}) => {
  if (['status', ...(creating ? [] : ['resident_id']), 'created_by', 'municipality_id', 'barangay_id', 'patient_snapshot', 'visit_snapshot', 'completed_at', 'accepted_at', 'in_progress_at', 'rejected_at', 'cancelled_at', 'snapshot_synced_at', 'resolution_notes'].some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
    throw ApiError.unprocessable('Use the status endpoint for decisions. Referral identity, scope, snapshots and timestamps cannot be overwritten.');
  }
};

const expectedVersion = (value, existing) => {
  const version = value ?? existing.version;
  if (!Number.isSafeInteger(Number(version)) || Number(version) < 1) throw ApiError.unprocessable('Invalid referral version.');
  return Number(version);
};

const write = async ({ user, id = null, action, version = null, record, supabase }) => {
  const { data, error } = await supabase.rpc('canonical_referral_write', {
    p_actor_id: user.id, p_id: id, p_action: action, p_expected_version: version, p_record: record,
  });
  throwOnError(error, 'Could not persist canonical referral');
  if (!data?.id) throw new ApiError(502, 'The canonical referral service returned an invalid response.');
  return getById({ user, id: data.id, supabase });
};

export const create = async ({ user, payload = {}, fromPhn = false, supabase = getServiceClient() }) => {
  assertWriter(user);
  // residentId is the only accepted creation identity; all stored scope is
  // derived again inside the transaction, not from this request.
  assertNoProtectedWrite(payload, { creating: true });
  const resident = await residentInScope(supabase, user, payload.residentId ?? payload.resident_id);

  assertReferralDates(payload);
  const row = sanitizeWrite(payload);
  if (!row.reason) throw ApiError.unprocessable('Referral reason is required.');
  if (row.laboratory_test_required && !row.laboratory_test) {
    throw ApiError.unprocessable('Laboratory test details are required when laboratory test is marked as required.');
  }
  Object.assign(row, await resolveRecipient(supabase, resident, payload));
  if (row.recipient_personnel_id === user.id) throw ApiError.unprocessable('Select another authorized recipient.');
  row.resident_id = resident.id;
  return write({ user, action: fromPhn ? 'create_phn' : 'create', record: row, supabase });
};

/** Load an existing referral and confirm it is in the writer's scope. */
const writableReferral = async (supabase, user, id) => {
  assertWriter(user);
  const data = await getById({ user, id, supabase });
  // Re-load the resident through the scope check: this both confirms the
  // caller covers the referral's barangay and yields scope ids for the audit.
  const resident = await residentInScope(supabase, user, data.resident_id);
  if (data.created_by !== user.id) throw ApiError.forbidden('Only the sender may edit this referral.');
  return { existing: data, resident };
};

export const update = async ({ user, id, payload = {}, supabase = getServiceClient() }) => {
  const { existing, resident } = await writableReferral(supabase, user, id);
  assertNoProtectedWrite(payload);
  if (payload.residentId !== undefined) throw ApiError.unprocessable('The referral resident cannot be changed.');
  if (CLOSED_STATUSES.has(existing.status)) throw ApiError.conflict('Closed referrals are immutable.');
  assertReferralDates(payload, { existing });
  const row = sanitizeWrite(payload);
  if (Object.prototype.hasOwnProperty.call(payload, 'reason') && !row.reason) {
    throw ApiError.unprocessable('Referral reason is required.');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'destination_facility') && !row.destination_facility) {
    throw ApiError.unprocessable('Destination facility is required.');
  }
  Object.assign(row, await resolveRecipient(supabase, resident, payload, existing));
  if (row.recipient_personnel_id === user.id) throw ApiError.unprocessable('Select another authorized recipient.');
  return write({ user, id: existing.id, action: 'update', version: expectedVersion(payload.expected_version ?? payload.version, existing), record: row, supabase });
};

export const updateStatus = async ({ user, id, status, resolutionNotes, version, supabase = getServiceClient() }) => {
  const existing = await getById({ user, id, supabase });
  if (!REFERRAL_STATUSES.includes(status) || status === 'Pending') throw ApiError.unprocessable('Invalid referral status.');
  const capabilities = capabilitiesFor(user, existing);
  if (status === 'Cancelled' ? !capabilities.is_sender : !capabilities.is_recipient) {
    throw ApiError.forbidden('Only the current recipient may make decisions; only the sender may cancel.');
  }
  if (status !== existing.status && !capabilities.allowed_statuses.includes(status)) throw ApiError.conflict('This referral status transition is not allowed.');
  if (['Rejected', 'Cancelled'].includes(status) && !text(resolutionNotes) && status !== existing.status) {
    throw ApiError.unprocessable('A reason is required for rejection or cancellation.');
  }
  return write({ user, id: existing.id, action: 'status', version: expectedVersion(version, existing), record: { status, resolution_notes: text(resolutionNotes) }, supabase });
};

export const syncSnapshots = async ({ user, id, version, supabase = getServiceClient() }) => {
  const { existing } = await writableReferral(supabase, user, id);
  if (!existing.treatment_visit_id) throw ApiError.conflict('This referral has no source treatment visit to snapshot.');
  return write({ user, id: existing.id, action: 'sync', version: expectedVersion(version, existing), record: {}, supabase });
};

/** Compatibility DELETE means cancellation, never destruction of history/FKs. */
export const remove = async ({ user, id, supabase = getServiceClient() }) => {
  const record = await updateStatus({ user, id, status: 'Cancelled', resolutionNotes: 'Cancelled by sender.', supabase });
  return { id: record.id, record };
};

const camelKeys = (row = {}) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value]));

/** The PHN document API retains old IDs/snapshots but reports the live workflow. */
export const toPhnReferral = (row) => {
  const link = row.legacy_links?.[0];
  const legacy = link?.legacy_snapshot || {};
  const originalSnapshots = !row.snapshot_synced_at && link?.legacy_snapshot;
  const schedule = row.scheduled_at ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(row.scheduled_at)) : '';
  return {
    ...camelKeys(legacy),
    id: link?.legacy_referral_id || row.id,
    canonicalId: row.id,
    legacyStatus: legacy.status || null,
    residentId: row.resident_id,
    visitId: row.treatment_visit_id || legacy.visit_id || null,
    referringFacility: row.referring_facility,
    receivingFacility: row.destination_facility,
    receivingPersonnel: row.recipient?.full_name || legacy.receiving_personnel || '',
    receivingFacilityAddress: row.recipient_facility?.address || (!row.recipient_facility_id ? legacy.receiving_facility_address : '') || '',
    referringPersonnel: row.sender?.full_name || legacy.referring_personnel || '',
    recipientPersonnelId: row.recipient_personnel_id,
    recipientFacilityId: row.recipient_facility_id,
    recipientRole: row.recipient_role,
    recipientStation: row.recipient_station,
    referralDate: row.referral_date,
    scheduledAt: row.scheduled_at || null,
    appointmentDate: schedule.slice(0, 10) || (!row.scheduled_at_edited ? legacy.appointment_date : null) || null,
    appointmentTime: schedule.slice(11, 16) || (!row.scheduled_at_edited ? legacy.appointment_time : null) || null,
    referralCategory: row.referral_category ?? legacy.referral_category ?? '',
    reasonForReferral: row.reason,
    workingImpression: row.impression,
    outpatientService: row.destination_service,
    status: row.status,
    version: row.version,
    createdById: row.created_by || legacy.created_by_id || '',
    patientSnapshot: originalSnapshots ? legacy.patient_snapshot : camelKeys(row.patient_snapshot || {}),
    visitSnapshot: originalSnapshots ? legacy.visit_snapshot : camelKeys(row.visit_snapshot || {}),
    resident: camelKeys(row.resident || {}),
    history: row.history || [],
    stage: row.stage,
    capabilities: row.capabilities,
    resolutionNotes: row.resolution_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export default { list, getById, getByVisitId, listRecipients, create, update, updateStatus, syncSnapshots, remove, assertIncomingReferral };
