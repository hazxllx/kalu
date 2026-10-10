import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';
import { assignedBarangay } from '../config/scope.js';
import { SCHEMAS } from '../config/programFormSchemas.js';

/**
 * Generic persistence + validation layer for the official program-specific TCL
 * / health-service forms (NCD Parts 1-3, Oral Health, Environmental Masterlist).
 *
 * Each `kind` is defined by a schema in config/programFormSchemas.js. The schema
 * is the single source of truth: it whitelists the keys a client may send,
 * validates data types and enumerated values, and decides whether a field is a
 * first-class table column or part of the `data` jsonb payload. Scope
 * (municipality/barangay) is copied from the linked resident or household by a
 * DB trigger, so a caller can never target an arbitrary barangay. All writes
 * additionally re-check the linked entity against the caller's barangay/
 * municipality scope (defense in depth beyond RLS).
 */

const STAFF = new Set(['health_supervisor', 'phn', 'mho']);
const text = (v) => String(v ?? '').trim();
const throwOnError = (error, fallback) => {
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
};

const schemaFor = (kind) => {
  const schema = SCHEMAS[kind];
  if (!schema) throw ApiError.badRequest('Unknown program form type.');
  return schema;
};

const dateIsDateOnly = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));

const assertStaff = (user) => {
  if (!STAFF.has(user?.role)) throw ApiError.forbidden('You are not authorized to manage program health records.');
};

/** Coerce + validate a single field value against its descriptor. */
const coerceField = (field, raw, errors) => {
  // Treat '' / null / undefined as "not provided".
  if (raw === undefined || raw === null || raw === '') return undefined;
  switch (field.type) {
    case 'date':
      if (!dateIsDateOnly(raw)) { errors.push(`${field.label}: expected a date (YYYY-MM-DD).`); return undefined; }
      return raw;
    case 'int': {
      const n = Number(raw);
      if (!Number.isInteger(n)) { errors.push(`${field.label}: expected a whole number.`); return undefined; }
      return n;
    }
    case 'bool':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'false') return raw === 'true';
      errors.push(`${field.label}: expected true/false.`);
      return undefined;
    case 'enum':
      if (!field.enum.includes(raw)) { errors.push(`${field.label}: invalid value "${raw}".`); return undefined; }
      return raw;
    case 'json':
      if (typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${field.label}: expected an object.`); return undefined; }
      return raw;
    case 'string':
    default:
      return text(raw);
  }
};

/**
 * Validate a client payload against a schema and split it into the DB columns
 * and the `data` jsonb payload. Unknown keys are dropped (never persisted).
 */
const buildRow = (schema, payload) => {
  const errors = [];
  const columns = {};
  const data = {};
  for (const field of schema.fields) {
    if (field.key === 'notes' || field.key === 'remarks') {
      // free-text columns are always allowed through as text
      const v = text(payload[field.key]);
      if (v) columns[field.key] = v;
      continue;
    }
    const value = coerceField(field, payload[field.key], errors);
    if (value === undefined) continue;
    if (field.where === 'column') columns[field.key] = value;
    else data[field.key] = value;
  }
  if (errors.length) throw ApiError.unprocessable('Validation failed.', { fields: errors });
  return { columns, data };
};

/** Official Environmental Masterlist derived indicator rules (server-computed). */
const computeEnvironmentalDerived = (columns, data) => {
  const safeLevels = ['level1', 'level2', 'level3'];
  const hasBasicSafeWater = safeLevels.includes(columns.water_supply_type);
  const safelyManagedWater = Boolean(
    columns.within_premises && columns.available_247
    && data.water_micro_result === 'ABSENT' && data.water_physico_result === 'WITHIN',
  );
  const hasSanitaryToilet = ['a', 'b', 'c'].includes(columns.sanitary_facility_type);
  const safelyManagedSanitation = Boolean(
    hasSanitaryToilet && data.toilet_not_shared && ['a', 'b'].includes(data.excreta_disposal),
  );
  // Part 3 Col 17: (16a+16b+16c) all √ OR (16a + 16d) √
  const wastePracticeOk = Boolean(
    (data.waste_segregation && data.waste_backyard_composting && data.waste_recycling)
    || (data.waste_segregation && data.waste_collected),
  );
  // Part 4 Col 20: Col17 + Col18(=basic safe water) + Col19(=sanitation facility)
  const completeSanitation = Boolean(wastePracticeOk && hasBasicSafeWater && hasSanitaryToilet);

  columns.has_basic_safe_water = hasBasicSafeWater;
  columns.has_sanitary_toilet = hasSanitaryToilet;
  columns.complete_sanitation = completeSanitation;
  data.safely_managed_water = safelyManagedWater;
  data.safely_managed_sanitation = safelyManagedSanitation;
  data.waste_practice_ok = wastePracticeOk;
};

const residentFor = async (supabase, user, residentId) => {
  const { data, error } = await supabase
    .from('residents')
    .select('id, barangay, barangay_id, municipality_id, auth_user_id')
    .eq('id', residentId)
    .maybeSingle();
  throwOnError(error, 'Could not load resident');
  if (!data) throw ApiError.notFound('Resident record not found.');
  const scope = assignedBarangay(user);
  if ((scope && text(data.barangay).toLowerCase() !== text(scope).toLowerCase())
    || (user.municipalityId && data.municipality_id && user.municipalityId !== data.municipality_id)) {
    throw ApiError.notFound('Resident record not found.');
  }
  return data;
};

const householdFor = async (supabase, user, householdId) => {
  const { data, error } = await supabase
    .from('households')
    .select('id, barangay, barangay_id, municipality_id')
    .eq('id', householdId)
    .maybeSingle();
  throwOnError(error, 'Could not load household');
  if (!data) throw ApiError.notFound('Household record not found.');
  const scope = assignedBarangay(user);
  if ((scope && text(data.barangay).toLowerCase() !== text(scope).toLowerCase())
    || (user.municipalityId && data.municipality_id && user.municipalityId !== data.municipality_id)) {
    throw ApiError.notFound('Household record not found.');
  }
  return data;
};

/** Resolve + scope-check the parent entity for a kind. */
const entityFor = async (supabase, user, schema, payload) => {
  if (schema.scope === 'household') {
    const householdId = text(payload.householdId || payload.household_id);
    if (!householdId) throw ApiError.unprocessable('A household must be selected.');
    const household = await householdFor(supabase, user, householdId);
    return { linkColumn: 'household_id', id: household.id, entity: household };
  }
  const residentId = text(payload.residentId || payload.resident_id);
  if (!residentId) throw ApiError.unprocessable('A resident must be selected.');
  const resident = await residentFor(supabase, user, residentId);
  return { linkColumn: 'resident_id', id: resident.id, entity: resident };
};

const audit = async (supabase, user, action, entityType, entityId, scope) => {
  const { error } = await supabase.from('health_audit_logs').insert({
    actor_id: user.id, action, entity_type: entityType, entity_id: entityId,
    municipality_id: scope?.municipality_id || null, barangay_id: scope?.barangay_id || null,
  });
  throwOnError(error, 'Could not write audit log');
};

const RESIDENT_EMBED = 'resident:residents(id, first_name, middle_name, last_name, barangay, sex, birth_date, current_address, cellphone_no)';
const HOUSEHOLD_EMBED = 'household:households(id, head_name, purok, street_address, barangay)';
const selectFor = (schema) => (schema.scope === 'household'
  ? `*, ${HOUSEHOLD_EMBED}`
  : `*, ${RESIDENT_EMBED}`);

const dateColumn = (schema) => (schema.kind === 'oral-health' ? 'consultation_date' : 'assessment_date');

export const list = async ({
  user, kind, residentId = null, householdId = null, from = null, to = null, supabase = getServiceClient(),
}) => {
  const schema = schemaFor(kind);
  assertStaff(user);
  const col = dateColumn(schema);
  let query = supabase.from(schema.table).select(selectFor(schema)).order('created_at', { ascending: false }).limit(300);
  if (user.role === 'health_supervisor') {
    if (!user.barangayId) return [];
    query = query.eq('barangay_id', user.barangayId);
  } else if (user.role === 'phn' || user.role === 'mho') {
    if (!user.municipalityId) return [];
    query = query.eq('municipality_id', user.municipalityId);
  }
  if (residentId && schema.scope === 'resident') {
    await residentFor(supabase, user, residentId);
    query = query.eq('resident_id', residentId);
  }
  if (householdId && schema.scope === 'household') {
    await householdFor(supabase, user, householdId);
    query = query.eq('household_id', householdId);
  }
  if (from) { if (!dateIsDateOnly(from)) throw ApiError.badRequest('Invalid "from" date.'); query = query.gte(col, from); }
  if (to) { if (!dateIsDateOnly(to)) throw ApiError.badRequest('Invalid "to" date.'); query = query.lte(col, to); }
  const { data, error } = await query;
  throwOnError(error, `Could not load ${kind}`);
  return data || [];
};

export const create = async ({ user, kind, payload = {}, supabase = getServiceClient() }) => {
  const schema = schemaFor(kind);
  assertStaff(user);
  const { linkColumn, id: entityId, entity } = await entityFor(supabase, user, schema, payload);
  const { columns, data } = buildRow(schema, payload);
  if (schema.kind === 'environmental') computeEnvironmentalDerived(columns, data);
  const row = { ...columns, data, [linkColumn]: entityId, created_by: user.id };
  const { data: created, error } = await supabase.from(schema.table).insert(row).select(selectFor(schema)).single();
  throwOnError(error, `Could not create ${kind}`);
  await audit(supabase, user, `${kind.toUpperCase()}_CREATED`, schema.table, created.id, entity);
  return created;
};

export const update = async ({ user, kind, id, payload = {}, supabase = getServiceClient() }) => {
  const schema = schemaFor(kind);
  assertStaff(user);
  const { data: existing, error: readError } = await supabase.from(schema.table).select('*').eq('id', id).maybeSingle();
  throwOnError(readError, `Could not load ${kind}`);
  if (!existing) throw ApiError.notFound('Program record not found.');
  // Re-check the stored record's scope against the caller before updating.
  const scope = schema.scope === 'household'
    ? await householdFor(supabase, user, existing.household_id)
    : await residentFor(supabase, user, existing.resident_id);
  const { columns, data } = buildRow(schema, payload);
  if (schema.kind === 'environmental') computeEnvironmentalDerived(columns, data);
  // Merge jsonb data so a partial update does not wipe untouched detail keys.
  const mergedData = { ...(existing.data || {}), ...data };
  const row = { ...columns, data: mergedData };
  const { data: updated, error } = await supabase.from(schema.table).update(row).eq('id', id).select(selectFor(schema)).single();
  throwOnError(error, `Could not update ${kind}`);
  await audit(supabase, user, `${kind.toUpperCase()}_UPDATED`, schema.table, id, scope);
  return updated;
};

export const remove = async ({ user, kind, id, supabase = getServiceClient() }) => {
  const schema = schemaFor(kind);
  assertStaff(user);
  const { data: existing, error: readError } = await supabase.from(schema.table).select('*').eq('id', id).maybeSingle();
  throwOnError(readError, `Could not load ${kind}`);
  if (!existing) throw ApiError.notFound('Program record not found.');
  const scope = schema.scope === 'household'
    ? await householdFor(supabase, user, existing.household_id)
    : await residentFor(supabase, user, existing.resident_id);
  const { error } = await supabase.from(schema.table).delete().eq('id', id);
  throwOnError(error, `Could not delete ${kind}`);
  await audit(supabase, user, `${kind.toUpperCase()}_DELETED`, schema.table, id, scope);
  return { id };
};

/**
 * Oral Health "ST" statistical table - BOHC counts computed FROM saved
 * oral_health_records (not invented). Counts are grouped by age bucket and
 * NHTS/Non-NHTS for the requested reporting period. Population-based TARGETS
 * (eligible population = Total Pop x factor) are NOT fabricated here: they
 * require an external population denominator, which the caller supplies via
 * `?population=` (optional). The official per-indicator factors are returned so
 * the client can show the target basis transparently.
 */
export const ORAL_ST_FACTORS = Object.freeze({
  bohc_0_11: { label: 'Infants 0-11 months who received BOHC', factor: 0.02056, multiplier: 0.30 },
  bohc_1_4: { label: 'Children 1-4 years who received BOHC', factor: 0.08658, multiplier: 0.30 },
  bohc_5_9: { label: 'Children 5-9 years who received BOHC', factor: 0.10738, multiplier: 0.30 },
  bohc_10_19: { label: 'Adolescents 10-19 years who received BOHC', factor: 0.20485, multiplier: 0.30 },
  bohc_20_59: { label: 'Adults 20-59 years who received BOHC', factor: 0.50588, multiplier: 0.30 },
  bohc_60: { label: 'Senior citizens 60+ who received BOHC', factor: 0.07476, multiplier: 0.30 },
  pregnant: { label: 'Pregnant women who received BOHC', factor: 0.02056, multiplier: 1 },
});

export const oralStatistics = async ({ user, from = null, to = null, population = null, supabase = getServiceClient() }) => {
  assertStaff(user);
  const rows = await list({ user, kind: 'oral-health', from, to, supabase });
  const bucketKey = (r) => {
    switch (r.age_group) {
      case '0-11mos': return 'bohc_0_11';
      case '1-4': return 'bohc_1_4';
      case '5-9': return 'bohc_5_9';
      case '10-19': return 'bohc_10_19';
      case '20-59': return 'bohc_20_59';
      case '>=60': return 'bohc_60';
      case 'pregnant': return 'pregnant';
      default: return null;
    }
  };
  const indicators = {};
  for (const key of Object.keys(ORAL_ST_FACTORS)) indicators[key] = { nhts: 0, non_nhts: 0, total: 0, m: 0, f: 0 };
  let orallyFit = { nhts: 0, non_nhts: 0, total: 0, m: 0, f: 0 };
  let dmftNew = { nhts: 0, non_nhts: 0, total: 0, m: 0, f: 0 };
  const bump = (bucket, r) => {
    bucket[r.se_status === 'NHTS' ? 'nhts' : 'non_nhts'] += 1;
    bucket.total += 1;
    const sex = r.resident?.sex;
    if (sex === 'M' || sex === 'Male') bucket.m += 1;
    else if (sex === 'F' || sex === 'Female') bucket.f += 1;
  };
  for (const r of rows) {
    const data = r.data || {};
    // Indicator 1: orally fit children 12-59 mos (fit upon exam OR after rehab)
    if (data.orally_fit_exam_date || data.orally_fit_rehab_date) bump(orallyFit, r);
    // Indicator 2: clients 5+ with new DMFT cases
    if ((data.dmft_decayed || data.dmft_missing || data.dmft_filled) && r.age_group !== '0-11mos' && r.age_group !== '1-4') {
      bump(dmftNew, r);
    }
    // BOHC indicators 3-9: count when a BOHC date exists for the client's bucket
    const key = bucketKey(r);
    const bohc = data.bohc || {};
    const bohcBucket = r.age_group === 'pregnant' ? 'pregnant' : r.age_group;
    if (key && bohc[bohcBucket]) bump(indicators[key], r);
  }
  const pop = population != null && !Number.isNaN(Number(population)) ? Number(population) : null;
  const withTargets = Object.fromEntries(Object.entries(ORAL_ST_FACTORS).map(([k, def]) => [k, {
    label: def.label,
    counts: indicators[k],
    target_basis: `Eligible Population = (Total Pop x ${(def.factor * 100).toFixed(3)}%)${def.multiplier !== 1 ? ` x ${def.multiplier * 100}%` : ''}`,
    target: pop != null ? Math.round(pop * def.factor * def.multiplier) : null,
  }]));
  return {
    period: { from, to },
    population: pop,
    indicator_1_orally_fit_12_59: { label: 'Orally fit children 12-59 months (upon exam + after rehab)', counts: orallyFit },
    indicator_2_dmft_new: { label: 'Clients 5+ with new cases of DMFT', counts: dmftNew },
    bohc: withTargets,
    note: 'Counts are computed from saved Oral Health TCL records. Population-based targets are only shown when a population denominator is supplied; they are never fabricated.',
  };
};

export default { list, create, update, remove, oralStatistics };
