// backend/src/services/m1.service.js
import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';
import { SCHEMAS } from '../config/programFormSchemas.js';
import repository from '../repositories/index.js';
import { inMaternalScope, loadMaternalSources, sameMaternalEpisode, validMaternalDate } from './m1MaternalSources.js';
import {
  M1_INDICATORS,
  getIndicator,
  isValidIndicatorCode,
  catalogTree,
  manualIndicators,
  FP_MEASURES,
  fpMethodToIndicatorCodes,
} from '../config/m1Catalog.js';
import {
  getWorkbookIndicator,
  WORKBOOK_M1_SECTION_TITLES,
} from '../config/workbookM1Catalog.js';
import {
  countQualifyingPeopleByAge,
  countPeopleByMethod,
  countUniquePeople,
  ageYearsAt as personAgeAt,
  fpAgeBand,
} from './m1PersonCounts.js';

/**
 * KALUSAGAP — FHSIS M1 reporting & aggregation service.
 *
 * Core principle (spec PART 1): KALUSAGAP stores the UNDERLYING records and the
 * report total is always COMPUTED from them and traceable back to the residents
 * / households that produced it. Indicators declare a `source` so we reuse
 * existing KALUSAGAP data (immunizations, households WASH, member mortality)
 * instead of duplicating it, and only store new underlying events in
 * public.m1_records for indicators that have no existing source.
 *
 * SECURITY (defense in depth, mirrors referrals.service.js):
 *   - authenticate + authorize gate the route by session + role,
 *   - every query is filtered to the caller's barangay/municipality scope HERE,
 *   - Supabase RLS mirrors the same boundary for any direct token access.
 * `supabase` is injectable so the unit tests drive it without a live database.
 */

const RECORDS = 'm1_records';
const MANUAL = 'm1_manual_entries';
const MATERNAL = 'maternal_records';
const WRITE_ROLES = new Set(['health_supervisor', 'phn', 'bhw']);
const BARANGAY_ROLES = new Set(['health_supervisor', 'bhw']);
const MUNICIPALITY_ROLES = new Set(['mho', 'phn', 'rhu_personnel']);

const text = (v) => String(v ?? '').trim();
const throwOnError = (error, fallback) => {
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
};

/**
 * True when the error means the relation does not exist yet (migration not
 * applied in this environment). PostgREST reports PGRST205 ("Could not find the
 * table ... in the schema cache"); Postgres reports 42P01 (undefined_table).
 * Only the OPTIONAL m1_manual_entries store is treated as skippable this way, so
 * a report degrades to "0 manual figures" instead of a 500 before the migration
 * runs — the operational/derived indicators still aggregate normally.
 */
const isMissingRelation = (error) =>
  !!error && (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /schema cache|could not find the table|does not exist/i.test(error.message || '')
  );

let warnedManualMissing = false;
const warnManualMissing = () => {
  if (!warnedManualMissing) {
    warnedManualMissing = true;
    // eslint-disable-next-line no-console
    console.warn('[m1] public.m1_manual_entries is missing — run `supabase db push` to enable manual M1 data entry. Reporting continues with 0 for manual indicators.');
  }
};

/** Parse a numeric value out of a free-ish field (e.g. "3.2 kg" -> 3.2). */
const parseNum = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^0-9.+-]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the barangay/municipality the caller may report on. A barangay-scoped
 * user is forced to their own barangay; a municipality-scoped user may target a
 * specific barangay of their municipality (or the whole municipality). Never
 * trusts a barangay outside the caller's coverage.
 */
export const resolveScope = async (user, requestedBarangayId = null, supabase = getServiceClient()) => {
  if (user?.role === 'admin') {
    return { level: 'admin', barangayId: requestedBarangayId || null, municipalityId: user.municipalityId || null };
  }
  if (BARANGAY_ROLES.has(user?.role)) {
    if (!user.barangayId) throw ApiError.forbidden('Your account has no barangay assignment.');
    // A barangay-scoped user can never widen scope; any requested barangay must equal their own.
    if (requestedBarangayId && requestedBarangayId !== user.barangayId) {
      throw ApiError.forbidden('You can only access your assigned barangay.');
    }
    return { level: 'barangay', barangayId: user.barangayId, municipalityId: user.municipalityId || null };
  }
  if (MUNICIPALITY_ROLES.has(user?.role)) {
    if (!user.municipalityId) throw ApiError.forbidden('Your account has no municipality assignment.');
    if (requestedBarangayId) {
      // A municipality-scoped caller may only drill into one of its OWN
      // barangays. `barangays.municipality_id` is authoritative; RLS is never
      // relied on to enforce this because the service uses service-role reads.
      let scopeRow;
      try {
        scopeRow = await supabase
          .from('barangays')
          .select('id, municipality_id, status')
          .eq('id', requestedBarangayId)
          .maybeSingle();
      } catch {
        throw new ApiError(503, 'Could not verify the requested barangay scope.');
      }
      const data = scopeRow?.data;
      const error = scopeRow?.error;
      if (error) throw new ApiError(503, 'Could not verify the requested barangay scope.');
      if (!data || String(data.municipality_id ?? '') !== String(user.municipalityId) || data.status === 'Inactive') {
        throw ApiError.forbidden('You can only access barangays within your assigned municipality.');
      }
    }
    return { level: 'municipality', barangayId: requestedBarangayId || null, municipalityId: user.municipalityId };
  }
  throw ApiError.forbidden('You are not authorized to view M1 reports.');
};

const applyScope = (query, scope) => {
  if (scope.barangayId) return query.eq('barangay_id', scope.barangayId);
  if (scope.municipalityId) return query.eq('municipality_id', scope.municipalityId);
  return query; // admin, whole system
};

// ---------------------------------------------------------------------------
// Date + age helpers
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const monthRange = (year, month) => {
  const start = `${year}-${pad(month)}-01`;
  const endDate = new Date(Date.UTC(year, month, 0)); // last day of month
  const end = `${year}-${pad(month)}-${pad(endDate.getUTCDate())}`;
  return { start, end };
};
const yearRange = (year) => ({ start: `${year}-01-01`, end: `${year}-12-31` });

// 1-based months (1-12) belonging to each quarter.
const QUARTER_MONTHS = { 1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12] };
const QUARTER_RANGE_LABEL = {
  1: 'January–March', 2: 'April–June', 3: 'July–September', 4: 'October–December',
};
const quarterOrdinal = (q) => `${q}${({ 1: 'st', 2: 'nd', 3: 'rd' }[q]) || 'th'}`;
const quarterRange = (year, quarter) => {
  const months = QUARTER_MONTHS[quarter] || QUARTER_MONTHS[1];
  const firstMonth = months[0];
  const lastMonth = months[2];
  const endDate = new Date(Date.UTC(year, lastMonth, 0)); // last day of the quarter's final month
  return { start: `${year}-${pad(firstMonth)}-01`, end: `${year}-${pad(lastMonth)}-${pad(endDate.getUTCDate())}`, months };
};

const reportingRange = ({ period, year, month, quarter }) => {
  if (!Number.isInteger(Number(year)) || year < 2000 || year > 2100) {
    throw ApiError.unprocessable('Invalid reporting year.');
  }
  if (period === 'annual') return { ...yearRange(year), months: Object.values(QUARTER_MONTHS).flat() };
  if (period === 'quarterly' && Number.isInteger(Number(quarter)) && quarter >= 1 && quarter <= 4) {
    return quarterRange(year, Number(quarter));
  }
  if (period === 'monthly' && Number.isInteger(Number(month)) && month >= 1 && month <= 12) {
    return { ...monthRange(year, Number(month)), months: [Number(month)] };
  }
  throw ApiError.unprocessable('Invalid reporting period, month, or quarter.');
};

/** Whole-year age in years at the reference date. */
const ageYearsAt = (birthDate, refDate) => {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  const r = new Date(refDate);
  if (Number.isNaN(b.getTime()) || Number.isNaN(r.getTime())) return null;
  let age = r.getUTCFullYear() - b.getUTCFullYear();
  const m = r.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && r.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
};

/** Map an age (years) into a scheme bucket, or null if outside the scheme. */
const bucketForAge = (ageScheme, ageYears) => {
  if (ageScheme === 'none' || ageScheme === 'mortality_detail') return null;
  if (ageYears == null) return null;
  if (ageScheme === 'fp') {
    if (ageYears >= 10 && ageYears <= 14) return '10-14';
    if (ageYears >= 15 && ageYears <= 19) return '15-19';
    if (ageYears >= 20 && ageYears <= 49) return '20-49';
    return null;
  }
  if (ageScheme === 'malaria') return ageYears < 5 ? '<5' : '>=5';
  if (ageScheme === 'deworming_child') {
    if (ageYears >= 1 && ageYears <= 4) return '1-4';
    if (ageYears >= 5 && ageYears <= 9) return '5-9';
    if (ageYears >= 10 && ageYears <= 19) return '10-19';
    return null;
  }
  return null;
};

const emptyBreakdown = (indicator) => {
  const byAge = {};
  for (const g of indicator.ageGroups) byAge[g] = 0;
  const bySex = indicator.sexBreakdown ? { Male: 0, Female: 0, Other: 0, Unknown: 0 } : null;
  return { byAge, bySex };
};

// Resolve the age bucket for a record: prefer the explicitly stored age_group,
// otherwise derive it from the resident's birth date at the record date.
const resolveAgeGroup = (indicator, record, resident) => {
  if (indicator.ageScheme === 'none') return 'Total';
  if (text(record.age_group)) return text(record.age_group);
  const age = ageYearsAt(resident?.birth_date, record.record_date);
  return bucketForAge(indicator.ageScheme, age);
};

const resolveSex = (record, resident) => {
  const s = text(record.sex) || text(resident?.sex);
  if (s === 'Male' || s === 'Female' || s === 'Other') return s;
  return 'Unknown';
};

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/** Idempotently mirror the JS catalog into public.m1_indicators. */
export const ensureCatalog = async ({ supabase = getServiceClient() } = {}) => {
  const rows = M1_INDICATORS.map((i) => ({
    code: i.code,
    section: i.section,
    subsection: i.subsection,
    name: i.name,
    frequency: i.frequency,
    aggregation: i.aggregation,
    source: i.source,
    age_scheme: i.ageScheme,
    age_groups: i.ageGroups,
    sex_breakdown: i.sexBreakdown,
    remarks_allowed: i.remarksAllowed,
    data_type: i.dataType,
    match: i.match,
    population: i.population,
    display_order: i.displayOrder,
    active: i.active,
  }));
  const { error } = await supabase.from('m1_indicators').upsert(rows, { onConflict: 'code' });
  throwOnError(error, 'Could not sync M1 indicator catalog');
  return { synced: rows.length };
};

export const listCatalog = () => ({
  sections: WORKBOOK_M1_SECTION_TITLES,
  indicators: M1_INDICATORS,
  historicalIndicators: M1_INDICATORS,
  fpMeasures: FP_MEASURES,
  manual: [],
  sourceMapping: Object.fromEntries(M1_INDICATORS.map((indicator) => [
    indicator.code,
    {
      source: indicator.source,
      match: indicator.match,
      derive: indicator.derive,
      name: indicator.name,
    },
  ])),
});

// ---------------------------------------------------------------------------
// Underlying record CRUD (public.m1_records)
// ---------------------------------------------------------------------------

const residentInScope = async (supabase, user, residentId) => {
  const id = text(residentId);
  if (!id) return null;
  const { data, error } = await supabase
    .from('residents')
    .select('id, barangay, barangay_id, municipality_id, auth_user_id, birth_date, sex')
    .eq('id', id)
    .maybeSingle();
  throwOnError(error, 'Could not load resident');
  if (!data) throw ApiError.notFound('Resident record not found.');
  if ((user.municipalityId && data.municipality_id !== user.municipalityId) ||
      (BARANGAY_ROLES.has(user.role) && data.barangay_id !== user.barangayId)) {
    throw ApiError.notFound('Resident record not found.');
  }
  return data;
};

const householdInScope = async (supabase, user, householdId) => {
  const id = text(householdId);
  if (!id) return null;
  const { data, error } = await supabase
    .from('households')
    .select('id, barangay, barangay_id, municipality_id')
    .eq('id', id)
    .maybeSingle();
  throwOnError(error, 'Could not load household');
  if (!data) throw ApiError.notFound('Household record not found.');
  if ((user.municipalityId && data.municipality_id !== user.municipalityId) ||
      (BARANGAY_ROLES.has(user.role) && data.barangay_id !== user.barangayId)) {
    throw ApiError.notFound('Household record not found.');
  }
  return data;
};

const assertWriter = (user) => {
  if (!WRITE_ROLES.has(user?.role) && user?.role !== 'admin') {
    throw ApiError.forbidden('You are not authorized to record M1 data.');
  }
};

const RESIDENT_SELECT = 'id, first_name, middle_name, last_name, barangay, sex, birth_date';

const sanitizeRecord = (payload = {}) => {
  const row = {};
  if (payload.record_date !== undefined) row.record_date = payload.record_date || null;
  if (payload.value !== undefined) {
    const v = Number(payload.value);
    if (!Number.isFinite(v) || v < 0) throw ApiError.unprocessable('Invalid value; must be a non-negative number.');
    row.value = v;
  }
  if (payload.sex !== undefined) {
    if (!['', 'Male', 'Female', 'Other'].includes(payload.sex)) throw ApiError.unprocessable('Invalid sex.');
    row.sex = payload.sex;
  }
  if (payload.age_group !== undefined) row.age_group = text(payload.age_group);
  if (payload.status !== undefined) row.status = text(payload.status) || 'Completed';
  if (payload.detail !== undefined) {
    if (payload.detail !== null && typeof payload.detail !== 'object') throw ApiError.unprocessable('detail must be an object.');
    row.detail = payload.detail || {};
  }
  if (payload.remarks !== undefined) row.remarks = text(payload.remarks);
  return row;
};

export const createRecord = async ({ user, payload = {}, supabase = getServiceClient() }) => {
  assertWriter(user);
  if (user.role !== 'admin' && !user.municipalityId) throw ApiError.forbidden('Your account has no municipality assignment.');
  if (BARANGAY_ROLES.has(user.role) && !user.barangayId) throw ApiError.forbidden('Your account has no barangay assignment.');
  const code = text(payload.indicator_code ?? payload.indicatorCode);
  if (!isValidIndicatorCode(code)) throw ApiError.unprocessable(`Unknown M1 indicator code: ${code}`);
  const indicator = getIndicator(code);
  if (indicator.source !== 'm1_records') {
    throw ApiError.unprocessable(
      `Indicator ${code} is aggregated from existing ${indicator.source} records and is not recorded directly.`,
    );
  }

  const resident = await residentInScope(supabase, user, payload.residentId ?? payload.resident_id);
  const household = resident ? null : await householdInScope(supabase, user, payload.householdId ?? payload.household_id);

  const row = sanitizeRecord(payload);
  row.indicator_code = code;
  if (resident) row.resident_id = resident.id;
  if (household) row.household_id = household.id;
  if (!resident && !household) {
    // Barangay-level event (e.g. ZOD / sanitary permit): set scope from caller.
    const scope = await resolveScope(user, payload.barangayId ?? payload.barangay_id ?? null, supabase);
    if (!scope.barangayId) throw ApiError.unprocessable('A resident, household, or barangay is required.');
    row.barangay_id = scope.barangayId;
  }
  if (!row.record_date) row.record_date = new Date().toISOString().slice(0, 10);
  row.recorded_by = user.id;
  // municipality_id / barangay_id from resident/household are set by the trigger.

  const { data, error } = await supabase.from(RECORDS).insert(row).select('*').single();
  throwOnError(error, 'Could not create M1 record');
  await audit(supabase, user, 'M1_RECORD_CREATED', data.id, data);
  return data;
};

const loadRecordInScope = async (supabase, user, id) => {
  const { data, error } = await supabase.from(RECORDS).select('*').eq('id', id).maybeSingle();
  throwOnError(error, 'Could not load M1 record');
  if (!data) throw ApiError.notFound('M1 record not found.');
  const scope = await resolveScope(user);
  if (scope.level === 'barangay' && data.barangay_id !== scope.barangayId) throw ApiError.notFound('M1 record not found.');
  if (scope.level === 'municipality' && data.municipality_id !== scope.municipalityId) throw ApiError.notFound('M1 record not found.');
  return data;
};

export const updateRecord = async ({ user, id, payload = {}, supabase = getServiceClient() }) => {
  assertWriter(user);
  const existing = await loadRecordInScope(supabase, user, id);
  const row = sanitizeRecord(payload);
  if (Object.keys(row).length === 0) return existing;
  const { data, error } = await supabase.from(RECORDS).update(row).eq('id', id).select('*').single();
  throwOnError(error, 'Could not update M1 record');
  await audit(supabase, user, 'M1_RECORD_UPDATED', id, data);
  return data;
};

export const deleteRecord = async ({ user, id, supabase = getServiceClient() }) => {
  assertWriter(user);
  const existing = await loadRecordInScope(supabase, user, id);
  const { error } = await supabase.from(RECORDS).delete().eq('id', id);
  throwOnError(error, 'Could not delete M1 record');
  await audit(supabase, user, 'M1_RECORD_DELETED', id, existing);
  return { id };
};

const audit = async (supabase, user, action, entityId, record) => {
  try {
    await supabase.from('health_audit_logs').insert({
      actor_id: user.id,
      action,
      entity_type: RECORDS,
      entity_id: String(entityId),
      municipality_id: record?.municipality_id || null,
      barangay_id: record?.barangay_id || null,
      metadata: { indicator_code: record?.indicator_code || null },
    });
  } catch {
    // Audit failure must not roll back the primary action.
  }
};

// ---------------------------------------------------------------------------
// Daily participants (spec PART 19 / 38)
// ---------------------------------------------------------------------------

export const dailyParticipants = async ({ user, date, barangayId = null, supabase = getServiceClient() }) => {
  const scope = await resolveScope(user, barangayId);
  const day = text(date) || new Date().toISOString().slice(0, 10);

  // M1 event records for the day.
  let q = supabase
    .from(RECORDS)
    .select(`*, resident:residents(${RESIDENT_SELECT})`)
    .eq('record_date', day)
    .order('created_at', { ascending: false })
    .limit(500);
  q = applyScope(q, scope);
  const { data: recs, error } = await q;
  throwOnError(error, 'Could not load daily M1 activity');

  // Immunizations administered that day (an M1 activity too).
  let iq = supabase
    .from('immunizations')
    .select(`*, resident:residents(${RESIDENT_SELECT})`)
    .eq('administered_date', day)
    .order('created_at', { ascending: false })
    .limit(500);
  iq = applyScope(iq, scope);
  const { data: imms, error: ierr } = await iq;
  throwOnError(ierr, 'Could not load daily immunization activity');

  const rows = [];
  for (const r of recs || []) {
    const ind = getIndicator(r.indicator_code);
    rows.push({
      id: r.id,
      source: 'm1_records',
      resident: r.resident || null,
      section: ind?.section || '',
      subsection: ind?.subsection || '',
      indicatorCode: r.indicator_code,
      indicator: ind?.name || r.indicator_code,
      date: r.record_date,
      status: r.status,
      remarks: r.remarks,
      recordedBy: r.recorded_by,
    });
  }
  for (const im of imms || []) {
    rows.push({
      id: im.id,
      source: 'immunizations',
      resident: im.resident || null,
      section: 'C',
      subsection: 'C1. Immunization Services',
      indicatorCode: null,
      indicator: `Immunization — ${im.vaccine}${im.dose ? ` (${im.dose})` : ''}`,
      date: im.administered_date,
      status: im.status,
      remarks: im.notes,
      recordedBy: im.created_by,
    });
  }
  return { date: day, participants: rows };
};

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

const nextDayIso = (dateStr) => {
  const next = new Date(`${dateStr}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
};

const matchTclEntry = (row, match) => {
  if (!match) return true;
  const field = match.field || 'program';
  const raw = text(row?.[field]);
  if (match.regex) {
    return new RegExp(match.regex, 'i').test(raw);
  }
  if (match.eq !== undefined) {
    return raw.toLowerCase() === text(match.eq).toLowerCase();
  }
  return true;
};

const tclEntryDate = (row) => {
  const raw = row?.created_at;
  return raw ? String(raw).slice(0, 10) : null;
};

const matchHousehold = (h, match) => {
  if (!match) return false;
  const test = (m) => {
    const v = h[m.field];
    if (m.eq !== undefined) return v === m.eq;
    if (m.in) return m.in.includes(v);
    return false;
  };
  if (!test(match)) return false;
  if (match.and && !test(match.and)) return false;
  return true;
};

// ---------------------------------------------------------------------------
// Maternal-record derivation (spec: MATERNAL RECORD / SOURCE PRIORITY)
// ---------------------------------------------------------------------------

/**
 * Evaluate one derivation filter against a maternal_records row. Supports:
 *   { field, eq }                        case-insensitive equality
 *   { field, in: [...] }                 membership (case-insensitive)
 *   { field, numRange: { min, max, gt, lt } }  numeric comparison (min inclusive,
 *                                         max exclusive, gt/lt exclusive)
 *   { field, empty: true }               no usable positive numeric value
 *   { ..., and: <filter> }               logical AND with a nested filter
 */
const matchMaternalFilter = (row, cond) => {
  if (!cond) return true;
  const raw = row[cond.field];
  if (cond.eq !== undefined && text(raw).toLowerCase() !== text(cond.eq).toLowerCase()) return false;
  if (cond.in) {
    const low = cond.in.map((x) => text(x).toLowerCase());
    if (!low.includes(text(raw).toLowerCase())) return false;
  }
  if (cond.numRange) {
    const n = parseNum(raw);
    if (n === null) return false;
    const r = cond.numRange;
    if (r.min !== undefined && !(n >= r.min)) return false;
    if (r.max !== undefined && !(n < r.max)) return false;
    if (r.gt !== undefined && !(n > r.gt)) return false;
    if (r.lt !== undefined && !(n < r.lt)) return false;
  }
  if (cond.empty) {
    const n = parseNum(raw);
    if (n !== null && n > 0) return false; // has a usable value -> not "unknown"
  }
  if (cond.and && !matchMaternalFilter(row, cond.and)) return false;
  return true;
};

const POSTPARTUM_DATE_FIELDS = ['pp_checkup_24h', 'pp_checkup_day3', 'pp_checkup_7_14d', 'pp_checkup_6wk'];

/**
 * The reporting-period date for a derived maternal indicator: either the
 * configured `dateField`, or — for the "completed at least 2 postpartum
 * check-ups" rule — the date of the SECOND check-up (the completion event).
 * Returns null when the service has not happened (so it is never counted).
 */
const maternalKeyDate = (derive, row) => {
  if (!derive) return null;
  if (derive.rule === 'prenatal_4plus') return row.prenatal_visit_dates?.[3] || null;
  if (derive.rule === 'first_trimester_nutrition') return row.nutritional_assessment_date || null;
  if (derive.rule === 'td_doses') return row.td_completion_date || null;
  if (derive.rule === 'calcium') return row.calcium_completed_date || null;
  if (derive.rule === 'postpartum_2plus') {
    const dates = [...new Set([...(row.postpartum_visit_dates || []), ...POSTPARTUM_DATE_FIELDS.map((f) => row[f])].filter(Boolean))].sort();
    return dates.length >= 2 ? dates[1] : null;
  }
  return row[derive.dateField] || null;
};

const matchesMaternalDerivation = (derive, row) => {
  if (!derive) return true;
  if (['prenatal_4plus', 'postpartum_2plus'].includes(derive.rule)
    && ['unknown', 'ambiguous', 'conflict'].includes(row.episode_identity_status)) return false;
  if (['ambiguous', 'conflict'].includes(row.episode_identity_status)) return false;
  if (derive.rule === 'prenatal_4plus' && (Number(row.prenatal_visits) || 0) < 4) return false;
  if (derive.rule === 'first_trimester_nutrition' && (!row.nutritional_assessment_date || parseNum(row.nutritional_bmi) === null)) return false;
  if (derive.rule === 'td_doses' && (Number(row.td_dose_count) || 0) < 1) return false;
  if (derive.rule === 'calcium' && !row.calcium_completed_date) return false;
  return matchMaternalFilter(row, derive.filter);
};

const maternalEventInScope = (derive, row, scope) => inMaternalScope(
  row.event_locations?.[derive?.rule || derive?.dateField] || row, scope,
);

const maternalRowsForIndicator = (indicator, rows, start, end, scope) => rows
  .filter((row) => {
    const date = maternalKeyDate(indicator.derive, row);
    return date && date >= start && date <= end && matchesMaternalDerivation(indicator.derive, row)
      && maternalEventInScope(indicator.derive, row, scope);
  })
  .sort((a, b) => text(maternalKeyDate(indicator.derive, a)).localeCompare(text(maternalKeyDate(indicator.derive, b)))
    || text(a.episode_key || a.id).localeCompare(text(b.episode_key || b.id)));

const maternalEventKey = (indicator, row) => `${text(row.resident_id || row.resident?.id)}:${row.episode_key || row.pregnancy_id || row.id}:${indicator.code}:${maternalKeyDate(indicator.derive, row)}:${text(row.event_locations?.[indicator.derive?.rule || indicator.derive?.dateField]?.barangay_id ?? row.barangay_id)}`;

const loadMaternalRecords = async (supabase, scope, repo = repository) => {
  const { legacy, pregnancies, encounters, services, deliveries, postpartum, legacyVisits, immunizations, consultations } = await loadMaternalSources({ supabase, scope, repo });

  const encounterRows = Array.isArray(encounters) ? encounters : [];
  const serviceRows = Array.isArray(services) ? services : [];
  const deliveryRows = Array.isArray(deliveries) ? deliveries : [];
  const postpartumRows = Array.isArray(postpartum) ? postpartum : [];
  const legacyVisitRows = Array.isArray(legacyVisits) ? legacyVisits : [];

  const validDate = validMaternalDate;
  const validDates = (values) => [...new Set(values.map(validDate).filter(Boolean))].sort();
  const serviceDates = (rows, matcher) => validDates(rows.filter(matcher).map((row) => row.date_provided));
  const completedService = (rows, matcher) => serviceDates(rows, (row) =>
    text(row.status).toLowerCase() === 'completed' && matcher(row));
  const enrichMaternal = (row, visits = [], pregnancyRows = [], pregnancyServices = []) => {
    const contacts = [...visits, ...pregnancyRows.map((visit) => ({ ...visit,
      source: 'pregnancy_encounters', visit_date: visit.encounter_date, visit_type: visit.encounter_type || 'prenatal', record: visit,
    }))].map((visit) => {
      const date = validDate(visit.visit_date);
      const careType = text(visit.visit_type || 'prenatal').toLowerCase();
      const residentMatches = !visit.resident_id || text(visit.resident_id) === text(row.resident_id);
      const withinEpisode = careType !== 'prenatal' || (!row.lmp || date >= row.lmp)
        && (!row.delivery_date || date <= row.delivery_date);
      return {
        ...visit,
        source: visit.source || 'maternal_visits',
        resident_id: row.resident_id,
        pregnancy_id: row.pregnancy_id || null,
        episode_key: row.episode_key,
        visit_date: date,
        visit_type: careType,
        barangay_id: visit.source === 'visits' ? visit.barangay_id : visit.barangay_id ?? row.barangay_id,
        municipality_id: visit.source === 'visits' ? visit.municipality_id : visit.municipality_id ?? row.municipality_id,
        eligible: visit.eligible !== false && Boolean(date) && residentMatches && withinEpisode,
        record: visit.record || visit,
      };
    });
    const prenatalVisits = contacts.filter((visit) => visit.eligible && visit.visit_type === 'prenatal');
    const allPrenatalDates = validDates(prenatalVisits.map((visit) => visit.visit_date));
    const nutritionRows = prenatalVisits
      .map((visit) => {
        const weight = parseNum(visit.weight ?? visit.weight_kg);
        const height = parseNum(visit.height_cm);
        const bmi = weight > 0 && height > 0 ? weight / ((height / 100) ** 2) : parseNum(visit.bmi);
        return { date: visit.visit_date, bmi, weeks: parseNum(visit.gestational_age_weeks), visit };
      })
      .filter((visit) => visit.date && visit.bmi > 0)
      .filter((visit) => {
        if (visit.weeks !== null) return visit.weeks >= 0 && visit.weeks < 14;
        if (!row.lmp) return false;
        const days = Math.floor((Date.parse(`${visit.date}T00:00:00Z`) - Date.parse(`${row.lmp}T00:00:00Z`)) / 86400000);
        return days >= 0 && days < 14 * 7;
      })
      .sort((a, b) => a.date.localeCompare(b.date)
        || text(b.visit.record.updated_at || b.visit.record.updatedAt).localeCompare(text(a.visit.record.updated_at || a.visit.record.updatedAt)));
    const doseMap = new Map();
    const addDose = (dose, date) => {
      const key = Number(text(dose).match(/[1-5]/)?.[0]);
      const day = validDate(date);
      if (key && day && (!doseMap.has(key) || day < doseMap.get(key))) doseMap.set(key, day);
    };
    for (const [dose, date] of Object.entries(row.tt_td_doses || {})) addDose(dose, date);
    for (const service of pregnancyServices) {
      if (text(service.status).toLowerCase() === 'completed' && /^(td|tt)(?:[1-5]|_|$)/i.test(text(service.service_type))) {
        addDose(service.service_details?.dose_number || service.service_type, service.date_provided);
      }
    }
    const nextPregnancyLmp = groups.map((group) => group.row)
      .filter((pregnancy) => pregnancy.resident_id === row.resident_id && pregnancy.episode_identity_status === 'identified')
      .map((pregnancy) => validDate(pregnancy.lmp)).filter((date) => date && row.lmp && date > row.lmp).sort()[0];
    for (const vaccine of immunizations || []) {
      if (vaccine.resident_id === row.resident_id && vaccine.status === 'Completed' && /^(td|tt|tetanus)(?:\b|[1-5])/i.test(text(vaccine.vaccine))) {
        // A resident vaccine must fall within this pregnancy to be attributed to it.
        if (row.lmp && vaccine.administered_date >= row.lmp && (!row.delivery_date || vaccine.administered_date <= row.delivery_date)
          && (!nextPregnancyLmp || vaccine.administered_date < nextPregnancyLmp)) addDose(vaccine.dose, vaccine.administered_date);
      }
    }
    const tdDates = validDates([...doseMap.values()]);
    const ironDates = completedService(pregnancyServices, (service) => /^(iron_folic|iron_folic_completed|iron_folic_completion)$/.test(text(service.service_type)) || service.service_details?.course_completed === true && /iron|folic/i.test(text(service.service_type)));
    const calciumDates = completedService(pregnancyServices, (service) => /^(calcium|calcium_completed|calcium_completion)$/.test(text(service.service_type)) || service.service_details?.course_completed === true && /calcium/i.test(text(service.service_type)));
    const fieldsFromServices = (patterns, positive = false) => {
      const dates = pregnancyServices
        .filter((item) => text(item.status).toLowerCase() === 'completed')
        .filter((item) => patterns.some((pattern) => pattern.test(`${text(item.service_type)} ${text(item.service_name)}`)))
        .filter((item) => !positive || ['+', 'positive'].includes(text(item.result_status || item.result_value).toLowerCase()))
        .map((item) => positive ? item.result_date || item.date_provided : item.date_provided);
      return validDates(dates)[0] || '';
    };
    const screeningFields = {};
    for (const [prefix, dateKey, resultKey, patterns] of [
      ['syphilis', 'syphilisScreenDate', 'syphilisResult', [/syphilis/i]],
      ['hepb', 'hepbScreenDate', 'hepbResult', [/hepatitis\s*b|hepb/i]],
      ['hiv', 'hivScreenDate', null, [/hiv/i]],
      ['cbc', 'cbcScreenDate', 'cbcResult', [/cbc|hgb|hematocrit/i]],
      ['gdm', 'gdmScreenDate', 'gdmResult', [/gestational|gdm/i]],
    ]) {
      const snapshots = prenatalVisits.map((visit) => visit.clinical_data?.prenatal || {});
      screeningFields[`${prefix}_screen_date`] = validDates([
        row[`${prefix}_screen_date`], fieldsFromServices(patterns), ...snapshots.map((snapshot) => snapshot[dateKey]),
      ])[0] || '';
      screeningFields[`${prefix}_positive_date`] = validDates([
        ['+', 'positive'].includes(text(row[`${prefix}_result`]).toLowerCase()) ? row[`${prefix}_screen_date`] : '',
        fieldsFromServices(patterns, true),
        ...snapshots.filter((snapshot) => ['+', 'positive'].includes(text(snapshot[resultKey]).toLowerCase())).map((snapshot) => snapshot[dateKey]),
      ])[0] || '';
    }
    const postpartumVisits = contacts.filter((visit) => visit.eligible && visit.visit_type === 'postpartum');
    const ppIronDate = validDates(postpartumVisits.filter((visit) => visit.clinical_data?.postpartum?.ironFolicCompleted === true).map((visit) => visit.visit_date))[0] || '';
    // The legacy UI used one iron completion column for both stages. Attribute
    // an explicitly recorded completion after delivery to postpartum care only.
    const legacyIronIsPostpartum = row.delivery_date && row.iron_folic_completed_date >= row.delivery_date;
    const postpartumDates = validDates([...(row.postpartum_visit_dates || []), ...POSTPARTUM_DATE_FIELDS.map((field) => row[field]), ...postpartumVisits.map((visit) => visit.visit_date)]);
    const locationAt = (day, candidates = contacts) => {
      const matches = candidates.filter((visit) => visit.eligible !== false && (visit.visit_date || visit.date_provided || visit.delivery_date) === day);
      const explicit = matches.filter((visit) => (visit.record || visit).barangay_id != null || (visit.record || visit).barangayId != null);
      const locations = explicit.length ? explicit : matches;
      if (!locations.length) return { barangay_id: row.barangay_id, municipality_id: row.municipality_id };
      const barangays = new Set(locations.map((visit) => visit.barangay_id));
      return {
        barangay_id: barangays.size === 1 ? [...barangays][0] : null,
        municipality_id: locations[0].municipality_id,
      };
    };
    const enriched = {
      ...row,
      prenatal_visit_dates: allPrenatalDates,
      recorded_prenatal_visits: Number(row.prenatal_visits) || 0,
      prenatal_visits: allPrenatalDates.length,
      nutritional_assessment_date: nutritionRows[0]?.date || '',
      nutritional_bmi: nutritionRows[0]?.bmi ?? null,
      td_dose_count: tdDates.length,
      td_completion_date: tdDates[Number(row.gravida) === 1 ? 1 : 2] || '',
      iron_folic_completed_date: validDates([legacyIronIsPostpartum ? '' : row.iron_folic_completed_date, ...ironDates])[0] || '',
      pp_iron_folic_completed_date: validDates([row.pp_iron_folic_completed_date, ppIronDate, legacyIronIsPostpartum ? row.iron_folic_completed_date : ''])[0] || '',
      calcium_completed_date: row.calcium_completed_date || calciumDates.at(-1) || '',
      postpartum_visit_dates: postpartumDates,
      vitamin_a_given_date: validDates([row.vitamin_a_given_date, ...postpartumVisits.filter((visit) => visit.clinical_data?.postpartum?.vitaminAGiven === true).map((visit) => visit.visit_date)])[0] || '',
      pregnancy_outcome: row.pregnancy_outcome || ({ 'Fetal Death': 'FD', 'Abortion/Miscarriage': 'AB' })[row.delivery_outcome] || '',
      pregnancy_outcome_date: row.pregnancy_outcome_date || row.delivery_date || '',
      iodine_given_date: row.iodine_given_date || fieldsFromServices([/iodine/i]),
      deworming_date: row.deworming_date || fieldsFromServices([/deworm/i]),
      ...screeningFields,
      reporting_contacts: contacts.filter((visit) => inMaternalScope(visit, scope)),
      source_records: (row.source_records || []).filter((source) => inMaternalScope({
        barangay_id: source.record.barangay_id ?? row.barangay_id,
        municipality_id: source.record.municipality_id ?? row.municipality_id,
      }, scope)),
      event_locations: {
        ...row.event_locations,
        prenatal_4plus: locationAt(allPrenatalDates[3], prenatalVisits),
        postpartum_2plus: locationAt(postpartumDates[1], postpartumVisits),
        first_trimester_nutrition: nutritionRows[0] ? locationAt(nutritionRows[0].date, [nutritionRows[0].visit]) : locationAt(null),
      },
    };
    const servicePatterns = {
      iron_folic_completed_date: /iron|folic/i, calcium: /calcium/i, iodine_given_date: /iodine/i,
      deworming_date: /deworm/i, td_doses: /^(td|tt)(?:[1-5]|_|$)/i,
      syphilis: /syphilis/i, hepb: /hepatitis\s*b|hepb/i, hiv: /hiv/i,
      cbc: /cbc|hgb|hematocrit/i, gdm: /gestational|gdm/i,
    };
    for (const indicator of M1_INDICATORS.filter((item) => item.source === MATERNAL)) {
      const field = indicator.derive?.rule || indicator.derive?.dateField;
      const day = maternalKeyDate(indicator.derive, enriched);
      const pattern = servicePatterns[field] || servicePatterns[field?.split('_')[0]];
      const candidates = pattern ? pregnancyServices
        .filter((service) => text(service.status).toLowerCase() === 'completed' && pattern.test(`${text(service.service_type)} ${text(service.service_name)}`))
        .filter((service) => !field.endsWith('_positive_date') || ['+', 'positive'].includes(text(service.result_status || service.result_value).toLowerCase()))
        .map((service) => ({ ...service, record: service,
          barangay_id: service.barangay_id ?? row.barangay_id, municipality_id: service.municipality_id ?? row.municipality_id,
          visit_date: field.endsWith('_positive_date') ? service.result_date || service.date_provided : service.date_provided })) : [];
      if (field && !enriched.event_locations[field]) enriched.event_locations[field] = locationAt(day, candidates);
    }
    return enriched;
  };

  const mergeCases = (rows) => {
    const merged = {};
    const ordered = rows.slice().sort((a, b) => text(b.updated_at || b.created_at).localeCompare(text(a.updated_at || a.created_at)) || text(a.id).localeCompare(text(b.id)));
    for (const row of ordered) {
      for (const [key, value] of Object.entries(row)) {
        if ((merged[key] == null || merged[key] === '') && value != null && value !== '') merged[key] = value;
      }
    }
    // Preserve first recorded check-up milestones across duplicate case forms;
    // supplementation keeps the existing catalog's source/date semantics.
    for (const key of ['date_of_registration', ...POSTPARTUM_DATE_FIELDS]) {
      const date = validDates(rows.map((row) => row[key]))[0];
      if (date) merged[key] = date;
    }
    merged.tt_td_doses = Object.assign({}, ...ordered.slice().reverse().map((row) => row.tt_td_doses || {}));
    return merged;
  };
  const pregnancySignatures = pregnancies.map((pregnancy) => ({ ...pregnancy,
    pregnancy_id: pregnancy.id, pregnancy_identity_confirmed: true, lmp: pregnancy.lmp_date, edd: pregnancy.edd_date,
  }));
  const legacyAssignments = new Map();
  for (const row of legacy) {
    const matches = pregnancySignatures.filter((pregnancy) => sameMaternalEpisode(row, pregnancy));
    if (matches.length === 1) legacyAssignments.set(row.id, matches[0].pregnancy_id);
  }
  const canonical = (pregnancies || []).map((pregnancy) => {
    const pregnancyId = text(pregnancy.id);
    const residentId = text(pregnancy.resident_id);
    const linkedLegacy = legacy.filter((row) => legacyAssignments.get(row.id) === pregnancyId);
    const legacyCase = mergeCases(linkedLegacy);
    const pregnancyEncounters = encounterRows.filter((row) =>
      text(row.pregnancy_id) === pregnancyId
      && text(row.encounter_type || 'prenatal').toLowerCase() === 'prenatal');
    const belongs = (row) => text(row.pregnancy_id) === pregnancyId && (!row.resident_id || text(row.resident_id) === residentId);
    const pregnancyServices = serviceRows.filter(belongs);
    const pregnancyDeliveries = deliveryRows.filter(belongs);
    const pregnancyPostpartum = postpartumRows.filter(belongs);

    const prenatalVisitDates = pregnancyEncounters
      .map((row) => text(row.encounter_date))
      .filter(Boolean)
      .sort();
    const deliveriesSorted = pregnancyDeliveries
      .slice()
      .sort((a, b) => String(b.delivery_date || '').localeCompare(String(a.delivery_date || '')) || text(b.updated_at).localeCompare(text(a.updated_at)));
    const delivery = deliveriesSorted[0] || null;
    const postpartumDates = pregnancyPostpartum
      .map((row) => ({
        date: text(row.encounter_date),
        milestone: text(row.scheduled_milestone).toLowerCase(),
        row,
      }))
      .filter((item) => item.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    const ppByMilestone = (milestone) => postpartumDates.find((item) =>
      item.milestone === milestone || item.row?.scheduled_milestone === milestone)?.date || '';
    const ppFallback = postpartumDates.map((item) => item.date);
    const postpartumIronDate = postpartumDates
      .filter((item) => item.row?.iron_folic_completed === true)
      .map((item) => item.date)
      .sort()
      .at(-1) || '';
    const postpartumVitaminDate = postpartumDates
      .filter((item) => item.row?.vitamin_a_given === true)
      .map((item) => item.date)
      .sort()
      .at(-1) || '';

    const placeKey = text(delivery?.place_of_delivery).toLowerCase();
    const attendantKey = text(delivery?.birth_attendant).toLowerCase();
    const outcomeKey = text(delivery?.delivery_outcome).toLowerCase();
    const deliveryTypeKey = text(delivery?.type_of_delivery).toLowerCase();
    const place = placeKey === 'public_facility'
      ? 'Public Facility'
      : placeKey === 'private_facility'
        ? 'Private Facility'
        : placeKey === 'home'
          ? 'Home / Non-Facility'
          : placeKey === 'other'
            ? 'Other'
            : '';
    const attendant = attendantKey === 'doctor'
      ? 'Doctor'
      : attendantKey === 'nurse'
        ? 'Nurse'
        : attendantKey === 'midwife'
          ? 'Midwife'
          : attendantKey === 'hilot'
            ? 'Hilot/TBA'
            : attendantKey === 'other'
              ? 'Other'
              : '';
    const outcome = outcomeKey === 'live_birth'
      ? 'Live Birth'
      : outcomeKey === 'stillbirth'
        ? 'Fetal Death'
        : outcomeKey === 'abortion'
          ? 'Abortion/Miscarriage'
          : outcomeKey === 'ectopic'
            ? 'Ectopic'
            : '';
    const deliveryType = deliveryTypeKey === 'vaginal'
      ? 'Vaginal'
      : deliveryTypeKey === 'cesarean'
        ? 'Cesarean'
        : '';
    return { row: {
      ...legacyCase,
      id: `canonical-pregnancy-${pregnancyId}`,
      pregnancy_id: pregnancyId,
      pregnancy_identity_confirmed: true,
      episode_key: `pregnancy:${residentId}:${pregnancyId}`,
      episode_identity_status: 'identified',
      resident_id: residentId,
      municipality_id: pregnancy.municipality_id,
      barangay_id: pregnancy.barangay_id,
      resident: pregnancy.resident || legacyCase.resident || delivery?.resident || null,
      lmp: pregnancy.lmp_date || legacyCase.lmp || '',
      edd: pregnancy.edd_date || legacyCase.edd || '',
      gravida: pregnancy.gravida ?? pregnancy.pregnancy_number ?? legacyCase.gravida,
      para: pregnancy.para ?? pregnancy.parity_before_pregnancy ?? legacyCase.para,
      socio_economic_status: pregnancy.socio_economic_status || legacyCase.socio_economic_status || '',
      prenatal_visits: pregnancyEncounters.length,
      prenatal_visit_dates: prenatalVisitDates,
      risk: pregnancy.risk_level || '',
      status: text(pregnancy.status) === 'delivered' ? 'Delivered' : text(pregnancy.status) || 'Active',
      date_of_registration: pregnancy.date_of_registration || legacyCase.date_of_registration || '',
      delivery_date: delivery?.delivery_date || legacyCase.delivery_date || '',
      delivery_outcome: outcome || legacyCase.delivery_outcome || '',
      type_of_delivery: deliveryType || legacyCase.type_of_delivery || '',
      place_of_delivery: place || legacyCase.place_of_delivery || '',
      birth_attendant: attendant || legacyCase.birth_attendant || '',
      birth_weight: delivery?.birth_weight_kg != null ? String(delivery.birth_weight_kg) : legacyCase.birth_weight || '',
      birth_weight_class: delivery?.birth_weight_class || '',
      pp_checkup_24h: ppByMilestone('24h') || legacyCase.pp_checkup_24h || '',
      pp_checkup_day3: ppByMilestone('3d') || legacyCase.pp_checkup_day3 || '',
      pp_checkup_7_14d: ppByMilestone('7-14d') || legacyCase.pp_checkup_7_14d || '',
      pp_checkup_6wk: ppByMilestone('6wk') || legacyCase.pp_checkup_6wk || '',
      postpartum_visit_dates: ppFallback,
      iron_folic_completed_date: legacyCase.iron_folic_completed_date || '',
      pp_iron_folic_completed_date: validDates([postpartumIronDate, legacyCase.pp_iron_folic_completed_date])[0] || '',
      vitamin_a_given_date: postpartumVitaminDate || legacyCase.vitamin_a_given_date || '',
      created_at: pregnancy.created_at || '',
      updated_at: pregnancy.updated_at || '',
      source_records: [{ source: 'maternal_pregnancies', id: pregnancy.id, record: pregnancy },
        ...linkedLegacy.map((record) => ({ source: MATERNAL, id: record.id, record })),
        ...pregnancyDeliveries.map((record) => ({ source: 'delivery_records', id: record.id, record })),
        ...pregnancyServices.map((record) => ({ source: 'prenatal_services', id: record.id, record }))],
      event_locations: delivery ? Object.fromEntries(['delivery_date', 'pregnancy_outcome_date'].map((field) => [field, {
        barangay_id: delivery.barangay_id ?? pregnancy.barangay_id, municipality_id: delivery.municipality_id ?? pregnancy.municipality_id,
      }])) : {},
    },
    visits: [...legacyVisitRows.filter((visit) => linkedLegacy.some((row) => text(row.id) === text(visit.maternal_case_id))),
      ...pregnancyPostpartum.map((visit) => ({ ...visit, source: 'postpartum_encounters', visit_type: 'postpartum', visit_date: visit.encounter_date, record: visit }))],
    encounters: pregnancyEncounters, services: pregnancyServices };
  });

  const legacyGroups = [];
  const identityEvidence = (row) => Number(Boolean(row.pregnancy_id)) * 4 + Number(Boolean(validDate(row.lmp))) + Number(Boolean(validDate(row.edd)));
  for (const record of legacy.filter((row) => !legacyAssignments.has(row.id)).sort((a, b) => identityEvidence(b) - identityEvidence(a))) {
    const row = { ...record, resident_id: text(record.resident_id || record.resident?.id) };
    const matches = legacyGroups.filter((group) => sameMaternalEpisode(row, group.row));
    if (matches.length === 1) {
      const group = matches[0];
      group.row = { ...mergeCases([row, group.row]), episode_key: group.row.episode_key,
        source_records: [...group.row.source_records, { source: MATERNAL, id: record.id, record }] };
      group.visits.push(...legacyVisitRows.filter((visit) => text(visit.maternal_case_id) === text(row.id)));
    } else {
      legacyGroups.push({ row: { ...row, episode_key: `maternal:${row.resident_id}:${row.id}`, episode_identity_status: 'identified',
        source_records: [{ source: MATERNAL, id: record.id, record }] },
      visits: legacyVisitRows.filter((visit) => text(visit.maternal_case_id) === text(row.id)), encounters: [], services: [] });
    }
  }
  const groups = [...canonical, ...legacyGroups];
  // Resolve complete identities before partial snapshots so an ambiguous date
  // cannot join whichever pregnancy happened to be read first.
  for (const consultation of consultations.slice().sort((a, b) => identityEvidence(b) - identityEvidence(a))) {
    const referenced = consultation.pregnancy_id ? pregnancySignatures.find((pregnancy) => text(pregnancy.pregnancy_id) === consultation.pregnancy_id) : null;
    const conflict = referenced && !sameMaternalEpisode(consultation, referenced);
    const matches = conflict ? [] : groups.filter((group) => sameMaternalEpisode(consultation, group.row)
      || consultation.maternal_record_id && group.row.resident_id === consultation.resident_id
        && group.row.source_records?.some((source) => source.source === MATERNAL && text(source.id) === consultation.maternal_record_id)
        && (!consultation.lmp || !group.row.lmp || consultation.lmp === group.row.lmp)
        && (!consultation.edd || !group.row.edd || consultation.edd === group.row.edd));
    if (matches.length === 1) {
      matches[0].visits.push(consultation);
      continue;
    }
    const identified = !conflict && matches.length === 0 && (consultation.lmp || consultation.edd || consultation.pregnancy_identity_confirmed);
    groups.push({ row: {
      id: `consultation-activity-${consultation.id}`,
      source: 'visits',
      resident_id: consultation.resident_id, resident: consultation.resident,
      pregnancy_id: identified ? consultation.pregnancy_id : null,
      pregnancy_identity_confirmed: Boolean(consultation.pregnancy_identity_confirmed),
      lmp: consultation.lmp, edd: consultation.edd,
      barangay_id: consultation.barangay_id, municipality_id: consultation.municipality_id,
      episode_key: `consultation:${consultation.resident_id}:${consultation.id}`,
      episode_identity_status: conflict ? 'conflict' : matches.length > 1 ? 'ambiguous' : identified ? 'identified' : 'unknown',
      status: 'Consultation activity', source_records: [],
    }, visits: [consultation], encounters: [], services: [] });
  }
  const records = groups.map((group) => enrichMaternal(group.row, group.visits, group.encounters, group.services));
  records.visits = records.flatMap((row) => row.reporting_contacts);
  records.unattributedVisits = consultations.filter((visit) => {
    const missingScope = scope.barangayId ? !visit.barangay_id : scope.municipalityId ? !visit.municipality_id : !visit.barangay_id && !visit.municipality_id;
    return (!visit.visit_date || missingScope)
      && (inMaternalScope(visit, scope) || missingScope && inMaternalScope(visit.resident_scope, scope));
  }).map((visit) => ({ ...visit, attributionStatus: !visit.visit_date ? 'service_date_unverified' : 'service_scope_unverified' }));
  return records;
};

/**
 * Aggregate every M1 indicator over an arbitrary date range, filtered to the
 * caller's scope. This is the ONE aggregation path shared by the monthly,
 * quarterly and annual reports: the period only changes the [start, end] range
 * and which months' section-remarks are loaded, so Monthly / Quarterly /
 * Annual can never compute from different logic or a different data source.
 *
 * `start`/`end` are inclusive date strings (YYYY-MM-DD). The underlying columns
 * (record_date, administered_date, date_of_death) are DATE columns, so an
 * inclusive end has no 23:59:59 timestamp edge case.
 */
const aggregateOverRange = async ({ scope, start, end, year, months, supabase, maternalRecords }) => {
  let recQ = supabase
    .from(RECORDS)
    .select(`*, resident:residents(${RESIDENT_SELECT})`)
    .gte('record_date', start)
    .lte('record_date', end)
    .limit(50000);
  recQ = applyScope(recQ, scope);
  const { data: recs, error: recErr } = await recQ;
  throwOnError(recErr, 'Could not load M1 records');

  let immQ = supabase
    .from('immunizations')
    .select(`*, resident:residents(${RESIDENT_SELECT})`)
    .gte('administered_date', start)
    .lte('administered_date', end)
    .eq('status', 'Completed')
    .limit(50000);
  immQ = applyScope(immQ, scope);
  const { data: imms, error: immErr } = await immQ;
  throwOnError(immErr, 'Could not load immunizations');

  let hhQ = supabase.from('households').select('*').limit(20000);
  hhQ = applyScope(hhQ, scope);
  const { data: households, error: hhErr } = await hhQ;
  throwOnError(hhErr, 'Could not load households');

  // Person-level FP roster: household_members carries fp_method; join to the
  // household (barangay scope) and the linked resident (birth_date / sex) so
  // the M1 FP current-user counts are DERIVED from real people. Scope is
  // applied on households; members inherit their household's barangay.
  let fmQ = supabase
    .from('household_members')
    .select('id, household_id, resident_id, fp_method, name, birthday, sex, household:households(barangay_id, municipality_id), resident:residents(birth_date, sex)')
    .limit(50000);
  const { data: householdMembersRaw, error: fmErr } = await fmQ;
  throwOnError(fmErr, 'Could not load household member family-planning records');
  const fpPeople = (householdMembersRaw || [])
    .filter((m) => {
      // Scope the member through its household's barangay.
      if (scope.barangayId) return m.household?.barangay_id === scope.barangayId;
      if (scope.municipalityId) return m.household?.municipality_id === scope.municipalityId;
      return true; // admin
    })
    .map((m) => ({
      resident_id: m.resident_id || null,
      birth_date: m.resident?.birth_date || m.birthday || null,
      sex: m.resident?.sex || m.sex || '',
      methodCodes: fpMethodToIndicatorCodes(m.fp_method),
    }))
    .filter((p) => p.methodCodes.length > 0);

  let mortQ = supabase
    .from('household_member_health_profiles')
    .select('*, member:household_members(id, name, sex, birthday)')
    .gte('date_of_death', start)
    .lte('date_of_death', end)
    .limit(50000);
  mortQ = applyScope(mortQ, scope);
  const { data: mort, error: mortErr } = await mortQ;
  throwOnError(mortErr, 'Could not load mortality records');

  // Maternal case records (Section B derivation). Loaded for the whole scope,
  // not pre-filtered by date, because each derived indicator keys off a
  // different maternal date (delivery / supplementation / postpartum check-up);
  // computeIndicator filters each row to [start, end] by its own key date.
  const maternal = maternalRecords ?? await loadMaternalRecords(supabase, scope);

  // Target-client (TCL) program enrollments (Section E / F derivation). Loaded
  // for the whole scope; the reporting-month attribution keys off created_at
  // (the enrollment date) and each indicator's program match in computeIndicator.
  let tclQ = supabase
    .from('tcl_entries')
    .select('*, resident:residents(birth_date, sex)')
    .limit(50000);
  tclQ = applyScope(tclQ, scope);
  const { data: tclEntries, error: tclErr } = await tclQ;
  throwOnError(tclErr, 'Could not load target-client enrollments');

  // Manual aggregate figures for every month covered by the period. Summing the
  // monthly buckets over the range yields the quarterly / annual rollup.
  let manQ = supabase
    .from(MANUAL)
    .select('indicator_code, period_month, age_group, sex, value')
    .eq('period_year', year)
    .in('period_month', months);
  manQ = applyScope(manQ, scope);
  const { data: manualRows, error: manErr } = await manQ;
  if (manErr && isMissingRelation(manErr)) warnManualMissing();
  else throwOnError(manErr, 'Could not load manual M1 entries');
  const manualByIndicator = new Map();
  for (const m of (manErr ? [] : manualRows) || []) {
    if (!manualByIndicator.has(m.indicator_code)) manualByIndicator.set(m.indicator_code, []);
    manualByIndicator.get(m.indicator_code).push(m);
  }

  // Section remarks for every month covered by the period.
  let remQ = supabase
    .from('m1_indicator_remarks')
    .select('indicator_code, remarks')
    .eq('period_year', year)
    .in('period_month', months);
  remQ = applyScope(remQ, scope);
  const { data: remarks, error: remarksErr } = await remQ;
  throwOnError(remarksErr, 'Could not load M1 indicator remarks');
  const remarkMap = new Map();
  for (const r of remarks || []) if (!remarkMap.has(r.indicator_code)) remarkMap.set(r.indicator_code, r.remarks);

  const recsByIndicator = new Map();
  for (const r of recs || []) {
    if (!recsByIndicator.has(r.indicator_code)) recsByIndicator.set(r.indicator_code, []);
    recsByIndicator.get(r.indicator_code).push(r);
  }

  const results = M1_INDICATORS.map((ind) =>
    computeIndicator(ind, {
      recs: recsByIndicator.get(ind.code) || [],
      imms: imms || [],
      households: households || [],
      mort: mort || [],
      maternal: maternal || [],
      scope,
      tclEntries: tclEntries || [],
      manual: manualByIndicator.get(ind.code) || [],
      fpPeople,
      rangeStart: start,
      rangeEnd: end,
      remark: remarkMap.get(ind.code) || '',
    }),
  );

  const byCode = new Map(results.map((r) => [r.code, r]));
  return { indicators: results, byCode: Object.fromEntries(byCode) };
};

/**
 * Compute one section-by-section monthly report. Every indicator is included
 * (even zero). Values come only from real records and are traceable via
 * drilldown().
 */
export const monthlyReport = async ({ user, year, month, barangayId = null, supabase = getServiceClient() }) => {
  const scope = await resolveScope(user, barangayId, supabase);
  const { start, end } = monthRange(year, month);
  const { indicators, byCode } = await aggregateOverRange({ scope, start, end, year, months: [month], supabase });
  return { period: { year, month }, scope: { level: scope.level, barangayId: scope.barangayId }, indicators, byCode };
};

/**
 * Reporting-period report (spec PARTS 2-6, 14-18, 23-26): the single endpoint
 * behind Monthly / Quarterly / Annual export. Monthly, Quarterly and Annual are
 * reporting VIEWS over the SAME underlying records — a quarterly report
 * actually aggregates its three months and an annual report the whole year
 * (not just one month relabelled). Barangay/municipality scope is enforced by
 * resolveScope + applyScope on every query, exactly like monthlyReport.
 */
export const periodReport = async ({ user, period = 'monthly', year, month = null, quarter = null, barangayId = null, supabase = getServiceClient(), maternalRecords }) => {
  const scope = await resolveScope(user, barangayId, supabase);
  reportingRange({ period, year, month: month ?? 1, quarter: quarter ?? 1 });
  let range;
  let months;
  let periodObj;
  let periodLabel;

  if (period === 'quarterly') {
    const q = Number(quarter) || 1;
    const r = quarterRange(year, q);
    range = { start: r.start, end: r.end };
    months = r.months;
    periodObj = { period: 'quarterly', year, quarter: q };
    periodLabel = `${quarterOrdinal(q)} Quarter (${QUARTER_RANGE_LABEL[q]})`;
  } else if (period === 'annual') {
    range = yearRange(year);
    months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    periodObj = { period: 'annual', year };
    periodLabel = 'Whole Year (January–December)';
  } else {
    const m = Number(month) || 1;
    range = monthRange(year, m);
    months = [m];
    periodObj = { period: 'monthly', year, month: m };
    periodLabel = null; // caller/form uses the month name
  }

  const { indicators, byCode } = await aggregateOverRange({ scope, start: range.start, end: range.end, year, months, supabase, maternalRecords });
  return {
    period: periodObj,
    periodLabel,
    range,
    scope: { level: scope.level, barangayId: scope.barangayId },
    indicators,
    byCode,
  };
};

/** Aggregate a single indicator from the pre-loaded source sets. */
export const computeIndicator = (ind, sets) => {
  const breakdown = emptyBreakdown(ind);
  let total = 0;
  const uniqueResidents = new Set();
  const extra = {};

  const addToBreakdown = (record, resident, val) => {
    if (ind.ageScheme !== 'none') {
      const g = resolveAgeGroup(ind, record, resident);
      if (g && breakdown.byAge[g] !== undefined) breakdown.byAge[g] += val;
    }
    if (breakdown.bySex) breakdown.bySex[resolveSex(record, resident)] += val;
  };

  if (ind.source === 'immunizations') {
    const aliases = (ind.match?.aliases || [ind.match?.vaccine || ind.name]).map((a) => text(a).toLowerCase());
    for (const im of sets.imms) {
      const vac = text(im.vaccine).toLowerCase();
      if (!aliases.some((a) => vac === a || vac.includes(a) || a.includes(vac))) continue;
      const val = 1;
      total += val;
      if (im.resident_id) uniqueResidents.add(im.resident_id);
      addToBreakdown({ record_date: im.administered_date, sex: '' }, im.resident, val);
    }
  } else if (ind.source === 'households') {
    for (const h of sets.households) {
      if (matchHousehold(h, ind.match)) {
        total += 1;
        addToBreakdown({ record_date: null, sex: '' }, null, 1);
      }
    }
  } else if (ind.source === 'household_member_health_profiles') {
    for (const m of sets.mort) {
      total += 1;
      const member = m.member || {};
      if (breakdown.bySex) {
        const s = text(member.sex);
        breakdown.bySex[s === 'Male' || s === 'Female' ? s : 'Unknown'] += 1;
      }
    }
  } else if (ind.source === 'maternal_records') {
    const events = new Set();
    for (const row of maternalRowsForIndicator(ind, sets.maternal || [], sets.rangeStart, sets.rangeEnd, sets.scope)) {
      const key = maternalKeyDate(ind.derive, row);
      if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') {
        const residentId = text(row.resident_id || row.resident?.id);
        if (!residentId || uniqueResidents.has(residentId)) continue;
        uniqueResidents.add(residentId);
      } else {
        const eventKey = maternalEventKey(ind, row);
        if (events.has(eventKey)) continue;
        events.add(eventKey);
      }
      total += 1;
      if (ind.derive?.age && ind.ageScheme !== 'none') {
        const age = ageYearsAt(row.resident?.birth_date, key);
        const g = bucketForAge(ind.ageScheme, age);
        if (g && breakdown.byAge[g] !== undefined) breakdown.byAge[g] += 1;
      }
    }
  } else if (ind.source === 'm1_manual') {
    // Manual aggregate figures: sum the stored buckets. For a quarter/year this
    // sums every month's bucket in the range (loaded in aggregateOverRange).
    for (const e of sets.manual) {
      const val = Number(e.value) || 0;
      if (val <= 0) continue;
      total += val;
      if (ind.ageScheme !== 'none' && breakdown.byAge[text(e.age_group)] !== undefined) {
        breakdown.byAge[text(e.age_group)] += val;
      }
      if (breakdown.bySex) {
        const s = text(e.sex);
        breakdown.bySex[s === 'Male' || s === 'Female' || s === 'Other' ? s : 'Unknown'] += val;
      }
    }
  } else if (ind.source === 'tcl_entries') {
    const seen = new Set();
    for (const row of sets.tclEntries || []) {
      if (!matchTclEntry(row, ind.match)) continue;
      const ds = tclEntryDate(row);
      if (!ds || ds < sets.rangeStart || ds > sets.rangeEnd) continue;
      if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') {
        if (!row.resident_id || seen.has(row.resident_id)) continue;
        seen.add(row.resident_id);
        uniqueResidents.add(row.resident_id);
        addToBreakdown({ record_date: ds, sex: '' }, row.resident, 1);
      } else {
        total += 1;
        addToBreakdown({ record_date: ds, sex: '' }, row.resident, 1);
      }
    }
    if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') {
      total = seen.size;
    }
  } else if (ind.source === 'workbook_unmapped') {
    // Workbook definitions are authoritative for presentation. Existing
    // application records are intentionally not mapped into them.
  } else if (ind.source === 'm1_records') {
    // m1_records
    if (ind.dataType === 'fp_method' || ind.dataType === 'fp_total') {
      // Current-users logic per age group.
      //
      // PERSON-BASED COUNTS (spec PART 9): the beginning/end-of-month current
      // user counts for each FP method are DERIVED from the real person-level
      // roster (household_members.fp_method) — every qualifying unique woman
      // contributes +1 to her method's age band, never more than once. This
      // replaces manually typed FP totals.
      //
      // The manual m1_records `detail.measure` stream is RETAINED only for the
      // measures the roster snapshot cannot express (new acceptors, drop-outs,
      // and the fine-grained method variants). When both a person-derived count
      // and a manual figure exist for the SAME method+measure, the person-derived
      // value is authoritative to avoid double counting (manual entries for
      // auto-counted methods are rejected by saveManualEntry).
      const measures = {};
      for (const fm of FP_MEASURES) measures[fm.key] = { Total: 0 };
      for (const g of ind.ageGroups) for (const fm of FP_MEASURES) measures[fm.key][g] = 0;

      // Manual FP measure events (new acceptors / drop-outs / fine variants).
      for (const r of sets.recs) {
        const key = text(r.detail?.measure) || 'current_end';
        const g = resolveAgeGroup(ind, r, r.resident) || 'Total';
        const val = Number(r.value) || 1;
        if (measures[key]) {
          measures[key].Total += val;
          if (measures[key][g] !== undefined) measures[key][g] += val;
        }
        if (r.resident_id) uniqueResidents.add(r.resident_id);
      }

      // Person-derived current users from the roster.
      const personByMethod = countPeopleByMethod(sets.fpPeople || [], {
        refDate: sets.rangeEnd,
        sexFilter: 'Female',
      });
      if (ind.dataType === 'fp_method') {
        // This indicator's method: person-derived current users go into BOTH
        // current_begin and current_end (the roster is a current snapshot, so
        // beginning-of-month == current stored method). Manual new-acceptor and
        // dropout measures still add on top where the roster cannot see them.
        const counts = personByMethod[ind.code] || { '10-14': 0, '15-19': 0, '20-49': 0, total: 0 };
        for (const g of ind.ageGroups) {
          measures.current_begin[g] += counts[g];
          measures.current_end[g] += counts[g];
        }
        measures.current_begin.Total += counts.total;
        measures.current_end.Total += counts.total;
      } else if (ind.dataType === 'fp_total') {
        // Total Current Users = every auto-counted method summed + manual
        // current_end figures (a person counts once, across all methods).
        for (const g of ind.ageGroups) {
          let gPerson = 0;
          for (const counts of Object.values(personByMethod)) gPerson += counts[g];
          measures.current_begin[g] += gPerson;
          measures.current_end[g] += gPerson;
        }
        const personTotal = Object.values(personByMethod).reduce((s, c) => s + c.total, 0);
        measures.current_begin.Total += personTotal;
        measures.current_end.Total += personTotal;
      }

      // End-of-month current users = explicit current_end, else begin+new+other-dropout.
      for (const g of ind.ageGroups) {
        const explicitEnd = measures.current_end[g] || 0;
        const computed = (measures.current_begin[g] || 0) + (measures.new_present[g] || 0)
          + (measures.other_present[g] || 0) - (measures.dropout_present[g] || 0);
        breakdown.byAge[g] = explicitEnd || Math.max(0, computed);
      }
      total = ind.ageGroups.reduce((s, g) => s + (breakdown.byAge[g] || 0), 0);
      extra.measures = measures;
    } else {
      const seen = new Set();
      for (const r of sets.recs) {
        const val = Number(r.value) || 1;
        if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') {
          // Unique persons: count and break down each resident only once.
          if (!r.resident_id || seen.has(r.resident_id)) continue;
          seen.add(r.resident_id);
          uniqueResidents.add(r.resident_id);
          addToBreakdown(r, r.resident, 1);
        } else {
          total += val;
          addToBreakdown(r, r.resident, val);
        }
      }
     if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') total = uniqueResidents.size;
    }
  } else {
    throw new Error(`Unsupported M1 indicator source: ${ind.source}`);
  }

  return {
    code: ind.code,
    sourceIdentifier: ind.sourceIdentifier || null,
    sourceWorksheet: ind.sourceWorksheet || null,
    sourceRow: ind.sourceRow || null,
    section: ind.section,
    subsection: ind.subsection,
    name: ind.name,
    aggregation: ind.aggregation,
    source: ind.source,
    frequency: ind.frequency,
    ageGroups: ind.ageGroups,
    sexBreakdown: ind.sexBreakdown,
    total,
    byAge: breakdown.byAge,
    bySex: breakdown.bySex,
    remarks: sets.remark,
    ...(ind.section === 'B' ? { definitionVersion: 'legacy-m1-catalog', workbookMappingStatus: 'unverified' } : {}),
    ...extra,
  };
};

// ---------------------------------------------------------------------------
// Annual summary (spec PART 22): monthly matrix + annual total per indicator.
// ---------------------------------------------------------------------------

export const annualSummary = async ({ user, year, barangayId = null, supabase = getServiceClient() }) => {
  const scope = await resolveScope(user, barangayId, supabase);
  const { start, end } = yearRange(year);

  let recQ = supabase
    .from(RECORDS)
    .select(`*, resident:residents(${RESIDENT_SELECT})`)
    .gte('record_date', start)
    .lte('record_date', end)
    .limit(50000);
  recQ = applyScope(recQ, scope);
  const { data: recs, error } = await recQ;
  throwOnError(error, 'Could not load M1 records');

  let immQ = supabase
    .from('immunizations')
    .select(`*, resident:residents(${RESIDENT_SELECT})`)
    .gte('administered_date', start)
    .lte('administered_date', end)
    .eq('status', 'Completed')
    .limit(50000);
  immQ = applyScope(immQ, scope);
  const { data: imms, error: immErr } = await immQ;
  throwOnError(immErr, 'Could not load immunizations');

  let mortQ = supabase
    .from('household_member_health_profiles')
    .select('*, member:household_members(id, name, sex, birthday)')
    .gte('date_of_death', start)
    .lte('date_of_death', end)
    .limit(50000);
  mortQ = applyScope(mortQ, scope);
  const { data: mort, error: mortErr } = await mortQ;
  throwOnError(mortErr, 'Could not load mortality records');

  let hhQ = supabase.from('households').select('*').limit(20000);
  hhQ = applyScope(hhQ, scope);
  const { data: households, error: hhErr } = await hhQ;
  throwOnError(hhErr, 'Could not load households');

  // Person-level FP roster for annual current-user counts.
  let fmQ = supabase
    .from('household_members')
    .select('id, household_id, resident_id, fp_method, name, birthday, sex, household:households(barangay_id, municipality_id), resident:residents(birth_date, sex)')
    .limit(50000);
  const { data: householdMembersRaw, error: fmErr } = await fmQ;
  throwOnError(fmErr, 'Could not load household member family-planning records');
  const fpPeople = (householdMembersRaw || [])
    .filter((m) => {
      if (scope.barangayId) return m.household?.barangay_id === scope.barangayId;
      if (scope.municipalityId) return m.household?.municipality_id === scope.municipalityId;
      return true;
    })
    .map((m) => ({
      resident_id: m.resident_id || null,
      birth_date: m.resident?.birth_date || m.birthday || null,
      sex: m.resident?.sex || m.sex || '',
      methodCodes: fpMethodToIndicatorCodes(m.fp_method),
    }))
    .filter((p) => p.methodCodes.length > 0);
  const fpPeopleByMethod = countPeopleByMethod(fpPeople, {
    refDate: `${year}-12-31`,
    sexFilter: 'Female',
  });

  const maternal = await loadMaternalRecords(supabase, scope);

  let tclQ = supabase
    .from('tcl_entries')
    .select('*, resident:residents(birth_date, sex)')
    .gte('created_at', `${start}T00:00:00.000Z`)
    .lte('created_at', `${end}T23:59:59.999999Z`)
    .limit(50000);
  tclQ = applyScope(tclQ, scope);
  const { data: tclEntries, error: tclErr } = await tclQ;
  throwOnError(tclErr, 'Could not load target-client enrollments');

  let manQ = supabase.from(MANUAL).select('indicator_code, period_month, age_group, sex, value').eq('period_year', year);
  manQ = applyScope(manQ, scope);
  const { data: manualRows, error: manErr } = await manQ;
  throwOnError(manErr, 'Could not load manual M1 entries');
  const manualByIndicator = new Map();
  for (const m of manualRows || []) {
    if (!manualByIndicator.has(m.indicator_code)) manualByIndicator.set(m.indicator_code, []);
    manualByIndicator.get(m.indicator_code).push(m);
  }

  const monthOf = (d) => (d ? Number(String(d).slice(5, 7)) : null);

  const indicators = M1_INDICATORS.map((ind) => {
    const months = Array.from({ length: 12 }, () => 0);
    const uniquePerMonth = Array.from({ length: 12 }, () => new Set());
    const uniqueYear = new Set();
    // Annual sex split for indicators that report one. Counted from the same
    // rows that produce `annual` so the breakdown can never disagree with the
    // total. Male + Female + Other + Unknown === annual.
    const bySex = ind.sexBreakdown ? { Male: 0, Female: 0, Other: 0, Unknown: 0 } : null;
    const addSex = (record, resident, val) => {
      if (bySex) bySex[resolveSex(record, resident)] += val;
    };

    if (ind.source === 'immunizations') {
      const aliases = (ind.match?.aliases || [ind.match?.vaccine || ind.name]).map((a) => text(a).toLowerCase());
      for (const im of imms || []) {
        const vac = text(im.vaccine).toLowerCase();
        if (!aliases.some((a) => vac === a || vac.includes(a) || a.includes(vac))) continue;
        const m = monthOf(im.administered_date);
        if (m) months[m - 1] += 1;
        addSex({ record_date: im.administered_date, sex: '' }, im.resident, 1);
      }
    } else if (ind.source === 'household_member_health_profiles') {
      for (const mrec of mort || []) {
        const m = monthOf(mrec.date_of_death);
        if (m) months[m - 1] += 1;
        if (bySex) {
          const memberSex = text(mrec.member?.sex);
          bySex[memberSex === 'Male' || memberSex === 'Female' ? memberSex : 'Unknown'] += 1;
        }
      }
    } else if (ind.source === 'households') {
      // WASH is a cumulative snapshot, not a monthly event: report the current
      // matching count in December (latest) and as the annual total.
      let c = 0;
      for (const h of households || []) if (matchHousehold(h, ind.match)) c += 1;
      months[11] = c;
    } else if (ind.source === 'maternal_records') {
      const seen = new Set();
      const events = new Set();
      for (const row of maternalRowsForIndicator(ind, maternal || [], start, end, scope)) {
        const key = maternalKeyDate(ind.derive, row);
        const m = monthOf(key);
        if (!m) continue;
        if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') {
          const residentId = text(row.resident_id || row.resident?.id);
          if (!residentId || seen.has(`${m}:${residentId}`)) continue;
          seen.add(`${m}:${residentId}`);
          uniqueYear.add(residentId);
        } else {
          const eventKey = maternalEventKey(ind, row);
          if (events.has(eventKey)) continue;
          events.add(eventKey);
        }
        months[m - 1] += 1;
        if (bySex) bySex[resolveSex({ sex: '' }, row.resident)] += 1;
      }
    } else if (ind.source === 'm1_manual') {
      for (const e of manualByIndicator.get(ind.code) || []) {
        const val = Number(e.value) || 0;
        if (val <= 0) continue;
        const m = Number(e.period_month);
        if (m >= 1 && m <= 12) months[m - 1] += val;
        if (bySex) {
          const s = text(e.sex);
          bySex[s === 'Male' || s === 'Female' || s === 'Other' ? s : 'Unknown'] += val;
        }
      }
    } else if (ind.source === 'tcl_entries') {
      for (const row of tclEntries || []) {
        if (!matchTclEntry(row, ind.match)) continue;
        const ds = tclEntryDate(row);
        if (!ds || ds < start || ds > end) continue;
        const m = monthOf(ds);
        if (!m) continue;
        if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') {
          if (!row.resident_id) continue;
          uniquePerMonth[m - 1].add(row.resident_id);
          if (!uniqueYear.has(row.resident_id)) {
            uniqueYear.add(row.resident_id);
            addSex({ record_date: ds, sex: '' }, row.resident, 1);
          }
        } else {
          months[m - 1] += 1;
          addSex({ record_date: ds, sex: '' }, row.resident, 1);
        }
      }
      if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') {
        for (let i = 0; i < 12; i += 1) months[i] = uniquePerMonth[i].size;
      }
    } else if (ind.source === 'workbook_unmapped') {
      // Workbook definitions intentionally remain empty.
    } else if (ind.source === 'm1_records') {
      if (ind.dataType === 'fp_method' || ind.dataType === 'fp_total') {
        // Annual current-user counts: the roster is a current snapshot, so the
        // annual figure is the end-of-year person count (same method the
        // monthly report uses for its current month). Manual new-acceptor /
        // dropout measure events still add to the corresponding months.
        const personCounts = ind.dataType === 'fp_total'
          ? Object.values(fpPeopleByMethod).reduce((s, c) => ({
              '10-14': s['10-14'] + c['10-14'],
              '15-19': s['15-19'] + c['15-19'],
              '20-49': s['20-49'] + c['20-49'],
              total: s.total + c.total,
            }), { '10-14': 0, '15-19': 0, '20-49': 0, total: 0 })
          : fpPeopleByMethod[ind.code] || { '10-14': 0, '15-19': 0, '20-49': 0, total: 0 };
        for (const r of recs || []) {
          if (r.indicator_code !== ind.code) continue;
          const m = monthOf(r.record_date);
          if (!m) continue;
          months[m - 1] += Number(r.value) || 1;
        }
        // The end-of-year current-user snapshot is added to the December column
        // (the roster is a live snapshot, so it best represents December).
        months[11] += personCounts.total;
        if (bySex) bySex.Female += personCounts.total;
        // Annual total for CURRENT_USERS is handled below (snapshot, not sum).
      } else {
        for (const r of recs || []) {
          if (r.indicator_code !== ind.code) continue;
          const m = monthOf(r.record_date);
          if (!m) continue;
          if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') {
            if (r.resident_id) { uniquePerMonth[m - 1].add(r.resident_id); uniqueYear.add(r.resident_id); }
          } else {
            const val = Number(r.value) || 1;
            months[m - 1] += val;
            addSex(r, r.resident, val);
          }
        }
        if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') {
          for (let i = 0; i < 12; i += 1) months[i] = uniquePerMonth[i].size;
        }
      }
    } else {
      throw new Error(`Unsupported M1 indicator source: ${ind.source}`);
    }

    // Annual total respects the aggregation type (dedup uniques, else sum).
    let annual;
    if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') annual = uniqueYear.size || months.reduce((a, b) => a + b, 0);
    else if (ind.source === 'households') annual = months[11];
    else if (ind.dataType === 'fp_method' || ind.dataType === 'fp_total') {
      // Current-users snapshot: annual = end-of-year person count (not the sum
      // of 12 monthly figures, which would multiply a stable roster).
      const personCounts = ind.dataType === 'fp_total'
        ? Object.values(fpPeopleByMethod).reduce((s, c) => s + c.total, 0)
        : (fpPeopleByMethod[ind.code]?.total || 0);
      annual = personCounts + months.slice(0, 11).reduce((a, b) => a + b, 0);
    }
    else annual = months.reduce((a, b) => a + b, 0);

    // Unique-resident indicators are deduplicated per person for the total, so
    // the split is recounted from the same deduplicated set to stay consistent.
    if (bySex && ind.source === 'm1_records' && ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') {
      const seen = new Set();
      for (const r of recs || []) {
        if (r.indicator_code !== ind.code || !r.resident_id || seen.has(r.resident_id)) continue;
        seen.add(r.resident_id);
        addSex(r, r.resident, 1);
      }
    }

    return {
      code: ind.code, section: ind.section, subsection: ind.subsection, name: ind.name,
      aggregation: ind.aggregation, source: ind.source, frequency: ind.frequency,
      sexBreakdown: ind.sexBreakdown,
      months, annual,
      bySex,
    };
  });

  return { period: { year }, scope: { level: scope.level, barangayId: scope.barangayId }, indicators };
};

// ---------------------------------------------------------------------------
// Drill-down (spec PART 20 / 32): which records produced a total?
// ---------------------------------------------------------------------------

export const drilldown = async ({ user, indicatorCode, year, month = null, quarter = null, period = month ? 'monthly' : 'annual', barangayId = null, supabase = getServiceClient() }) => {
  const scope = await resolveScope(user, barangayId, supabase);
  const ind = getWorkbookIndicator(indicatorCode) || getIndicator(indicatorCode);
  if (!ind) throw ApiError.notFound(`Unknown indicator: ${indicatorCode}`);
  const { start, end, months } = reportingRange({ period, year, month, quarter });

  const records = [];

  if (ind.source === 'workbook_unmapped') {
    return {
      indicator: { code: ind.code, sourceIdentifier: ind.sourceIdentifier, name: ind.name },
      period: { year, month, quarter, period },
      scope: { level: scope.level, barangayId: scope.barangayId },
      records: [],
    };
  }
  if (ind.source === 'immunizations') {
    const aliases = (ind.match?.aliases || [ind.match?.vaccine || ind.name]).map((a) => text(a).toLowerCase());
    let q = supabase.from('immunizations').select(`*, resident:residents(${RESIDENT_SELECT})`)
      .gte('administered_date', start).lte('administered_date', end).eq('status', 'Completed').limit(5000);
    q = applyScope(q, scope);
    const { data, error } = await q;
    throwOnError(error, 'Could not load immunization drill-down');
    for (const im of data || []) {
      const vac = text(im.vaccine).toLowerCase();
      if (!aliases.some((a) => vac === a || vac.includes(a) || a.includes(vac))) continue;
      records.push({
        id: im.id, resident: im.resident, date: im.administered_date, status: im.status,
        detail: { vaccine: im.vaccine, dose: im.dose }, remarks: im.notes,
      });
    }
  } else if (ind.source === 'households') {
    let q = supabase.from('households').select('*').limit(5000);
    q = applyScope(q, scope);
    const { data, error } = await q;
    throwOnError(error, 'Could not load household drill-down');
    for (const h of data || []) {
      if (!matchHousehold(h, ind.match)) continue;
      records.push({
        id: h.id, household: { id: h.id, head_name: h.head_name, purok: h.purok, barangay: h.barangay },
        date: null, status: h.verification_status,
        detail: { water_source: h.water_source, toilet_type: h.toilet_type }, remarks: '',
      });
    }
  } else if (ind.source === 'household_member_health_profiles') {
    let q = supabase.from('household_member_health_profiles')
      .select('*, member:household_members(id, name, sex, birthday)')
      .gte('date_of_death', start).lte('date_of_death', end).limit(5000);
    q = applyScope(q, scope);
    const { data, error } = await q;
    throwOnError(error, 'Could not load mortality drill-down');
    for (const m of data || []) {
      records.push({
        id: m.id, member: m.member, date: m.date_of_death, status: 'Deceased',
        detail: { cause_of_death: m.cause_of_death }, remarks: m.remarks,
      });
    }
  } else if (ind.source === 'maternal_records') {
    const data = await loadMaternalRecords(supabase, scope);
    const seen = new Set();
    const events = new Set();
    for (const row of maternalRowsForIndicator(ind, data, start, end, scope)) {
      const key = maternalKeyDate(ind.derive, row);
      const ds = String(key).slice(0, 10);
      if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') {
        const residentId = text(row.resident_id || row.resident?.id);
        if (!residentId || seen.has(residentId)) continue;
        seen.add(residentId);
      } else {
        const eventKey = maternalEventKey(ind, row);
        if (events.has(eventKey)) continue;
        events.add(eventKey);
      }
      records.push({
        id: row.id, resident: row.resident, date: ds, status: row.status,
        ageGroup: ind.derive?.age ? bucketForAge(ind.ageScheme, ageYearsAt(row.resident?.birth_date, key)) : 'Total',
        detail: {
          delivery_date: row.delivery_date, delivery_outcome: row.delivery_outcome,
          type_of_delivery: row.type_of_delivery, place_of_delivery: row.place_of_delivery,
          birth_attendant: row.birth_attendant, birth_weight: row.birth_weight,
          pregnancy_id: row.pregnancy_id, prenatal_visits: row.prenatal_visits,
          prenatal_visit_dates: row.prenatal_visit_dates, nutritional_assessment_date: row.nutritional_assessment_date,
          nutritional_bmi: row.nutritional_bmi, td_completion_date: row.td_completion_date,
          td_dose_count: row.td_dose_count, iron_folic_completed_date: row.iron_folic_completed_date,
          pp_iron_folic_completed_date: row.pp_iron_folic_completed_date,
          episode_key: row.episode_key, episode_identity_status: row.episode_identity_status,
          reporting_contacts: row.reporting_contacts, source_records: row.source_records,
        },
        remarks: '',
      });
    }
  } else if (ind.source === 'm1_manual') {
    let q = supabase.from(MANUAL).select('*').eq('indicator_code', indicatorCode).eq('period_year', year);
    q = q.in('period_month', months);
    q = applyScope(q, scope);
    const { data, error } = await q;
    if (error && isMissingRelation(error)) warnManualMissing();
    else throwOnError(error, 'Could not load manual M1 drill-down');
    for (const e of (error ? [] : data) || []) {
      records.push({
        id: e.id, date: `${e.period_year}-${pad(e.period_month)}-01`, status: 'Manual entry',
        value: e.value, ageGroup: e.age_group, sex: e.sex, detail: { period_month: e.period_month }, remarks: '',
      });
    }
  } else if (ind.source === 'tcl_entries') {
    let q = supabase.from('tcl_entries').select(`*, resident:residents(${RESIDENT_SELECT})`)
      .gte('created_at', `${start}T00:00:00.000Z`).lte('created_at', `${end}T23:59:59.999999Z`)
      .order('created_at', { ascending: true }).limit(5000);
    q = applyScope(q, scope);
    const { data, error } = await q;
    throwOnError(error, 'Could not load target-client drill-down');
    for (const row of data || []) {
      if (!matchTclEntry(row, ind.match)) continue;
      const ds = tclEntryDate(row);
      if (!ds || ds < start || ds > end) continue;
      records.push({
        id: row.id, resident: row.resident, date: ds, status: row.status,
        ageGroup: resolveAgeGroup(ind, { record_date: ds }, row.resident), sex: resolveSex({ record_date: ds, sex: '' }, row.resident),
        detail: { program: row.program, priority: row.priority, assigned_bhw: row.assigned_bhw, last_visit: row.last_visit, next_visit: row.next_visit },
        remarks: row.notes,
      });
    }
  } else if (ind.source === 'm1_records') {
    let q = supabase.from(RECORDS).select(`*, resident:residents(${RESIDENT_SELECT})`)
      .eq('indicator_code', indicatorCode)
      .gte('record_date', start).lte('record_date', end)
      .order('record_date', { ascending: true }).limit(5000);
    q = applyScope(q, scope);
    const { data, error } = await q;
    throwOnError(error, 'Could not load drill-down records');
    for (const r of data || []) {
      records.push({
        id: r.id, resident: r.resident, household_id: r.household_id,
        date: r.record_date, status: r.status, value: r.value,
        ageGroup: resolveAgeGroup(ind, r, r.resident), sex: resolveSex(r, r.resident),
        detail: r.detail, remarks: r.remarks,
      });
    }
  } else {
    throw new Error(`Unsupported M1 indicator source: ${ind.source}`);
  }

  return {
    indicator: { code: ind.code, name: ind.name, section: ind.section, subsection: ind.subsection, source: ind.source },
    period: period === 'quarterly' ? { period, year, quarter } : period === 'monthly' ? { year, month } : { year },
    count: records.length,
    records,
  };
};

// ---------------------------------------------------------------------------
// Report metadata + section remarks
// ---------------------------------------------------------------------------

export const getReportMeta = async ({ user, year, month, barangayId = null, supabase = getServiceClient() }) => {
  const scope = await resolveScope(user, barangayId);
  const targetBarangay = scope.barangayId;
  if (!targetBarangay) throw ApiError.badRequest('A barangay is required for the report header.');

  const { data: barangay, error: bErr } = await supabase
    .from('barangays')
    .select('id, name, health_station_name, municipality_id, municipalities(name, province)')
    .eq('id', targetBarangay)
    .maybeSingle();
  throwOnError(bErr, 'Could not load barangay');

  const { data: meta, error } = await supabase
    .from('m1_report_meta')
    .select('*')
    .eq('barangay_id', targetBarangay)
    .eq('period_year', year)
    .eq('period_month', month)
    .maybeSingle();
  throwOnError(error, 'Could not load report metadata');

  return {
    barangay: barangay ? { id: barangay.id, name: barangay.name, healthStation: barangay.health_station_name } : null,
    municipality: barangay?.municipalities?.name || '',
    province: barangay?.municipalities?.province || '',
    period: { year, month },
    meta: meta || null,
  };
};

export const saveReportMeta = async ({ user, year, month, barangayId = null, payload = {}, supabase = getServiceClient() }) => {
  assertWriter(user);
  const scope = await resolveScope(user, barangayId);
  const targetBarangay = scope.barangayId;
  if (!targetBarangay) throw ApiError.badRequest('A barangay is required.');
  if (!scopeCoversBarangay(scope, targetBarangay)) throw ApiError.forbidden('Outside your barangay scope.');

  const row = {
    barangay_id: targetBarangay,
    period_year: year,
    period_month: month,
    bhs_name: text(payload.bhs_name),
    projected_population: payload.projected_population != null ? Number(payload.projected_population) : null,
    prepared_by: text(payload.prepared_by),
    designation: text(payload.designation),
    validated_by: text(payload.validated_by),
    date_submitted: payload.date_submitted || null,
    date_validated: payload.date_validated || null,
    created_by: user.id,
  };
  const { data, error } = await supabase
    .from('m1_report_meta')
    .upsert(row, { onConflict: 'barangay_id,period_year,period_month' })
    .select('*')
    .single();
  throwOnError(error, 'Could not save report metadata');
  return data;
};

const scopeCoversBarangay = (scope, barangayId) => {
  if (scope.level === 'admin') return true;
  if (scope.level === 'barangay') return scope.barangayId === barangayId;
  return true; // municipality role: RLS + the barangay's municipality_id enforce the rest
};

export const saveIndicatorRemarks = async ({ user, year, month, indicatorCode, remarks, barangayId = null, supabase = getServiceClient() }) => {
  assertWriter(user);
  if (!isValidIndicatorCode(indicatorCode)) throw ApiError.unprocessable(`Unknown indicator: ${indicatorCode}`);
  const scope = await resolveScope(user, barangayId);
  const targetBarangay = scope.barangayId;
  if (!targetBarangay) throw ApiError.badRequest('A barangay is required.');
  const row = {
    barangay_id: targetBarangay,
    indicator_code: indicatorCode,
    period_year: year,
    period_month: month,
    remarks: text(remarks),
    created_by: user.id,
  };
  const { data, error } = await supabase
    .from('m1_indicator_remarks')
    .upsert(row, { onConflict: 'barangay_id,indicator_code,period_year,period_month' })
    .select('*')
    .single();
  throwOnError(error, 'Could not save remarks');
  return data;
};

// ---------------------------------------------------------------------------
// Manual M1 data entry (spec: M1 DATA ENTRY / PERSISTENCE / UPDATE BEHAVIOR)
// ---------------------------------------------------------------------------

const SEX_VALUES = new Set(['', 'Male', 'Female', 'Other']);

/**
 * List the manual aggregate figures saved for one (barangay, year, month) plus
 * the catalog of manual indicators and their stored remarks, so the M1 Data
 * Entry screen can pre-fill the exact persisted values for editing.
 */
export const listManualEntries = async ({ user, year, month, barangayId = null, supabase = getServiceClient() }) => {
  const scope = await resolveScope(user, barangayId);
  let q = supabase.from(MANUAL).select('*').eq('period_year', year).eq('period_month', month);
  q = applyScope(q, scope);
  const { data, error } = await q;
  if (error && isMissingRelation(error)) {
    warnManualMissing();
    return {
      period: { year, month },
      scope: { level: scope.level, barangayId: scope.barangayId },
      indicators: manualIndicators(),
      entries: [],
      remarks: {},
      storeReady: false,
    };
  }
  throwOnError(error, 'Could not load manual M1 entries');

  let rq = supabase.from('m1_indicator_remarks').select('indicator_code, remarks').eq('period_year', year).eq('period_month', month);
  rq = applyScope(rq, scope);
  const { data: rem, error: remErr } = await rq;
  throwOnError(remErr, 'Could not load M1 indicator remarks');
  const remarks = {};
  for (const r of rem || []) if (remarks[r.indicator_code] === undefined) remarks[r.indicator_code] = r.remarks;

  return {
    period: { year, month },
    scope: { level: scope.level, barangayId: scope.barangayId },
    indicators: manualIndicators(),
    entries: data || [],
    remarks,
    storeReady: true,
  };
};

/**
 * Create or UPDATE the manual figures for one indicator in one reporting month.
 * Re-saving a bucket updates the stored value in place (the unique key
 * barangay+indicator+year+month+age_group+sex), so an edited value replaces the
 * old one instead of duplicating it, and every period that includes the month
 * immediately reflects the change. Only indicators whose source is `m1_manual`
 * can be entered here — anything derived from an operational table is rejected,
 * which is what prevents the same event being counted from two sources.
 */
export const saveManualEntry = async ({ user, year, month, indicatorCode, values = [], remarks, barangayId = null, supabase = getServiceClient() }) => {
  assertWriter(user);
  const code = text(indicatorCode);
  if (!isValidIndicatorCode(code)) throw ApiError.unprocessable(`Unknown M1 indicator code: ${code}`);
  const ind = getIndicator(code);
  if (ind.source !== 'm1_manual') {
    throw ApiError.unprocessable(
      `Indicator ${code} is derived from ${ind.source} and cannot be entered manually (prevents double counting).`,
    );
  }
  const yr = Number(year);
  const mo = Number(month);
  if (!Number.isInteger(yr) || yr < 2000 || yr > 2100) throw ApiError.unprocessable('Invalid reporting year.');
  if (!Number.isInteger(mo) || mo < 1 || mo > 12) throw ApiError.unprocessable('Invalid reporting month.');

  const scope = await resolveScope(user, barangayId);
  const targetBarangay = scope.barangayId;
  if (!targetBarangay) throw ApiError.badRequest('A barangay is required to record M1 data.');
  if (!scopeCoversBarangay(scope, targetBarangay)) throw ApiError.forbidden('Outside your barangay scope.');

  const allowedAges = ind.ageScheme === 'none' ? ['Total'] : ind.ageGroups;
  const saved = [];
  for (const v of values) {
    const ageGroup = text(v.age_group ?? v.ageGroup) || 'Total';
    const sex = SEX_VALUES.has(v.sex) ? (v.sex || '') : '';
    if (!allowedAges.includes(ageGroup) && ageGroup !== 'Total') {
      throw ApiError.unprocessable(`Invalid age group "${ageGroup}" for ${code}.`);
    }
    const value = Number(v.value);
    if (!Number.isFinite(value) || value < 0) throw ApiError.unprocessable('Each value must be a non-negative number.');
    const row = {
      indicator_code: code,
      barangay_id: targetBarangay,
      period_year: yr,
      period_month: mo,
      age_group: ageGroup,
      sex,
      value,
      recorded_by: user.id,
    };
    const { data, error } = await supabase
      .from(MANUAL)
      .upsert(row, { onConflict: 'barangay_id,indicator_code,period_year,period_month,age_group,sex' })
      .select('*')
      .single();
    throwOnError(error, 'Could not save manual M1 entry');
    saved.push(data);
  }

  if (remarks !== undefined && ind.remarksAllowed) {
    await saveIndicatorRemarks({ user, year: yr, month: mo, indicatorCode: code, remarks, barangayId: targetBarangay, supabase });
  }
  await audit(supabase, user, 'M1_MANUAL_SAVED', `${code}:${yr}-${mo}`, { municipality_id: scope.municipalityId, barangay_id: targetBarangay, indicator_code: code });
  return { indicatorCode: code, period: { year: yr, month: mo }, barangayId: targetBarangay, entries: saved };
};

/**
 * Get records for a specific M1 program.
 * Used by program detail pages to retrieve program-specific records and indicators.
 *
 * @param {object} params - Request parameters
 * @param {object} params.user - Authenticated user
 * @param {string} params.programId - Program identifier (prenatal, ncd, cervical, visual, oral, environmental, enrollment)
 * @param {string} params.period - Reporting period (monthly, quarterly, annual)
 * @param {number} params.year - Reporting year
 * @param {number|null} params.month - Reporting month (1-12, null if not monthly)
 * @param {number|null} params.quarter - Quarter (1-4, null if not quarterly)
 * @param {string|null} params.barangayId - Optional barangay override
 * @returns {Promise<object>} Records and indicators for the program
 */
export const getRecordsByProgram = async (params, supabase = repository.driver === 'file' ? null : getServiceClient()) => {
  const { user, programId, period = 'monthly', year, month = null, quarter = null, barangayId, repo = repository } = params;

  // Resolve scope
  if (!supabase && barangayId && isMunicipalScopedUser(user)) throw new ApiError(503, 'Barangay scope validation requires the Supabase data driver.');
  const scope = await resolveScope(user, barangayId, supabase);
  const targetBarangay = scope.barangayId;

  // Map program ID to FHSIS section and indicator codes
  // Use legacy M1_INDICATORS (not workbook codes) to maintain consistency with
  // frontend program config subsection definitions and reporting value lookups.
  const programMap = {
    prenatal: {
      section: 'B',
      indicatorCodes: M1_INDICATORS.filter((indicator) => indicator.section === 'B').map((indicator) => indicator.code),
      table: MATERNAL,
    },
    ncd: {
      section: 'F',
      indicatorCodes: [
        ...M1_INDICATORS.filter((indicator) => indicator.section === 'E').map((indicator) => indicator.code),
        'F_1', 'F_2', 'F_3', 'F_4', 'F_9', 'F_10',
      ],
      table: SCHEMAS['ncd-risk'].table,
      dateColumn: 'assessment_date',
    },
    cervical: {
      section: 'F',
      indicatorCodes: ['F_5', 'F_6', 'F_7', 'F_8'],
      table: SCHEMAS['ncd-cervical'].table,
      dateColumn: 'assessment_date',
    },
    visual: {
      section: 'F',
      indicatorCodes: ['F_11', 'F_12', 'F_13', 'F_14'],
      table: SCHEMAS['ncd-visual'].table,
      dateColumn: 'assessment_date',
    },
    oral: {
      section: 'D',
      indicatorCodes: M1_INDICATORS.filter((indicator) => indicator.section === 'D').map((indicator) => indicator.code),
      table: SCHEMAS['oral-health'].table,
      dateColumn: 'consultation_date',
    },
    environmental: {
      section: 'G',
      indicatorCodes: M1_INDICATORS.filter((indicator) => indicator.section === 'G').map((indicator) => indicator.code),
      table: SCHEMAS.environmental.table,
    },
    enrollment: {
      section: null,
      indicatorCodes: [],
      table: 'tcl_entries',
      dateColumn: 'created_at',
    },
  };

  const program = programMap[programId];
  if (!program) {
    throw ApiError.badRequest(`Unknown program: ${programId}`);
  }

  const { start: fromDate, end: toDate, months: reportingMonths } = reportingRange({ period, year, month, quarter });
  let records;
  let maternal;
  let programVisits = [];
  if (programId === 'prenatal') {
    maternal = await loadMaternalRecords(supabase, scope, repo);
    programVisits = maternal.visits.filter((visit) => visit.visit_date >= fromDate && visit.visit_date <= toDate);
    const derived = M1_INDICATORS.filter((indicator) => indicator.section === 'B' && indicator.source === MATERNAL);
    records = maternal.filter((row) => {
      const registered = text(row.date_of_registration).slice(0, 10);
      if (registered && registered >= fromDate && registered <= toDate && inMaternalScope(row, scope)) return true;
      if (row.reporting_contacts.some((visit) => visit.visit_date >= fromDate && visit.visit_date <= toDate)) return true;
      return derived.some((indicator) => {
        const key = maternalKeyDate(indicator.derive, row);
        const date = key ? String(key).slice(0, 10) : '';
        return date >= fromDate && date <= toDate && matchesMaternalDerivation(indicator.derive, row)
          && maternalEventInScope(indicator.derive, row, scope);
      });
    });
  } else {
    if (!supabase) throw new ApiError(503, 'This M1 program requires the Supabase data driver.');
    const select = programId === 'environmental' ? '*'
      : '*, resident:residents(id, first_name, middle_name, last_name, barangay, sex, birth_date)';
    let query = applyScope(supabase.from(program.table).select(select), scope);
    if (program.dateColumn === 'created_at') {
      const nextDay = new Date(`${toDate}T00:00:00.000Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      query = query.gte('created_at', `${fromDate}T00:00:00.000Z`).lt('created_at', nextDay.toISOString());
    } else if (program.dateColumn) {
      query = query.gte(program.dateColumn, fromDate).lte(program.dateColumn, toDate);
    }
    query = query.order(program.dateColumn || 'created_at', { ascending: false });
    const { data, error } = await query;
    throwOnError(error, `Could not fetch ${programId} records`);
    records = data || [];
  }

  // A program card represents qualifying program records, rather than repeated
  // source rows for the same enrollment or household masterlist.
  if (programId === 'enrollment') {
    const seen = new Set();
    records = records.filter((record) => {
      const programName = text(record.program).toLowerCase();
      const key = `${text(record.resident_id)}:${programName}`;
      if (!record.resident_id || !programName || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (programId === 'environmental') {
    const seen = new Set();
    records = records.filter((record) => {
      const key = text(record.household_id) || text(record.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Fetch indicator values from M1 aggregation
  const reportData = !supabase && programId === 'prenatal' ? {
    byCode: Object.fromEntries(M1_INDICATORS.filter((indicator) => indicator.section === 'B').map((indicator) => [indicator.code, computeIndicator(indicator, {
      maternal, scope, rangeStart: fromDate, rangeEnd: toDate, remark: '',
    })])),
  } : program.indicatorCodes.length ? await periodReport({
    user,
    period,
    year,
    month,
    quarter,
    barangayId: targetBarangay,
    supabase,
    maternalRecords: maternal,
  }) : null;

  const indicators = {};
  if (reportData && reportData.byCode) {
    Object.entries(reportData.byCode).forEach(([code, row]) => {
      if (program.indicatorCodes.includes(code)) {
        indicators[code] = row;
      }
    });
  }

  const prenatalVisits = programVisits.filter((visit) => visit.eligible && visit.visit_type === 'prenatal');
  const unattributedVisits = (maternal?.unattributedVisits || []).filter((visit) => !visit.visit_date || visit.visit_date >= fromDate && visit.visit_date <= toDate);
  const summary = programId === 'prenatal' ? {
    label: 'Unique prenatal residents seen',
    total: new Set(prenatalVisits.map((visit) => visit.resident_id)).size,
    visitCount: prenatalVisits.length,
    byMonth: Object.fromEntries(reportingMonths.map((month) => {
      const key = `${year}-${pad(month)}`;
      const visits = prenatalVisits.filter((visit) => visit.visit_date.startsWith(key));
      return [key, { residents: new Set(visits.map((visit) => visit.resident_id)).size, visits: visits.length }];
    })),
    note: 'Program activity counts residents once per reporting period and retains every source visit. It is not the number attaining four prenatal check-ups or workbook 8ANC.',
  } : programId === 'environmental' ? {
    label: 'Unique contributing households',
    total: new Set((records || []).map((record) => record.household_id || record.id).filter(Boolean)).size,
    note: 'Counts each household once even when it contributes to parent and child indicators.',
  } : null;

  return {
    program: programId,
    section: program.section,
    period: { type: period, year, month, quarter },
    records: records || [],
    indicators,
    summary,
    ...(programId === 'prenatal' ? {
      visits: programVisits,
      unattributedVisits,
      definitionVersion: 'legacy-m1-catalog',
      workbookMappingStatus: 'unverified',
      warnings: [
        'Legacy catalog measures retain 4 prenatal check-ups and 2 postpartum check-ups; they are not approved mappings to workbook 8ANC/4PNC measures.',
        'Saved prenatal consultations and maternal/TCL contacts feed relevant indicators without re-encoding. All visits remain traceable; unique residents seen are reported separately from care-completion events.',
        'A prenatal contact or registration alone does not qualify supplementation, first-trimester assessment, delivery outcomes, four-check-up attainment, or workbook 8ANC. These require the corresponding clinical and pregnancy-episode evidence.',
        ...(!supabase ? ['File-driver activity uses saved consultation snapshots only; maternal/TCL, immunization and delivery database sources are unavailable in this driver.'] : []),
        ...(maternal.some((row) => ['ambiguous', 'conflict'].includes(row.episode_identity_status)) ? ['Ambiguous or conflicting pregnancy linkage is preserved for review and excluded from qualified indicator counts.'] : []),
        ...(maternal.some((row) => row.prenatal_visit_dates.length >= 4 && row.event_locations.prenatal_4plus.barangay_id == null) ? ['The barangay of some attainment events is ambiguous. Barangay totals exclude these events pending reporting review.'] : []),
        ...(unattributedVisits.some((visit) => !visit.visit_date) ? ['Undated consultations are preserved as unattributed visits and excluded from reporting-period counts. Creation timestamps are not service dates.'] : []),
        ...(unattributedVisits.some((visit) => visit.attributionStatus === 'service_scope_unverified') ? ['Consultations missing service-time geography are preserved as unattributed visits. Their event location is not inferred from a resident current address.'] : []),
      ],
    } : {
      warnings: [programId === 'enrollment'
        ? 'Records are existing TCL enrollments attributed by created_at, not a separate M1 indicator or count of currently active clients.'
        : programId === 'environmental'
          ? 'Household records reflect current scoped WASH data, not a historical snapshot of the reporting period.'
          : 'Records are existing TCL service records for this period; M1 totals retain their catalog sources and are not automatically derived from these TCL rows.'],
    }),
    count: {
      records: (records || []).length,
      indicators: Object.keys(indicators).length,
      ...(summary ? { contributingRecords: summary.total } : {}),
      ...(programId === 'prenatal' ? {
        visits: programVisits.length,
        consultations: programVisits.filter((visit) => visit.source === 'visits').length,
        uniquePrenatalResidents: summary.total,
        unattributedVisits: unattributedVisits.length,
      } : {}),
    },
  };
};

export default {
  resolveScope,
  ensureCatalog,
  listCatalog,
  createRecord,
  updateRecord,
  deleteRecord,
  dailyParticipants,
  monthlyReport,
  periodReport,
  annualSummary,
  drilldown,
  getReportMeta,
  saveReportMeta,
  saveIndicatorRemarks,
  listManualEntries,
  saveManualEntry,
  getRecordsByProgram,
};
