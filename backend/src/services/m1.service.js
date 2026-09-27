import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';
import { assignedBarangay } from '../config/scope.js';
import {
  M1_INDICATORS,
  getIndicator,
  isValidIndicatorCode,
  catalogTree,
  FP_MEASURES,
} from '../config/m1Catalog.js';

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
const WRITE_ROLES = new Set(['health_supervisor', 'phn', 'bhw']);
const BARANGAY_ROLES = new Set(['health_supervisor', 'bhw']);
const MUNICIPALITY_ROLES = new Set(['mho', 'phn', 'rhu_personnel']);

const text = (v) => String(v ?? '').trim();
const throwOnError = (error, fallback) => {
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
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
export const resolveScope = (user, requestedBarangayId = null) => {
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

export const listCatalog = () => ({ sections: catalogTree(), indicators: M1_INDICATORS, fpMeasures: FP_MEASURES });

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
  const scope = assignedBarangay(user);
  const outOfBarangay = scope && text(data.barangay).toLowerCase() !== text(scope).toLowerCase();
  const outOfMunicipality = user.municipalityId && data.municipality_id && user.municipalityId !== data.municipality_id;
  if (outOfBarangay || outOfMunicipality) throw ApiError.notFound('Resident record not found.');
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
  const scope = assignedBarangay(user);
  const outOfBarangay = scope && text(data.barangay).toLowerCase() !== text(scope).toLowerCase();
  const outOfMunicipality = user.municipalityId && data.municipality_id && user.municipalityId !== data.municipality_id;
  if (outOfBarangay || outOfMunicipality) throw ApiError.notFound('Household record not found.');
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
    const scope = resolveScope(user, payload.barangayId ?? payload.barangay_id ?? null);
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
  const scope = resolveScope(user);
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
  const scope = resolveScope(user, barangayId);
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

/**
 * Compute one section-by-section monthly report. Every indicator is included
 * (even zero). Values come only from real records and are traceable via
 * drilldown().
 */
export const monthlyReport = async ({ user, year, month, barangayId = null, supabase = getServiceClient() }) => {
  const scope = resolveScope(user, barangayId);
  const { start, end } = monthRange(year, month);

  // --- Bulk-load every underlying source once, filtered to scope. ---
  let recQ = supabase
    .from(RECORDS)
    .select(`*, resident:residents(${RESIDENT_SELECT})`)
    .gte('record_date', start)
    .lte('record_date', end)
    .limit(20000);
  recQ = applyScope(recQ, scope);
  const { data: recs, error: recErr } = await recQ;
  throwOnError(recErr, 'Could not load M1 records');

  let immQ = supabase
    .from('immunizations')
    .select(`*, resident:residents(${RESIDENT_SELECT})`)
    .gte('administered_date', start)
    .lte('administered_date', end)
    .eq('status', 'Completed')
    .limit(20000);
  immQ = applyScope(immQ, scope);
  const { data: imms, error: immErr } = await immQ;
  throwOnError(immErr, 'Could not load immunizations');

  let hhQ = supabase.from('households').select('*').limit(20000);
  hhQ = applyScope(hhQ, scope);
  const { data: households, error: hhErr } = await hhQ;
  throwOnError(hhErr, 'Could not load households');

  let mortQ = supabase
    .from('household_member_health_profiles')
    .select('*, member:household_members(id, name, sex, birthday)')
    .gte('date_of_death', start)
    .lte('date_of_death', end)
    .limit(20000);
  mortQ = applyScope(mortQ, scope);
  const { data: mort, error: mortErr } = await mortQ;
  throwOnError(mortErr, 'Could not load mortality records');

  // Remarks for the period.
  let remQ = supabase
    .from('m1_indicator_remarks')
    .select('indicator_code, remarks')
    .eq('period_year', year)
    .eq('period_month', month);
  remQ = applyScope(remQ, scope);
  const { data: remarks } = await remQ;
  const remarkMap = new Map((remarks || []).map((r) => [r.indicator_code, r.remarks]));

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
      remark: remarkMap.get(ind.code) || '',
    }),
  );

  const byCode = new Map(results.map((r) => [r.code, r]));
  return { period: { year, month }, scope: { level: scope.level, barangayId: scope.barangayId }, indicators: results, byCode: Object.fromEntries(byCode) };
};

/** Aggregate a single indicator from the pre-loaded source sets. */
const computeIndicator = (ind, sets) => {
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
  } else {
    // m1_records
    if (ind.dataType === 'fp_method' || ind.dataType === 'fp_total') {
      // Current-users logic per age group.
      const measures = {};
      for (const fm of FP_MEASURES) measures[fm.key] = { Total: 0 };
      for (const g of ind.ageGroups) for (const fm of FP_MEASURES) measures[fm.key][g] = 0;
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
  }

  return {
    code: ind.code,
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
    ...extra,
  };
};

// ---------------------------------------------------------------------------
// Annual summary (spec PART 22): monthly matrix + annual total per indicator.
// ---------------------------------------------------------------------------

export const annualSummary = async ({ user, year, barangayId = null, supabase = getServiceClient() }) => {
  const scope = resolveScope(user, barangayId);
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
  const { data: imms } = await immQ;

  let mortQ = supabase
    .from('household_member_health_profiles')
    .select('*, member:household_members(id, name, sex, birthday)')
    .gte('date_of_death', start)
    .lte('date_of_death', end)
    .limit(50000);
  mortQ = applyScope(mortQ, scope);
  const { data: mort } = await mortQ;

  let hhQ = supabase.from('households').select('*').limit(20000);
  hhQ = applyScope(hhQ, scope);
  const { data: households } = await hhQ;

  const monthOf = (d) => (d ? Number(String(d).slice(5, 7)) : null);

  const indicators = M1_INDICATORS.map((ind) => {
    const months = Array.from({ length: 12 }, () => 0);
    const uniquePerMonth = Array.from({ length: 12 }, () => new Set());
    const uniqueYear = new Set();

    if (ind.source === 'immunizations') {
      const aliases = (ind.match?.aliases || [ind.match?.vaccine || ind.name]).map((a) => text(a).toLowerCase());
      for (const im of imms || []) {
        const vac = text(im.vaccine).toLowerCase();
        if (!aliases.some((a) => vac === a || vac.includes(a) || a.includes(vac))) continue;
        const m = monthOf(im.administered_date);
        if (m) months[m - 1] += 1;
      }
    } else if (ind.source === 'household_member_health_profiles') {
      for (const mrec of mort || []) {
        const m = monthOf(mrec.date_of_death);
        if (m) months[m - 1] += 1;
      }
    } else if (ind.source === 'households') {
      // WASH is a cumulative snapshot, not a monthly event: report the current
      // matching count in December (latest) and as the annual total.
      let c = 0;
      for (const h of households || []) if (matchHousehold(h, ind.match)) c += 1;
      months[11] = c;
    } else {
      for (const r of recs || []) {
        if (r.indicator_code !== ind.code) continue;
        const m = monthOf(r.record_date);
        if (!m) continue;
        if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') {
          if (r.resident_id) { uniquePerMonth[m - 1].add(r.resident_id); uniqueYear.add(r.resident_id); }
        } else {
          months[m - 1] += Number(r.value) || 1;
        }
      }
      if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') {
        for (let i = 0; i < 12; i += 1) months[i] = uniquePerMonth[i].size;
      }
    }

    // Annual total respects the aggregation type (dedup uniques, else sum).
    let annual;
    if (ind.aggregation === 'COUNT_UNIQUE_RESIDENTS') annual = uniqueYear.size || months.reduce((a, b) => a + b, 0);
    else if (ind.source === 'households') annual = months[11];
    else annual = months.reduce((a, b) => a + b, 0);

    return {
      code: ind.code, section: ind.section, subsection: ind.subsection, name: ind.name,
      aggregation: ind.aggregation, source: ind.source, frequency: ind.frequency,
      months, annual,
    };
  });

  return { period: { year }, scope: { level: scope.level, barangayId: scope.barangayId }, indicators };
};

// ---------------------------------------------------------------------------
// Drill-down (spec PART 20 / 32): which records produced a total?
// ---------------------------------------------------------------------------

export const drilldown = async ({ user, indicatorCode, year, month = null, barangayId = null, supabase = getServiceClient() }) => {
  const scope = resolveScope(user, barangayId);
  const ind = getIndicator(indicatorCode);
  if (!ind) throw ApiError.notFound(`Unknown indicator: ${indicatorCode}`);
  const { start, end } = month ? monthRange(year, month) : yearRange(year);

  const records = [];

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
  } else {
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
  }

  return {
    indicator: { code: ind.code, name: ind.name, section: ind.section, subsection: ind.subsection, source: ind.source },
    period: month ? { year, month } : { year },
    count: records.length,
    records,
  };
};

// ---------------------------------------------------------------------------
// Report metadata + section remarks
// ---------------------------------------------------------------------------

export const getReportMeta = async ({ user, year, month, barangayId = null, supabase = getServiceClient() }) => {
  const scope = resolveScope(user, barangayId);
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
  const scope = resolveScope(user, barangayId);
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
  const scope = resolveScope(user, barangayId);
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

export default {
  resolveScope,
  ensureCatalog,
  listCatalog,
  createRecord,
  updateRecord,
  deleteRecord,
  dailyParticipants,
  monthlyReport,
  annualSummary,
  drilldown,
  getReportMeta,
  saveReportMeta,
  saveIndicatorRemarks,
};
