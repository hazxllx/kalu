/**
 * Health services service — real, scoped, database-backed catalog + personnel
 * assignment.
 *
 * Backs public.health_services + public.health_service_assignments (see
 * supabase/migrations/20260928180000_health_services.sql) and replaces the
 * browser-only catalog that could not follow an assignment across accounts.
 *
 * SCOPE / VISIBILITY MODEL:
 *   - a service belongs to a municipality, and optionally to a facility (RHU or
 *     Barangay Health Station) and a barangay (when it is a BHS service);
 *   - municipality-wide roles (MHO / PHN / RHU Personnel) see municipality/RHU
 *     services and every barangay service in their municipality;
 *   - a barangay-scoped role (Health Supervisor / BHW) sees municipality-wide
 *     services plus the services in THEIR barangay;
 *   - additionally, any service ASSIGNED to a personnel appears in that
 *     personnel's account regardless of their barangay scope;
 *   - services are never globally visible.
 *
 * RHU is a FACILITY (facilities.type = 'rhu'), never a barangay.
 *
 * `supabase` is injectable so the unit tests can drive it without a live DB.
 */
import { getServiceClient } from '../config/supabase.js';
import { ROLES } from '../config/roles.js';
import { isApprovedBarangayName } from '../config/barangays.js';
import { isUuid } from '../validators/common.js';
import ApiError from '../utils/apiError.js';
import { notifyResident } from './notifications.service.js';
import * as storageService from './storage.service.js';

const TABLE = 'health_services';
const ASSIGN_TABLE = 'health_service_assignments';
const ATTENDANCE_TABLE = 'health_service_attendance';
const APPOINTMENTS_TABLE = 'appointments';
const PLAN_TABLE = 'visit_plans';
const ATTACHMENTS_TABLE = 'health_service_attachments';
const PAGE_SIZE = 500;
const ATTENDANCE_STATUSES = Object.freeze(['scheduled', 'attended', 'absent', 'cancelled', 'walk_in']);
const ALLOWED_MEMO_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const ALLOWED_PUBMAT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const SERVICE_CATEGORIES = Object.freeze([
  'Maternal',
  'TCLS',
  'Immunization',
  'Family Planning',
  'Consultation',
  'Other',
]);

const MANAGE_ROLES = new Set([ROLES.MHO, ROLES.PHN, ROLES.HEALTH_SUPERVISOR]);
const MUNICIPALITY_WIDE_ROLES = new Set([ROLES.MHO, ROLES.PHN, ROLES.RHU_PERSONNEL]);
const BARANGAY_SCOPED_ROLES = new Set([ROLES.HEALTH_SUPERVISOR, ROLES.BHW]);
const PERSONNEL_ROLES = new Set([...MUNICIPALITY_WIDE_ROLES, ...BARANGAY_SCOPED_ROLES]);

const text = (v) => String(v ?? '').trim();
const hhmm = (v) => (v ? String(v).slice(0, 5) : null);
const throwOnError = (error, fallback) => {
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
};

const readAllRows = async (query, fallback) => {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    throwOnError(error, fallback);
    if (data !== null && !Array.isArray(data)) throw Object.assign(new Error(fallback), { statusCode: 500 });
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
};

/**
 * QA / live-verification artifact accounts must never appear in the
 * production-facing "Assign Personnel" picker.
 *
 * The project has no is_test/is_demo column (see
 * supabase/migrations/20260915100000_create_core_org_and_profiles.sql), so the
 * only reliable classifier is the account-provisioning convention: the live
 * verification harness (backend/scripts/verify-live-workflows.mjs) registers
 * throwaway staff on the reserved `@kalusagap.test` domain with a dot-delimited
 * `qa` label in the local part — e.g. `bhw.qa.<timestamp>@kalusagap.test` and
 * `qa.unapprovable.<timestamp>@kalusagap.test`. This is the exact marker
 * documented in docs/live-verification-data.md.
 *
 * The rule is deliberately narrow so it cannot hide a real person:
 *   - it requires the reserved `@kalusagap.test` test domain, AND
 *   - a `qa` segment delimited by dots in the local part.
 * The fixed OPERATIONAL accounts on the same test domain
 * (admin@, mho@, phn@, supervisor@, rhu.personnel@ — see
 * backend/scripts/provision-official-accounts.mjs) have no `qa` label and are
 * therefore kept. Matching is on the email local part only — never the display
 * name — so a legitimate person is never excluded for having "QA" in their name.
 */
const QA_LOCALPART_LABEL = /(^|\.)qa(\.|$)/i;
const isVerificationArtifactAccount = (email) => {
  const value = text(email).toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 0) return false;
  const localPart = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (domain !== 'kalusagap.test') return false;
  return QA_LOCALPART_LABEL.test(localPart);
};

// Local "YYYY-MM-DD" check (the same rule the validator applies) so a bad date
// range is rejected before it reaches the query.
const dateIsDateOnly = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));

const PERSONNEL_SELECT = 'id, full_name, email, role, status, municipality_id, barangay_id, facility_id, municipality:municipalities(id, is_active), barangay:barangays(id, name, status, municipality_id), facility:facilities(id, type, municipality_id, barangay_id), account:personnel_accounts!account_id(approval_status, setup_required, suspended_at)';
const FACILITY_EMBED = 'facility:facilities(name, type)';
const BARANGAY_EMBED = 'barangay:barangays(name)';
const ASSIGN_EMBED = `${ASSIGN_TABLE}(id, personnel_id, active, personnel:profiles!personnel_id(${PERSONNEL_SELECT}))`;
const SELECT = `*, ${FACILITY_EMBED}, ${BARANGAY_EMBED}, ${ASSIGN_EMBED}`;

const personnelIsEligible = (profile, municipalityId) => {
  if (!profile || !isUuid(profile.id) || profile.status !== 'active' || !PERSONNEL_ROLES.has(profile.role)
    || !municipalityId || profile.municipality_id !== municipalityId
    || profile.municipality?.id !== municipalityId || profile.municipality?.is_active !== true) return false;
  const account = Array.isArray(profile.account) ? profile.account[0] : profile.account;
  if (account && (account.approval_status !== 'approved' || account.setup_required || account.suspended_at)) return false;
  if (BARANGAY_SCOPED_ROLES.has(profile.role) && !profile.barangay_id) return false;
  if (profile.barangay_id && (profile.barangay?.id !== profile.barangay_id
    || profile.barangay?.municipality_id !== municipalityId || profile.barangay?.status !== 'Active'
    || !isApprovedBarangayName(profile.barangay?.name))) return false;
  if (profile.role === ROLES.RHU_PERSONNEL && (!profile.facility_id || profile.facility?.type !== 'rhu')) return false;
  if (profile.facility_id && (profile.facility?.id !== profile.facility_id
    || profile.facility?.municipality_id !== municipalityId
    || (BARANGAY_SCOPED_ROLES.has(profile.role) && profile.facility?.type === 'barangay_health_station'
      && profile.facility.barangay_id && profile.facility.barangay_id !== profile.barangay_id))) return false;
  return true;
};

const hasResidentScope = (user) => user.role === ROLES.ADMIN || Boolean(user.municipalityId
  && PERSONNEL_ROLES.has(user.role) && (!BARANGAY_SCOPED_ROLES.has(user.role) || user.barangayId));

const residentVisibleTo = (user, resident) => Boolean(resident?.id && hasResidentScope(user)
  && (user.role === ROLES.ADMIN || (resident.municipality_id === user.municipalityId
    && (!BARANGAY_SCOPED_ROLES.has(user.role) || resident.barangay_id === user.barangayId))));

// The resident relationship is authoritative; service coverage and a plan's
// historical barangay snapshot cannot authorize disclosure of resident data.
const scopeResidentQuery = (user, query) => {
  if (user.role === ROLES.ADMIN) return query;
  let scoped = query.eq('resident.municipality_id', user.municipalityId);
  if (BARANGAY_SCOPED_ROLES.has(user.role)) scoped = scoped.eq('resident.barangay_id', user.barangayId);
  return scoped;
};

const toService = (row) => {
  if (!row) return null;
  const assignments = Array.isArray(row[ASSIGN_TABLE]) ? row[ASSIGN_TABLE] : [];
  const attachments = Array.isArray(row[ATTACHMENTS_TABLE]) ? row[ATTACHMENTS_TABLE] : [];
  const memoAttachment = attachments.find((a) => a.attachment_type === 'memo');
  const pubmatAttachment = attachments.find((a) => a.attachment_type === 'pubmat');
  
  // Derive display facility name: custom location takes precedence, then registered facility, then empty
  let facilityDisplay = '';
  if (row.custom_location) {
    facilityDisplay = row.custom_location;
  } else if (row.facility?.name) {
    facilityDisplay = row.facility.name;
  }
  
  return {
    id: row.id,
    name: row.name,
    category: row.category || 'Other',
    description: row.description || '',
    municipalityId: row.municipality_id || null,
    facilityId: row.facility_id || null,
    facility: facilityDisplay,
    facilityType: row.facility?.type || '',
    customLocation: row.custom_location || null,
    barangayId: row.barangay_id || null,
    barangay: row.barangay?.name || '',
    schedule: {
      startDate: row.start_date || null,
      startTime: hhmm(row.start_time),
      endDate: row.end_date || null,
      endTime: hhmm(row.end_time),
      registrationDeadline: row.registration_deadline || null,
    },
    active: row.active !== false,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Attachments will be populated after migration is applied
    attachments: {
      memo: memoAttachment ? {
        id: memoAttachment.id,
        filename: memoAttachment.filename,
        mimeType: memoAttachment.mime_type,
        fileSize: memoAttachment.file_size,
        storagePath: memoAttachment.storage_path,
        uploadedAt: memoAttachment.created_at,
      } : null,
      pubmat: pubmatAttachment ? {
        id: pubmatAttachment.id,
        filename: pubmatAttachment.filename,
        mimeType: pubmatAttachment.mime_type,
        fileSize: pubmatAttachment.file_size,
        storagePath: pubmatAttachment.storage_path,
        uploadedAt: pubmatAttachment.created_at,
      } : null,
    },
    assignedPersonnel: assignments
      .filter((a) => a.active === true && a.personnel?.id === a.personnel_id
        && personnelIsEligible(a.personnel, row.municipality_id))
      .map((a) => ({
        id: a.personnel_id,
        assignmentId: a.id,
        name: a.personnel?.full_name || a.personnel?.email || '',
        role: a.personnel?.role || '',
      })),
  };
};

const assertManager = (user) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');
  if (!MANAGE_ROLES.has(user.role)) {
    throw ApiError.forbidden('Your role is not authorized to manage health services.');
  }
};

const dedupeById = (rows) => {
  const seen = new Map();
  for (const r of rows) if (r && !seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()];
};

/**
 * Attach a live `registrationCount` (non-cancelled resident visit plans) to each
 * shaped service for the catalog cards. One grouped read over the already-scoped
 * service ids; a barangay-scoped role is confined to their own barangay's plans,
 * mirroring the registrations roster scope. Lookup failures are surfaced, not
 * presented as an authoritative empty roster or zero count.
 */
const attachRegistrationCounts = async (user, services, supabase) => {
  const ids = services.map((s) => s.id);
  if (ids.length === 0) return services;
  if (!hasResidentScope(user)) {
    for (const s of services) s.registrationCount = 0;
    return services;
  }
  const query = scopeResidentQuery(user, supabase.from(PLAN_TABLE)
    .select('id, service_id, resident_id, status, resident:residents!inner(id, municipality_id, barangay_id)')
    .in('service_id', ids).neq('status', 'Cancelled').order('id'));
  const rows = await readAllRows(query, 'Could not load service registration counts');
  const counts = new Map();
  for (const row of rows) {
    if (row.resident?.id !== row.resident_id || !residentVisibleTo(user, row.resident)) continue;
    counts.set(row.service_id, (counts.get(row.service_id) || 0) + 1);
  }
  for (const s of services) s.registrationCount = counts.get(s.id) || 0;
  return services;
};

/**
 * Services visible to the caller.
 *   mine=true  -> only services ASSIGNED to the caller
 *   otherwise  -> services in the caller's scope + services assigned to them
 */
export const list = async ({ user, mine = false, category = null, supabase = getServiceClient() }) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');
  if (!user.municipalityId || (!PERSONNEL_ROLES.has(user.role) && user.role !== ROLES.ADMIN)) return [];

  // An assignment is a barangay exception, never a municipality exception.
  const myAssignments = await readAllRows(supabase
    .from(ASSIGN_TABLE)
    .select('service_id')
    .eq('personnel_id', user.id)
    .eq('active', true).order('id'), 'Could not load assigned services');
  const assignedIds = (myAssignments || []).map((a) => a.service_id);

  if (mine) {
    if (assignedIds.length === 0) return [];
    let q = supabase.from(TABLE).select(SELECT).eq('municipality_id', user.municipalityId)
      .in('id', assignedIds).order('created_at', { ascending: false }).order('id');
    if (category) q = q.eq('category', category);
    const data = await readAllRows(q, 'Could not load services');
    return attachRegistrationCounts(user, data.filter((row) => row.municipality_id === user.municipalityId).map(toService), supabase);
  }

  // In-scope services.
  const results = [];
  if (user.municipalityId) {
    let scopeQuery = supabase.from(TABLE).select(SELECT).eq('municipality_id', user.municipalityId)
      .order('created_at', { ascending: false }).order('id');
    if (category) scopeQuery = scopeQuery.eq('category', category);
    const scoped = await readAllRows(scopeQuery, 'Could not load services');
    for (const row of scoped || []) {
      if (row.municipality_id !== user.municipalityId) continue;
      const muniWide = row.barangay_id === null;
      if (MUNICIPALITY_WIDE_ROLES.has(user.role)) {
        results.push(row); // sees municipality-wide + every barangay in municipality
      } else if (muniWide || row.barangay_id === user.barangayId || assignedIds.includes(row.id)) {
        results.push(row); // barangay-scoped: municipality-wide + own barangay
      }
    }
  }

  return attachRegistrationCounts(user, dedupeById(results).map(toService), supabase);
};

export const getById = async ({ user, id, supabase = getServiceClient() }) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');
  const { data, error } = await supabase.from(TABLE).select(SELECT).eq('id', id).maybeSingle();
  throwOnError(error, 'Could not load service');
  if (!data) throw ApiError.notFound('Health service not found.');

  // BUG-004: enforce the SAME scope the list visibility model applies, so a
  // known service id cannot be used to read (or, via assign/unassign, mutate)
  // an out-of-scope service. A service assigned to the caller stays visible.
  if (!(await serviceVisibleTo(user, data, supabase))) {
    throw ApiError.notFound('Health service not found.');
  }
  return toService(data);
};

/**
 * BUG-004: is this service row inside the caller's scope?
 *   admin                       -> every service
 *   MHO / PHN / RHU personnel   -> every service in their municipality
 *   Health Supervisor / BHW     -> municipality-wide services + services in
 *                                  their own barangay
 *   anyone assigned to it       -> visible regardless of barangay
 * Scope is derived from the authenticated profile, never a client id.
 */
async function serviceVisibleTo(user, row, supabase) {
  if (!row) return false;
  if (user.role === ROLES.ADMIN) return true;
  if (!PERSONNEL_ROLES.has(user.role) || !user.municipalityId || row.municipality_id !== user.municipalityId) return false;
  if (MUNICIPALITY_WIDE_ROLES.has(user.role)) return true;
  if (row.barangay_id === null || row.barangay_id === user.barangayId) return true;
  // Explicit assignments may extend barangay catalog visibility in this municipality.
  const { data, error } = await supabase
    .from(ASSIGN_TABLE)
    .select('id')
    .eq('service_id', row.id)
    .eq('personnel_id', user.id)
    .eq('active', true)
    .maybeSingle();
  throwOnError(error, 'Could not verify assignment');
  return Boolean(data);
}

/**
 * BUG-004: the stricter gate for assign/unassign. A manager may only change
 * personnel on a service inside their MANAGEMENT scope — a Health Supervisor is
 * confined to services in their own barangay (not municipality-wide services),
 * MHO/PHN manage any service in their municipality. Returns the service row.
 */
const manageableService = async (user, serviceId, supabase) => {
  const { data, error } = await supabase.from(TABLE).select(SELECT).eq('id', serviceId).maybeSingle();
  throwOnError(error, 'Could not load service');
  if (!data) throw ApiError.notFound('Health service not found.');
  const inMunicipality = user.municipalityId && data.municipality_id === user.municipalityId;
  if (user.role === ROLES.HEALTH_SUPERVISOR) {
    if (!inMunicipality || !user.barangayId || data.barangay_id !== user.barangayId) {
      throw ApiError.notFound('Health service not found.');
    }
  } else if (MUNICIPALITY_WIDE_ROLES.has(user.role)) {
    if (!inMunicipality) throw ApiError.notFound('Health service not found.');
  } else if (user.role !== ROLES.ADMIN) {
    throw ApiError.forbidden('Your role is not authorized to manage health services.');
  }
  return data;
};

const attendanceDate = (value) =>
  typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

const applyAttendanceDateRange = (query, { from, to }) => {
  let ranged = query;
  if (from) ranged = ranged.gte('scheduled_date', from);
  if (to) ranged = ranged.lte('scheduled_date', to);
  return ranged;
};

export const createHealthServiceAttendance = async ({ user, payload = {}, supabase = getServiceClient() }) => {
  assertManager(user);
  const serviceId = text(payload.service_id);
  const residentId = text(payload.resident_id);
  const scheduledDate = text(payload.scheduled_date);
  const status = text(payload.status);
  const notes = text(payload.notes);
  if (!serviceId) throw ApiError.unprocessable('A service is required.');
  if (!residentId) throw ApiError.unprocessable('A resident is required.');
  if (!attendanceDate(scheduledDate)) throw ApiError.unprocessable('Enter a valid scheduled date.');
  if (!ATTENDANCE_STATUSES.includes(status)) throw ApiError.unprocessable('Select a valid attendance status.');
  if (notes.length > 2000) throw ApiError.unprocessable('Notes must be 2000 characters or fewer.');

  await manageableService(user, serviceId, supabase);
  const { data: resident, error: residentError } = await supabase
    .from('residents')
    .select('id, municipality_id, barangay_id, barangay')
    .eq('id', residentId)
    .maybeSingle();
  throwOnError(residentError, 'Could not verify resident');
  if (!resident) throw ApiError.unprocessable('The selected resident does not exist.');

  if (!residentVisibleTo(user, resident)) throw ApiError.notFound('Resident not found in your scope.');

  const row = {
    service_id: serviceId,
    resident_id: residentId,
    scheduled_date: scheduledDate,
    attendance_status: status,
    notes,
    recorded_by: user.id,
    recorded_by_name: text(user.name),
  };
  const { data, error } = await supabase.from(ATTENDANCE_TABLE).insert(row).select('*').single();
  throwOnError(error, 'Could not create health service attendance');
  return data;
};

export const listAttendanceByService = async ({ user, query = {}, supabase = getServiceClient() }) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');
  const serviceId = text(query.service_id);
  if (!serviceId) throw ApiError.badRequest('A service reference is required.');
  await getById({ user, id: serviceId, supabase });
  if (!hasResidentScope(user)) return [];

  let request = scopeResidentQuery(user, supabase
    .from(ATTENDANCE_TABLE)
    .select('*, resident:residents!inner(id, municipality_id, barangay_id)')
    .eq('service_id', serviceId));
  request = applyAttendanceDateRange(request, query);
  const data = await readAllRows(request.order('scheduled_date', { ascending: false }).order('id'), 'Could not load health service attendance');
  return data.filter((row) => row.resident?.id === row.resident_id && residentVisibleTo(user, row.resident))
    .map(({ resident, ...attendance }) => attendance);
};

export const listAttendanceByResident = async ({ user, query = {}, supabase = getServiceClient() }) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');
  const residentId = text(query.resident_id);
  if (!residentId) throw ApiError.badRequest('A resident reference is required.');
  const { data: resident, error: residentError } = await supabase
    .from('residents')
    .select('id, municipality_id, barangay_id')
    .eq('id', residentId)
    .maybeSingle();
  throwOnError(residentError, 'Could not verify resident');
  if (!residentVisibleTo(user, resident)) throw ApiError.notFound('Resident not found.');

  let request = supabase
    .from(ATTENDANCE_TABLE)
    .select('*, service:health_services!inner(id, municipality_id, barangay_id)')
    .eq('resident_id', residentId);
  if (user.role !== ROLES.ADMIN) request = request.eq('service.municipality_id', user.municipalityId);
  request = applyAttendanceDateRange(request, query);
  const data = await readAllRows(request.order('scheduled_date', { ascending: false }).order('id'), 'Could not load health service attendance');

  const visibleRows = [];
  for (const row of data || []) {
    if (await serviceVisibleTo(user, row.service, supabase)) {
      const { service, ...attendance } = row;
      visibleRows.push(attendance);
    }
  }
  return visibleRows;
};

export const RESIDENTS_EMBED = 'resident:residents!inner(id, first_name, middle_name, last_name, sex, birth_date, barangay, municipality_id, barangay_id)';
const ATTENDANCE_SELECT = `*, service:health_services!inner(id, name, category, municipality_id, barangay_id), ${RESIDENTS_EMBED}`;

/**
 * Attendance records (scheduled health-service appointments) for the caller's
 * scope within a date range, for the dashboard calendar.
 *
 * Scope is enforced in JS from the authenticated session (the service-role
 * client bypasses RLS): a barangay-assigned Health Supervisor only sees
 * attendance for services in their barangay or assigned to them; a
 * municipality-wide caller sees every service in their municipality. Each row
 * is checked against both the service and the resident's stored scope. The
 * inner resident filters precede pagination; the service-role client does not
 * inherit resident RLS. Date filtering uses
 * `scheduled_date` against the requested `from`/`to` window.
 */
export const listScopeAttendance = async ({ user, query = {}, supabase = getServiceClient() }) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');

  const from = text(query.from);
  const to = text(query.to);
  if ((from && !dateIsDateOnly(from)) || (to && !dateIsDateOnly(to))) {
    throw ApiError.badRequest('Invalid date range for the health service calendar.');
  }
  if (!hasResidentScope(user)) return [];

  let request = scopeResidentQuery(user, supabase.from(ATTENDANCE_TABLE).select(ATTENDANCE_SELECT));
  if (user.role !== ROLES.ADMIN) request = request.eq('service.municipality_id', user.municipalityId);
  if (from) request = request.gte('scheduled_date', from);
  if (to) request = request.lte('scheduled_date', to);
  const data = await readAllRows(request.order('scheduled_date', { ascending: true }).order('id'), 'Could not load health service schedules');

  const visibleRows = [];
  for (const row of data || []) {
    if (!row.service) continue; // orphan row — not visible to anyone
    if (row.resident?.id !== row.resident_id || !residentVisibleTo(user, row.resident)) continue;
    if (!(await serviceVisibleTo(user, row.service, supabase))) continue;
    const { service, resident, ...attendance } = row;
    visibleRows.push({
      ...attendance,
      service: service ? { id: service.id, name: service.name, category: service.category } : null,
      resident: resident
        ? [resident.first_name, resident.middle_name, resident.last_name].filter(Boolean).join(' ')
        : 'Resident',
      residentBarangay: resident?.barangay || '',
      attendanceStatus: attendance.attendance_status || 'scheduled',
    });
  }
  return visibleRows;
};

export const updateHealthServiceAttendance = async ({ user, params = {}, payload = {}, supabase = getServiceClient() }) => {
  assertManager(user);
  const id = text(params.id);
  if (!id) throw ApiError.unprocessable('An attendance reference is required.');
  const { data: current, error: currentError } = await supabase
    .from(ATTENDANCE_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  throwOnError(currentError, 'Could not load health service attendance');
  if (!current) throw ApiError.notFound('Health service attendance not found.');
  await manageableService(user, current.service_id, supabase);
  const { data: resident, error: residentError } = await supabase.from('residents')
    .select('id, municipality_id, barangay_id').eq('id', current.resident_id).maybeSingle();
  throwOnError(residentError, 'Could not verify resident');
  if (!residentVisibleTo(user, resident)) throw ApiError.notFound('Health service attendance not found.');

  const patch = {};
  if (payload.status !== undefined) {
    const status = text(payload.status);
    if (!ATTENDANCE_STATUSES.includes(status)) throw ApiError.unprocessable('Select a valid attendance status.');
    patch.attendance_status = status;
    if (status === 'attended' && payload.attended_at == null) patch.attended_at = new Date().toISOString();
  }
  if (payload.notes !== undefined) {
    if (typeof payload.notes !== 'string' || payload.notes.length > 2000) {
      throw ApiError.unprocessable('Notes must be a string of 2000 characters or fewer.');
    }
    patch.notes = payload.notes.trim();
  }
  if (payload.attended_at !== undefined) {
    if (payload.attended_at !== null && (typeof payload.attended_at !== 'string' || Number.isNaN(Date.parse(payload.attended_at)))) {
      throw ApiError.unprocessable('Enter a valid attendance timestamp.');
    }
    patch.attended_at = patch.attendance_status === 'attended' && payload.attended_at === null
      ? new Date().toISOString()
      : payload.attended_at;
  }
  if (Object.keys(patch).length === 0) throw ApiError.badRequest('Provide at least one attendance field to update.');

  const { data, error } = await supabase
    .from(ATTENDANCE_TABLE)
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  throwOnError(error, 'Could not update health service attendance');
  return data;
};

const residentDisplayName = (r) =>
  [r?.first_name, r?.middle_name, r?.last_name].filter(Boolean).join(' ').trim() || 'Resident';

/**
 * Resident registrations (visit plans) for a single health service, for the
 * authorized staff responsible for it, plus any attendance already recorded.
 *
 * This is the staff-facing counterpart of the resident "I plan to visit"
 * directory: a resident who registers for a service creates a public.visit_plans
 * row (see visitPlans.service.js); this surfaces those rows — with the
 * resident's name, barangay, registration timestamp and status — to the staff
 * who own the service, and cross-references public.health_service_attendance so
 * the roster shows who has been marked attended / absent.
 *
 * Scope is derived from the authenticated session, never client input:
 *   - `getById` first confirms the service is inside the caller's visibility
 *     scope (or 404), reusing the catalog's established scope model;
 *   - a barangay-scoped role (Health Supervisor / BHW) only ever sees
 *     registrations from their OWN barangay, mirroring the visit_plans RLS;
 *   - municipality-wide roles (MHO / PHN / RHU Personnel) see every
 *     registration for the service in their municipality.
 * No new table is introduced — visit_plans, residents and
 * health_service_attendance are reused.
 */
export const listServiceRegistrations = async ({ user, serviceId, supabase = getServiceClient() }) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');
  // Scope + existence gate (throws 404 when out of scope or unknown).
  const service = await getById({ user, id: serviceId, supabase });
  if (!hasResidentScope(user)) return { service, registrations: [], counts: emptyRegistrationCounts() };

  const planQuery = scopeResidentQuery(user, supabase
    .from(PLAN_TABLE)
    .select(`id, resident_id, barangay_id, facility_type, planned_date, note, status, created_at, updated_at, ${RESIDENTS_EMBED}`)
    .eq('service_id', serviceId)
    .order('planned_date', { ascending: false }).order('id'));
  const plans = await readAllRows(planQuery, 'Could not load service registrations');
  const planRows = plans.filter((row) => row.resident?.id === row.resident_id && residentVisibleTo(user, row.resident));

  const residentIds = [...new Set(planRows.map((p) => p.resident_id).filter(Boolean))];
  const attendanceByResident = new Map();
  if (residentIds.length > 0) {
    const attendance = await readAllRows(supabase.from(ATTENDANCE_TABLE)
      .select('id, resident_id, attendance_status, attended_at, scheduled_date')
      .eq('service_id', serviceId).in('resident_id', residentIds)
      .order('scheduled_date', { ascending: false }).order('id'), 'Could not load attendance');
    // Keep the most recent attendance record per resident (ordered desc above).
    for (const a of attendance || []) {
      if (!attendanceByResident.has(a.resident_id)) attendanceByResident.set(a.resident_id, a);
    }
  }

  const registrations = planRows.map((p) => {
    const resident = p.resident;
    const att = attendanceByResident.get(p.resident_id) || null;
    return {
      id: p.id,
      residentId: p.resident_id,
      residentName: residentDisplayName(resident),
      barangay: resident?.barangay || '',
      facilityType: p.facility_type,
      plannedDate: p.planned_date,
      note: p.note || '',
      status: p.status,
      registeredAt: p.created_at,
      attendance: att
        ? {
            id: att.id,
            status: att.attendance_status,
            attendedAt: att.attended_at || null,
            scheduledDate: att.scheduled_date,
          }
        : null,
    };
  });

  return { service, registrations, counts: countRegistrations(registrations) };
};

const emptyRegistrationCounts = () => ({
  registered: 0,
  cancelled: 0,
  attended: 0,
  absent: 0,
  pendingAttendance: 0,
});

/** Tally registrations by status for the staff roster header. */
const countRegistrations = (registrations) => {
  const counts = emptyRegistrationCounts();
  for (const r of registrations) {
    if (r.status === 'Cancelled') {
      counts.cancelled += 1;
      continue;
    }
    counts.registered += 1; // Planned
    const attStatus = r.attendance?.status || null;
    if (attStatus === 'attended' || attStatus === 'walk_in') counts.attended += 1;
    else if (attStatus === 'absent') counts.absent += 1;
    else counts.pendingAttendance += 1;
  }
  return counts;
};

/**
 * Find an existing facility by name within the caller's municipality
 * (case-insensitive, so the same place is never duplicated), or create one when
 * the user typed a brand-new name.
 *
 * A newly entered facility is recorded as a Barangay Health Station: for a
 * Health Supervisor it is tied to their assigned barangay (derived from the
 * session), otherwise it carries no barangay (a municipality-level health
 * center) and the resulting service is municipality-wide. The service-role
 * client is used so this works for the manage roles even though the direct
 * `facilities` RLS limits inserts to admin/MHO; `assertManager` + the
 * municipality scope checked here are the authoritative server-side gate.
 */
const resolveOrCreateFacilityByName = async (user, { municipalityId, name, supervisorBarangayId, isSupervisor }, supabase) => {
  const trimmed = text(name);
  if (!trimmed) throw ApiError.unprocessable('Enter a facility name.');

  // Reuse an existing facility with the same name (case-insensitive) to avoid
  // duplicates. `_` and `%` are escaped so a literal name is matched, and a
  // limited ordered read tolerates pre-existing case variants.
  const pattern = trimmed.replace(/[\\%_]/g, (m) => `\\${m}`);
  const { data: matches, error: findErr } = await supabase
    .from('facilities')
    .select('id, municipality_id, barangay_id, type')
    .eq('municipality_id', municipalityId)
    .ilike('name', pattern)
    .order('created_at', { ascending: true })
    .limit(1);
  throwOnError(findErr, 'Could not verify facility');
  if (matches && matches[0]) return matches[0];

  const insertRow = {
    municipality_id: municipalityId,
    name: trimmed,
    type: 'barangay_health_station',
    barangay_id: isSupervisor ? supervisorBarangayId : null,
  };
  const { data: created, error: createErr } = await supabase
    .from('facilities')
    .insert(insertRow)
    .select('id, municipality_id, barangay_id, type')
    .single();
  if (createErr) {
    // Lost a race against the unique (municipality_id, name) constraint — the
    // other writer created it, so re-read instead of failing the request.
    const { data: raced, error: raceErr } = await supabase
      .from('facilities')
      .select('id, municipality_id, barangay_id, type')
      .eq('municipality_id', municipalityId)
      .ilike('name', pattern)
      .order('created_at', { ascending: true })
      .limit(1);
    if (raced && raced[0]) return raced[0];
    throwOnError(raceErr, 'Could not verify the facility after creation failed');
    throwOnError(createErr, 'Could not create the facility');
  }
  return created;
};

/**
 * Resolve the scope columns (facility + barangay) for a new service from the
 * caller + payload. The barangay is DERIVED, never submitted:
 *   - municipality-wide (or no facility)   -> facility null, barangay null;
 *   - RHU facility                          -> that facility, barangay null;
 *   - Barangay Health Station facility      -> that facility, barangay = the
 *     facility's barangay (for a Health Supervisor, their own assigned
 *     barangay, which a chosen BHS must belong to).
 * A new free-typed facility name is resolved/created by
 * `resolveOrCreateFacilityByName`. A facility must be in the caller's
 * municipality.
 */
const resolveScope = async (user, payload, supabase) => {
  const municipalityId = user.municipalityId;
  if (!municipalityId) throw ApiError.unprocessable('Your account has no municipality assignment.');

  const isSupervisor = user.role === ROLES.HEALTH_SUPERVISOR;
  const supervisorBarangayId = isSupervisor ? (user.barangayId || null) : null;
  if (isSupervisor && !supervisorBarangayId) {
    throw ApiError.unprocessable('Your account has no barangay assignment.');
  }

  const municipalityWide = payload.municipalityWide === true;
  const facilityId = text(payload.facilityId || payload.facility_id) || null;
  const facilityName = text(payload.facilityName || payload.facility_name) || null;

  // Explicit municipality-wide, or nothing chosen: no facility, no barangay.
  if (municipalityWide || (!facilityId && !facilityName)) {
    return { municipalityId, facilityId: null, customLocation: null, barangayId: null };
  }

  let facility = null;
  let customLocation = null;

  if (facilityId) {
    // User selected a registered facility
    const { data, error } = await supabase
      .from('facilities')
      .select('id, municipality_id, barangay_id, type')
      .eq('id', facilityId)
      .maybeSingle();
    throwOnError(error, 'Could not verify facility');
    if (!data || data.municipality_id !== municipalityId) {
      throw ApiError.unprocessable('The selected facility is not in your municipality.');
    }
    facility = data;
  } else if (facilityName) {
    // User entered a custom location name (not from registered facilities)
    customLocation = facilityName;
  }

  // Derive barangay from facility type only (custom locations don't affect barangay scope)
  let barangayId = facility && facility.type === 'barangay_health_station' ? (facility.barangay_id || null) : null;

  if (isSupervisor && facility && facility.type === 'barangay_health_station') {
    // A supervisor's BHS must be in their assigned barangay; a BHS with no
    // barangay yet adopts theirs. (An RHU chosen by a supervisor stays
    // barangay-less — an RHU-wide service, per the coverage rules.)
    if (facility.barangay_id && facility.barangay_id !== supervisorBarangayId) {
      throw ApiError.unprocessable('That barangay health center is not in your assigned barangay.');
    }
    barangayId = supervisorBarangayId;
  }

  return { municipalityId, facilityId: facility ? facility.id : null, customLocation, barangayId };
};

const notifyAssignees = async (supabase, { serviceName, personnelIds, assignedBy }) => {
  await Promise.all(
    (personnelIds || []).filter(Boolean).map((personnelId) =>
      notifyResident({
        recipientAuthUserId: personnelId,
        category: 'information',
        title: 'Health service assigned',
        message: `You have been assigned to the "${serviceName}" health service.`,
        relatedType: TABLE,
        relatedId: assignedBy || null,
      }),
    ),
  );
};

const assignmentPersonnelIds = (values) => {
  if (values == null) return [];
  if (!Array.isArray(values)) throw ApiError.unprocessable('Select personnel from the authorized directory.');
  const ids = [...new Set(values.map((value) => text(value)).filter(Boolean))];
  if (ids.some((id) => !isUuid(id))) throw ApiError.unprocessable('Select personnel from the authorized directory.');
  return ids;
};

const loadAssignableProfiles = async (user, personnelIds, supabase) => {
  if (!user.municipalityId || (user.role === ROLES.HEALTH_SUPERVISOR && !user.barangayId)) return [];
  let query = supabase.from('profiles').select(PERSONNEL_SELECT)
    .eq('municipality_id', user.municipalityId).eq('status', 'active').in('role', [...PERSONNEL_ROLES]).order('id');
  if (personnelIds) query = query.in('id', personnelIds);
  if (user.role === ROLES.HEALTH_SUPERVISOR) query = query.eq('barangay_id', user.barangayId);
  const profiles = await readAllRows(query, 'Could not load personnel');
  return profiles.filter((profile) => personnelIsEligible(profile, user.municipalityId)
    && (user.role !== ROLES.HEALTH_SUPERVISOR || profile.barangay_id === user.barangayId)
    && !isVerificationArtifactAccount(profile.email));
};

const validatePersonnelAssignments = async (user, service, personnelIds, supabase) => {
  if (personnelIds.length === 0) return;
  if (!user.municipalityId || service.municipality_id !== user.municipalityId) {
    throw ApiError.unprocessable('Personnel must belong to the service municipality.');
  }
  // Municipal managers may explicitly assign across barangays in their own
  // municipality. Supervisors retain the narrower existing personnel directory.
  const profiles = await loadAssignableProfiles(user, personnelIds, supabase);
  const eligibleIds = new Set(profiles.map((profile) => profile.id));
  if (personnelIds.some((id) => !eligibleIds.has(id))) {
    throw ApiError.unprocessable('One or more selected personnel are inactive or outside the authorized assignment scope.', {
      personnelIds: 'Select active personnel from the authorized directory.',
    });
  }
};

export const create = async ({ user, payload = {}, supabase = getServiceClient() }) => {
  assertManager(user);
  const name = text(payload.name);
  if (!name) throw ApiError.unprocessable('A service name is required.');
  const category = SERVICE_CATEGORIES.includes(text(payload.category)) ? text(payload.category) : 'Other';
  const personnelIds = assignmentPersonnelIds(payload.personnelIds);
  await validatePersonnelAssignments(user, { municipality_id: user.municipalityId }, personnelIds, supabase);

  const scope = await resolveScope(user, payload, supabase);

  const startDate = text(payload.startDate || payload.start_date) || null;
  const endDate = text(payload.endDate || payload.end_date) || startDate; // one-day service ends on its start date
  const row = {
    name,
    category,
    description: text(payload.description),
    municipality_id: scope.municipalityId,
    facility_id: scope.facilityId,
    barangay_id: scope.barangayId,
    custom_location: scope.customLocation || null,
    start_date: startDate,
    start_time: text(payload.startTime || payload.start_time) || null,
    end_date: endDate,
    end_time: text(payload.endTime || payload.end_time) || null,
    registration_deadline: text(payload.registrationDeadline || payload.registration_deadline) || null,
    active: payload.active === false ? false : true,
    created_by: user.id,
  };

  const { data, error } = await supabase.from(TABLE).insert(row).select(SELECT).single();
  throwOnError(error, 'Could not create the health service');

  // Optional initial personnel assignment.
  if (personnelIds.length > 0) {
    const rows = personnelIds.map((personnelId) => ({
      service_id: data.id,
      personnel_id: personnelId,
      assigned_by: user.id,
      active: true,
    }));
    const { error: assignError } = await supabase.from(ASSIGN_TABLE).upsert(rows, { onConflict: 'service_id,personnel_id' });
    throwOnError(assignError, 'Could not assign personnel to the service');
    await notifyAssignees(supabase, { serviceName: name, personnelIds, assignedBy: data.id });
  }

  return getById({ user, id: data.id, supabase });
};

/**
 * Update an existing health service. BUG/REDESIGN: edit must never create a new
 * row — it mutates the existing record in place, preserving its id and every
 * dependent record (visit_plans registrations, attendance). Scope + management
 * authority are re-checked server-side via `manageableService` (a Health
 * Supervisor is confined to services in their own barangay). The barangay is
 * never submitted: when the facility/coverage is changed it is re-derived from
 * the chosen facility + the session, exactly like create.
 *
 * Two payload shapes are accepted:
 *   - a STATUS-ONLY update ({ active }) — used by the activate/deactivate
 *     action — which touches only the `active` flag;
 *   - a FULL content update (name/category/description/schedule/facility/
 *     personnel/active) from the shared create/edit form.
 */
export const update = async ({ user, serviceId, payload = {}, supabase = getServiceClient() }) => {
  assertManager(user);
  const existing = await manageableService(user, serviceId, supabase); // BUG-004: scope + management check

  const row = { updated_at: new Date().toISOString() };
  const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  const personnelIds = has('personnelIds') ? assignmentPersonnelIds(payload.personnelIds) : null;
  if (personnelIds) await validatePersonnelAssignments(user, existing, personnelIds, supabase);

  // Content fields — only written when supplied, so a status-only toggle leaves
  // the schedule/coverage untouched.
  if (has('name')) {
    const name = text(payload.name);
    if (!name) throw ApiError.unprocessable('A service name is required.');
    row.name = name;
  }
  if (has('category')) {
    row.category = SERVICE_CATEGORIES.includes(text(payload.category)) ? text(payload.category) : 'Other';
  }
  if (has('description')) row.description = text(payload.description);

  if (has('startDate') || has('start_date')) row.start_date = text(payload.startDate || payload.start_date) || null;
  if (has('startTime') || has('start_time')) row.start_time = text(payload.startTime || payload.start_time) || null;
  if (has('endTime') || has('end_time')) row.end_time = text(payload.endTime || payload.end_time) || null;
  if (has('endDate') || has('end_date')) {
    // A one-day service (no end date) is stored as ending on its start date.
    const endDate = text(payload.endDate || payload.end_date);
    const startDate = row.start_date !== undefined ? row.start_date : existing.start_date;
    row.end_date = endDate || startDate || null;
  }
  if (has('registrationDeadline') || has('registration_deadline')) {
    row.registration_deadline = text(payload.registrationDeadline || payload.registration_deadline) || null;
  }

  // Facility / coverage: only re-derive the scope when a coverage field was
  // supplied, so a status-only or content-only edit never silently moves the
  // service to a different barangay.
  if (has('facilityId') || has('facility_id') || has('facilityName') || has('facility_name') || has('municipalityWide')) {
    const scope = await resolveScope(user, payload, supabase);
    row.facility_id = scope.facilityId;
    row.custom_location = scope.customLocation || null;
    row.barangay_id = scope.barangayId;
  }

  if (has('active')) row.active = payload.active === false ? false : Boolean(payload.active);

  const { error } = await supabase.from(TABLE).update(row).eq('id', serviceId);
  throwOnError(error, 'Could not update the health service');

  // Personnel reconciliation — add newly selected, deactivate removed. Existing
  // assignments (and their id) are preserved; a removed person is soft-marked
  // inactive, never hard-deleted, so historical attendance stays attributable.
  if (personnelIds) {
    const wanted = new Set(personnelIds);
    const current = (existing[ASSIGN_TABLE] || []).filter((a) => a.active !== false);
    const currentIds = new Set(current.map((a) => a.personnel_id));

    const toAdd = [...wanted].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !wanted.has(id));

    if (toAdd.length > 0) {
      const rows = toAdd.map((personnelId) => ({
        service_id: serviceId,
        personnel_id: personnelId,
        assigned_by: user.id,
        active: true,
      }));
      const { error: addErr } = await supabase.from(ASSIGN_TABLE).upsert(rows, { onConflict: 'service_id,personnel_id' });
      throwOnError(addErr, 'Could not update personnel assignments');
      await notifyAssignees(supabase, { serviceName: row.name || existing.name, personnelIds: toAdd, assignedBy: serviceId });
    }
    if (toRemove.length > 0) {
      const { error: remErr } = await supabase
        .from(ASSIGN_TABLE)
        .update({ active: false })
        .eq('service_id', serviceId)
        .in('personnel_id', toRemove);
      throwOnError(remErr, 'Could not update personnel assignments');
    }
  }

  return getById({ user, id: serviceId, supabase });
};

/**
 * Dependent-record counts for a service. Used to decide whether a destructive
 * delete is safe. Registrations (visit_plans) and attendance records both
 * reference the service with ON DELETE CASCADE, so a hard delete would destroy
 * resident data; booked appointments reference it ON DELETE RESTRICT, so the DB
 * itself refuses the delete. These counts gate that with a clear message.
 */
const countServiceDependents = async (serviceId, supabase) => {
  const [
    { count: planCount, error: planErr },
    { count: attCount, error: attErr },
    { count: apptCount, error: apptErr },
  ] = await Promise.all([
    supabase.from(PLAN_TABLE).select('id', { count: 'exact', head: true }).eq('service_id', serviceId),
    supabase.from(ATTENDANCE_TABLE).select('id', { count: 'exact', head: true }).eq('service_id', serviceId),
    supabase.from(APPOINTMENTS_TABLE).select('id', { count: 'exact', head: true }).eq('service_id', serviceId),
  ]);
  throwOnError(planErr || attErr || apptErr, 'Could not check dependent records');
  return { registrations: planCount || 0, attendance: attCount || 0, appointments: apptCount || 0 };
};

/**
 * Delete a health service SAFELY.
 *
 * public.visit_plans and public.health_service_attendance reference
 * health_services ON DELETE CASCADE, and public.appointments references it ON
 * DELETE RESTRICT, so an unconditional delete would either cascade-destroy
 * resident registrations/attendance history or be refused outright by the
 * appointments FK. Per the data-retention rules this is refused up-front: when
 * ANY dependent record exists the service is NOT deleted and a 409 is returned
 * telling the caller to deactivate (archive) it instead. Deactivation is a
 * reversible `active = false` update, which hides the service from the active
 * catalog while preserving all records.
 *
 * Only when a service has no registrations, no attendance and no appointments
 * is a hard delete performed (it then cascades only personnel assignment links,
 * which carry no clinical/resident data). Scope + management authority are
 * enforced first.
 */
export const remove = async ({ user, serviceId, supabase = getServiceClient() }) => {
  assertManager(user);
  const service = await manageableService(user, serviceId, supabase); // BUG-004: scope + management check

  const dependents = await countServiceDependents(serviceId, supabase);
  if (dependents.registrations > 0 || dependents.attendance > 0 || dependents.appointments > 0) {
    throw ApiError.conflict(
      'This service has resident registrations, appointments, or attendance records and cannot be deleted. Deactivate (archive) it instead to preserve those records.',
      { reason: 'has_dependents', dependents },
    );
  }

  const { error } = await supabase.from(TABLE).delete().eq('id', serviceId);
  throwOnError(error, 'Could not delete the health service');
  return { id: serviceId, name: service.name, deleted: true };
};

export const assign = async ({ user, serviceId, personnelId, supabase = getServiceClient() }) => {
  assertManager(user);
  const pid = text(personnelId);
  if (!pid) throw ApiError.unprocessable('Select a personnel to assign.');
  const service = await manageableService(user, serviceId, supabase); // BUG-004: scope + management check
  await validatePersonnelAssignments(user, service, assignmentPersonnelIds([pid]), supabase);
  const { error } = await supabase
    .from(ASSIGN_TABLE)
    .upsert({ service_id: serviceId, personnel_id: pid, assigned_by: user.id, active: true }, { onConflict: 'service_id,personnel_id' });
  throwOnError(error, 'Could not assign personnel');
  await notifyAssignees(supabase, { serviceName: service.name, personnelIds: [pid], assignedBy: serviceId });
  return getById({ user, id: serviceId, supabase });
};

export const unassign = async ({ user, serviceId, personnelId, supabase = getServiceClient() }) => {
  assertManager(user);
  await manageableService(user, serviceId, supabase); // BUG-004: scope + management check
  const { error } = await supabase
    .from(ASSIGN_TABLE)
    .update({ active: false })
    .eq('service_id', serviceId)
    .eq('personnel_id', text(personnelId));
  throwOnError(error, 'Could not remove the assignment');
  return getById({ user, id: serviceId, supabase });
};

/** Active staff in the caller's municipality who can be assigned a service. */
export const assignablePersonnel = async ({ user, supabase = getServiceClient() }) => {
  assertManager(user);
  const scoped = await loadAssignableProfiles(user, null, supabase);
  // Exclude QA / live-verification artifact accounts (see
  // isVerificationArtifactAccount) and deduplicate by the stable profile id so
  // the picker lists every eligible person exactly once — never by display
  // name, which is not unique (profiles.full_name has no uniqueness).
  const seen = new Set();
  const eligible = [];
  for (const p of scoped) {
    if (isVerificationArtifactAccount(p.email)) continue;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    eligible.push(p);
  }
  return eligible.map((p) => ({
    id: p.id,
    name: p.full_name || p.email,
    role: p.role,
    barangayId: p.barangay_id || null,
  }));
};

export const meta = () => ({ categories: SERVICE_CATEGORIES });

/**
 * Reference data for the service form, scoped to the caller's municipality:
 * real barangays and facilities (RHU + Barangay Health Stations) with ids, plus
 * the category vocabulary. Lets the UI populate the facility combobox from the
 * database instead of hardcoding, and keeps RHU modeled as a facility (never a
 * barangay). Facilities include their `barangayId` so the UI can show the
 * coverage a chosen Barangay Health Station implies, and `assignedBarangay`
 * exposes the Health Supervisor's own barangay (derived from the session) so
 * the form can display the auto-applied coverage without a barangay selector.
 */
export const reference = async ({ user, supabase = getServiceClient() }) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');
  const out = { categories: SERVICE_CATEGORIES, barangays: [], facilities: [], assignedBarangay: null };
  if (!user.municipalityId) return out;

  const [{ data: barangays, error: bErr }, { data: facilities, error: fErr }] = await Promise.all([
    supabase.from('barangays').select('id, name').eq('municipality_id', user.municipalityId).order('name'),
    supabase.from('facilities').select('id, name, type, barangay_id').eq('municipality_id', user.municipalityId).order('name'),
  ]);
  throwOnError(bErr || fErr, 'Could not load reference data');

  // A barangay-scoped Health Supervisor only picks within their own barangay.
  const scopedBarangays = user.role === ROLES.HEALTH_SUPERVISOR && user.barangayId
    ? (barangays || []).filter((b) => b.id === user.barangayId)
    : barangays || [];

  out.barangays = scopedBarangays.map((b) => ({ id: b.id, name: b.name }));
  out.facilities = (facilities || []).map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type || '',
    barangayId: f.barangay_id || null,
  }));

  if (user.role === ROLES.HEALTH_SUPERVISOR && user.barangayId) {
    const own = (barangays || []).find((b) => b.id === user.barangayId) || null;
    out.assignedBarangay = { id: user.barangayId, name: own?.name || user.barangay || '' };
  }
  return out;
};

/**
 * Upload a health service attachment (memo or pubmat).
 * Validates file type, stores in Supabase Storage, and persists metadata in DB.
 */
export const uploadAttachment = async ({ user, serviceId, attachmentType, file, supabase = getServiceClient() }) => {
  assertManager(user);
  
  if (!file) throw ApiError.unprocessable('No file provided.');
  if (!['memo', 'pubmat'].includes(attachmentType)) {
    throw ApiError.unprocessable('Attachment type must be "memo" or "pubmat".');
  }

  // Validate file type
  const allowedTypes = attachmentType === 'memo' ? ALLOWED_MEMO_TYPES : ALLOWED_PUBMAT_TYPES;
  if (!allowedTypes.includes(file.type)) {
    throw ApiError.unprocessable(
      `Invalid file type. ${attachmentType === 'memo' ? 'Memo must be PDF, DOC, or DOCX' : 'Pubmat must be JPG, PNG, or WebP'}.`
    );
  }

  // Validate file size (10 MB for memo, 5 MB for pubmat)
  const maxSize = attachmentType === 'memo' ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
  if (file.size > maxSize) {
    throw ApiError.unprocessable(
      `File is too large. Maximum ${attachmentType === 'memo' ? '10 MB' : '5 MB'} allowed.`
    );
  }

  // Verify service exists and user can manage it
  const service = await manageableService(user, serviceId, supabase);

  // Delete existing attachment if present
  const { data: existing } = await supabase
    .from(ATTACHMENTS_TABLE)
    .select('storage_path')
    .eq('health_service_id', serviceId)
    .eq('attachment_type', attachmentType)
    .single();

  if (existing?.storage_path) {
    try {
      await storageService.deleteHealthServiceAttachment(existing.storage_path);
    } catch (err) {
      console.error('Failed to delete old attachment:', err);
      // Continue anyway — the old file is orphaned but the upload proceeds
    }
  }

  // Upload to storage
  let uploadResult;
  try {
    uploadResult = await storageService.uploadHealthServiceAttachment({
      file,
      serviceId,
      attachmentType,
    });
  } catch (err) {
    throw ApiError.internal(`Upload failed: ${err.message}`);
  }

  // Upsert attachment record in DB
  const { data: attachment, error } = await supabase
    .from(ATTACHMENTS_TABLE)
    .upsert(
      {
        health_service_id: serviceId,
        attachment_type: attachmentType,
        filename: uploadResult.filename,
        mime_type: uploadResult.mimeType,
        file_size: uploadResult.fileSize,
        storage_path: uploadResult.storagePath,
        uploaded_by: user.id,
      },
      { onConflict: 'health_service_id,attachment_type' }
    )
    .select()
    .single();

  throwOnError(error, 'Could not save attachment metadata');

  return attachment;
};

/**
 * Delete a health service attachment.
 * Removes from Supabase Storage and deletes the database record.
 */
export const deleteAttachment = async ({ user, serviceId, attachmentType, supabase = getServiceClient() }) => {
  assertManager(user);

  if (!['memo', 'pubmat'].includes(attachmentType)) {
    throw ApiError.unprocessable('Attachment type must be "memo" or "pubmat".');
  }

  // Verify service exists and user can manage it
  await manageableService(user, serviceId, supabase);

  // Get attachment to find storage path
  const { data: attachment, error: getErr } = await supabase
    .from(ATTACHMENTS_TABLE)
    .select('id, storage_path')
    .eq('health_service_id', serviceId)
    .eq('attachment_type', attachmentType)
    .single();

  if (getErr && getErr.code !== 'PGRST116') {
    // PGRST116 is "not found" — that's okay
    throwOnError(getErr, 'Could not retrieve attachment');
  }

  if (attachment?.storage_path) {
    try {
      await storageService.deleteHealthServiceAttachment(attachment.storage_path);
    } catch (err) {
      console.error('Failed to delete attachment from storage:', err);
      // Continue — the DB record will be cleaned up anyway
    }
  }

  // Delete DB record
  const { error: deleteErr } = await supabase
    .from(ATTACHMENTS_TABLE)
    .delete()
    .eq('health_service_id', serviceId)
    .eq('attachment_type', attachmentType);

  throwOnError(deleteErr, 'Could not delete attachment');

  return { id: serviceId, attachmentType, deleted: true };
};

/**
 * Get a signed URL for a health service attachment.
 */
export const getAttachmentSignedUrl = async ({ user, serviceId, attachmentType, supabase = getServiceClient() }) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');

  if (!['memo', 'pubmat'].includes(attachmentType)) {
    throw ApiError.unprocessable('Attachment type must be "memo" or "pubmat".');
  }

  // Verify service is visible to the user
  const service = await getById({ user, id: serviceId, supabase });
  if (!service) throw ApiError.notFound('Service not found.');

  // Get attachment to find storage path
  const { data: attachment, error: getErr } = await supabase
    .from(ATTACHMENTS_TABLE)
    .select('storage_path')
    .eq('health_service_id', serviceId)
    .eq('attachment_type', attachmentType)
    .single();

  if (getErr && getErr.code !== 'PGRST116') {
    throwOnError(getErr, 'Could not retrieve attachment');
  }

  if (!attachment?.storage_path) {
    throw ApiError.notFound('Attachment not found.');
  }

  const url = await storageService.getDocumentSignedUrl(attachment.storage_path);
  return url;
};

export default {
  SERVICE_CATEGORIES,
  list,
  getById,
  create,
  update,
  remove,
  assign,
  unassign,
  assignablePersonnel,
  reference,
  meta,
  uploadAttachment,
  deleteAttachment,
  getAttachmentSignedUrl,
  createHealthServiceAttendance,
  listAttendanceByService,
  listAttendanceByResident,
  listScopeAttendance,
  updateHealthServiceAttendance,
  listServiceRegistrations,
};
