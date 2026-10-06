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
import ApiError from '../utils/apiError.js';
import { notifyResident } from './notifications.service.js';

const TABLE = 'health_services';
const ASSIGN_TABLE = 'health_service_assignments';
const ATTENDANCE_TABLE = 'health_service_attendance';
const ATTENDANCE_STATUSES = Object.freeze(['scheduled', 'attended', 'absent', 'cancelled', 'walk_in']);

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

const text = (v) => String(v ?? '').trim();
const throwOnError = (error, fallback) => {
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
};

// Local "YYYY-MM-DD" check (the same rule the validator applies) so a bad date
// range is rejected before it reaches the query.
const dateIsDateOnly = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));

const FACILITY_EMBED = 'facility:facilities(name, type)';
const BARANGAY_EMBED = 'barangay:barangays(name)';
const ASSIGN_EMBED = `${ASSIGN_TABLE}(id, personnel_id, active, personnel:profiles!personnel_id(full_name, email, role))`;
const SELECT = `*, ${FACILITY_EMBED}, ${BARANGAY_EMBED}, ${ASSIGN_EMBED}`;

const toService = (row) => {
  if (!row) return null;
  const assignments = Array.isArray(row[ASSIGN_TABLE]) ? row[ASSIGN_TABLE] : [];
  return {
    id: row.id,
    name: row.name,
    category: row.category || 'Other',
    description: row.description || '',
    municipalityId: row.municipality_id || null,
    facilityId: row.facility_id || null,
    facility: row.facility?.name || '',
    facilityType: row.facility?.type || '',
    barangayId: row.barangay_id || null,
    barangay: row.barangay?.name || '',
    active: row.active !== false,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignedPersonnel: assignments
      .filter((a) => a.active !== false)
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
 * Services visible to the caller.
 *   mine=true  -> only services ASSIGNED to the caller
 *   otherwise  -> services in the caller's scope + services assigned to them
 */
export const list = async ({ user, mine = false, category = null, supabase = getServiceClient() }) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');

  // Services assigned to the caller (always included).
  const { data: myAssignments, error: assignErr } = await supabase
    .from(ASSIGN_TABLE)
    .select('service_id')
    .eq('personnel_id', user.id)
    .eq('active', true);
  throwOnError(assignErr, 'Could not load assigned services');
  const assignedIds = (myAssignments || []).map((a) => a.service_id);

  if (mine) {
    if (assignedIds.length === 0) return [];
    let q = supabase.from(TABLE).select(SELECT).in('id', assignedIds).order('created_at', { ascending: false });
    if (category) q = q.eq('category', category);
    const { data, error } = await q;
    throwOnError(error, 'Could not load services');
    return (data || []).map(toService);
  }

  // In-scope services.
  const results = [];
  if (user.municipalityId) {
    let scopeQuery = supabase.from(TABLE).select(SELECT).eq('municipality_id', user.municipalityId).order('created_at', { ascending: false });
    if (category) scopeQuery = scopeQuery.eq('category', category);
    const { data: scoped, error: scopeErr } = await scopeQuery;
    throwOnError(scopeErr, 'Could not load services');
    for (const row of scoped || []) {
      const muniWide = row.barangay_id === null;
      if (MUNICIPALITY_WIDE_ROLES.has(user.role)) {
        results.push(row); // sees municipality-wide + every barangay in municipality
      } else if (muniWide || row.barangay_id === user.barangayId) {
        results.push(row); // barangay-scoped: municipality-wide + own barangay
      }
    }
  }

  // Plus any assigned service outside the scope filter.
  if (assignedIds.length > 0) {
    const missing = assignedIds.filter((id) => !results.some((r) => r.id === id));
    if (missing.length > 0) {
      const { data: extra, error: extraErr } = await supabase.from(TABLE).select(SELECT).in('id', missing);
      throwOnError(extraErr, 'Could not load assigned services');
      results.push(...(extra || []));
    }
  }

  return dedupeById(results).map(toService);
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
  if (user.municipalityId && row.municipality_id === user.municipalityId) {
    if (MUNICIPALITY_WIDE_ROLES.has(user.role)) return true;
    if (row.barangay_id === null || row.barangay_id === user.barangayId) return true;
  }
  // A service explicitly assigned to the caller is always visible to them.
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
    .select('id')
    .eq('id', residentId)
    .maybeSingle();
  throwOnError(residentError, 'Could not verify resident');
  if (!resident) throw ApiError.unprocessable('The selected resident does not exist.');

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

  let request = supabase
    .from(ATTENDANCE_TABLE)
    .select('*')
    .eq('service_id', serviceId);
  request = applyAttendanceDateRange(request, query);
  const { data, error } = await request.order('scheduled_date', { ascending: false });
  throwOnError(error, 'Could not load health service attendance');
  return data || [];
};

export const listAttendanceByResident = async ({ user, query = {}, supabase = getServiceClient() }) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');
  const residentId = text(query.resident_id);
  if (!residentId) throw ApiError.badRequest('A resident reference is required.');
  const { data: resident, error: residentError } = await supabase
    .from('residents')
    .select('id')
    .eq('id', residentId)
    .maybeSingle();
  throwOnError(residentError, 'Could not verify resident');
  if (!resident) throw ApiError.notFound('Resident not found.');

  let request = supabase
    .from(ATTENDANCE_TABLE)
    .select('*, service:health_services(id, municipality_id, barangay_id)')
    .eq('resident_id', residentId);
  request = applyAttendanceDateRange(request, query);
  const { data, error } = await request.order('scheduled_date', { ascending: false });
  throwOnError(error, 'Could not load health service attendance');

  const visibleRows = [];
  for (const row of data || []) {
    if (await serviceVisibleTo(user, row.service, supabase)) {
      const { service, ...attendance } = row;
      visibleRows.push(attendance);
    }
  }
  return visibleRows;
};

export const RESIDENTS_EMBED = 'resident:residents(id, first_name, middle_name, last_name, sex, birth_date, barangay)';
const ATTENDANCE_SELECT = `*, service:health_services(id, name, category, municipality_id, barangay_id), ${RESIDENTS_EMBED}`;

/**
 * Attendance records (scheduled health-service appointments) for the caller's
 * scope within a date range, for the dashboard calendar.
 *
 * Scope is enforced in JS from the authenticated session (the service-role
 * client bypasses RLS): a barangay-assigned Health Supervisor only sees
 * attendance for services in their barangay or assigned to them; a
 * municipality-wide caller sees every service in their municipality. Each row
 * is passed through `serviceVisibleTo` so a known id (or one reached via a
 * wider join) can never leak an out-of-scope service. Date filtering uses
 * `scheduled_date` against the requested `from`/`to` window.
 */
export const listScopeAttendance = async ({ user, query = {}, supabase = getServiceClient() }) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');

  const from = text(query.from);
  const to = text(query.to);
  if ((from && !dateIsDateOnly(from)) || (to && !dateIsDateOnly(to))) {
    throw ApiError.badRequest('Invalid date range for the health service calendar.');
  }

  let request = supabase.from(ATTENDANCE_TABLE).select(ATTENDANCE_SELECT);
  if (from) request = request.gte('scheduled_date', from);
  if (to) request = request.lte('scheduled_date', to);
  const { data, error } = await request.order('scheduled_date', { ascending: true });
  throwOnError(error, 'Could not load health service schedules');

  const visibleRows = [];
  for (const row of data || []) {
    if (!row.service) continue; // orphan row — not visible to anyone
    if (!(await serviceVisibleTo(user, row.service, supabase))) continue;
    // A resident embed only returns residents the caller may see (RLS). Barangay
    // supervisors are additionally bound to their barangay by serviceVisibleTo,
    // so no other-barangay resident identity is ever attached.
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

/**
 * Resolve the scope columns for a new/updated service from the caller + payload.
 * A Health Supervisor is forced to their own barangay; a facility/barangay must
 * belong to the caller's municipality.
 */
const resolveScope = async (user, payload, supabase) => {
  const municipalityId = user.municipalityId;
  if (!municipalityId) throw ApiError.unprocessable('Your account has no municipality assignment.');

  let facilityId = text(payload.facilityId || payload.facility_id) || null;
  let barangayId = text(payload.barangayId || payload.barangay_id) || null;

  // Health Supervisor can only create within their assigned barangay.
  if (user.role === ROLES.HEALTH_SUPERVISOR) {
    barangayId = user.barangayId || null;
    if (!barangayId) throw ApiError.unprocessable('Your account has no barangay assignment.');
  }

  if (facilityId) {
    const { data: facility, error } = await supabase.from('facilities').select('id, municipality_id').eq('id', facilityId).maybeSingle();
    throwOnError(error, 'Could not verify facility');
    if (!facility || facility.municipality_id !== municipalityId) {
      throw ApiError.unprocessable('The selected facility is not in your municipality.');
    }
  }
  if (barangayId) {
    const { data: brgy, error } = await supabase.from('barangays').select('id, municipality_id').eq('id', barangayId).maybeSingle();
    throwOnError(error, 'Could not verify barangay');
    if (!brgy || brgy.municipality_id !== municipalityId) {
      throw ApiError.unprocessable('The selected barangay is not in your municipality.');
    }
  }

  return { municipalityId, facilityId, barangayId };
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

export const create = async ({ user, payload = {}, supabase = getServiceClient() }) => {
  assertManager(user);
  const name = text(payload.name);
  if (!name) throw ApiError.unprocessable('A service name is required.');
  const category = SERVICE_CATEGORIES.includes(text(payload.category)) ? text(payload.category) : 'Other';

  const scope = await resolveScope(user, payload, supabase);

  const row = {
    name,
    category,
    description: text(payload.description),
    municipality_id: scope.municipalityId,
    facility_id: scope.facilityId,
    barangay_id: scope.barangayId,
    active: payload.active === false ? false : true,
    created_by: user.id,
  };

  const { data, error } = await supabase.from(TABLE).insert(row).select(SELECT).single();
  throwOnError(error, 'Could not create the health service');

  // Optional initial personnel assignment.
  const personnelIds = Array.isArray(payload.personnelIds)
    ? payload.personnelIds.map((p) => text(p)).filter(Boolean)
    : [];
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

export const assign = async ({ user, serviceId, personnelId, supabase = getServiceClient() }) => {
  assertManager(user);
  const pid = text(personnelId);
  if (!pid) throw ApiError.unprocessable('Select a personnel to assign.');
  const service = await manageableService(user, serviceId, supabase); // BUG-004: scope + management check
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
  if (!user.municipalityId) return [];
  if (user.role === ROLES.HEALTH_SUPERVISOR && !user.barangayId) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, barangay_id')
    .eq('municipality_id', user.municipalityId)
    .eq('status', 'active')
    .in('role', [ROLES.PHN, ROLES.HEALTH_SUPERVISOR, ROLES.BHW, ROLES.RHU_PERSONNEL, ROLES.MHO]);
  throwOnError(error, 'Could not load personnel');
  const scoped = user.role === ROLES.HEALTH_SUPERVISOR
    ? (data || []).filter((p) => p.barangay_id === user.barangayId)
    : data || [];
  return scoped.map((p) => ({
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
 * the category vocabulary. Lets the UI populate dropdowns from the database
 * instead of hardcoding, and keeps RHU modeled as a facility (never a barangay).
 */
export const reference = async ({ user, supabase = getServiceClient() }) => {
  if (!user?.id) throw ApiError.unauthorized('Not authenticated.');
  const out = { categories: SERVICE_CATEGORIES, barangays: [], facilities: [] };
  if (!user.municipalityId) return out;

  const [{ data: barangays, error: bErr }, { data: facilities, error: fErr }] = await Promise.all([
    supabase.from('barangays').select('id, name').eq('municipality_id', user.municipalityId).order('name'),
    supabase.from('facilities').select('id, name, type').eq('municipality_id', user.municipalityId).order('name'),
  ]);
  throwOnError(bErr || fErr, 'Could not load reference data');

  // A barangay-scoped Health Supervisor only picks within their own barangay.
  const scopedBarangays = user.role === ROLES.HEALTH_SUPERVISOR && user.barangayId
    ? (barangays || []).filter((b) => b.id === user.barangayId)
    : barangays || [];

  out.barangays = scopedBarangays.map((b) => ({ id: b.id, name: b.name }));
  out.facilities = (facilities || []).map((f) => ({ id: f.id, name: f.name, type: f.type || '' }));
  return out;
};

export default {
  SERVICE_CATEGORIES,
  list,
  getById,
  create,
  assign,
  unassign,
  assignablePersonnel,
  reference,
  meta,
  createHealthServiceAttendance,
  listAttendanceByService,
  listAttendanceByResident,
  listScopeAttendance,
  updateHealthServiceAttendance,
};
