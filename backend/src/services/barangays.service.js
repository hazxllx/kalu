import ApiError from '../utils/apiError.js';
import { getServiceClient } from '../config/supabase.js';

/**
 * Admin Barangay Management service (admin-only).
 *
 * The barangay registry (public.barangays) is the authoritative source for
 * every barangay dropdown and barangay-scoped query in KALUSAGAP. This service
 * backs the Admin "Barangay Management" page: list / create / update with:
 *
 *   - uniqueness enforced per municipality (DB constraint + friendly 409);
 *   - rename propagation to the denormalized `barangay` name columns on
 *     residents and households, so a rename never desynchronizes those rows
 *     (relationships stay keyed on the stable barangay_id);
 *   - STATUS-based management: every barangay carries an Active/Inactive
 *     status. Deactivation preserves residents, assignments, records and
 *     history while hiding the barangay from new selections; there is no
 *     permanent delete workflow in routine management.
 *   - audit entries in public.health_audit_logs for every mutation.
 *
 * Authorization is enforced at the route (authorize(FEATURE_ROLES.barangays) =>
 * admin only) and the service runs with the service-role client, which bypasses
 * RLS — so the admin gate above is the boundary for these endpoints.
 */

const BARANGAY_SELECT =
  'id, name, status, captain, contact, health_station_name, latitude, longitude, '
  + 'municipality_id, created_at, updated_at, municipality:municipalities(id, name, province)';

const PG_UNIQUE_VIOLATION = '23505';

const supabase = () => getServiceClient();

const throwOnError = (error, message, status = 502) => {
  if (error) throw new ApiError(status, `${message}: ${error.message}`);
};

/** Shape a DB row for the API (flatten the municipality join). */
const toRecord = (row) => {
  if (!row) return null;
  const municipality = row.municipality || null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    captain: row.captain || '',
    contact: row.contact || '',
    healthStationName: row.health_station_name || '',
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    municipalityId: row.municipality_id,
    municipality: municipality ? municipality.name : '',
    province: municipality ? municipality.province : '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const recordAudit = async ({ actorId, action, entityId, municipalityId, barangayId, metadata }) => {
  const { error } = await supabase()
    .from('health_audit_logs')
    .insert({
      actor_id: actorId || null,
      action,
      entity_type: 'barangays',
      entity_id: entityId,
      municipality_id: municipalityId || null,
      barangay_id: barangayId || null,
      metadata: metadata || {},
    });
  // Auditing must not silently drop an administrative change.
  throwOnError(error, 'Could not record the barangay audit entry');
};

/** Load one barangay row or throw 404. */
const getRow = async (id) => {
  const { data, error } = await supabase()
    .from('barangays')
    .select(BARANGAY_SELECT)
    .eq('id', id)
    .maybeSingle();
  throwOnError(error, 'Could not load the barangay');
  if (!data) throw ApiError.notFound('Barangay not found.');
  return data;
};

const assertMunicipalityExists = async (municipalityId) => {
  const { data, error } = await supabase()
    .from('municipalities')
    .select('id, name')
    .eq('id', municipalityId)
    .maybeSingle();
  throwOnError(error, 'Could not verify the municipality');
  if (!data) throw ApiError.badRequest('The selected municipality does not exist.');
  return data;
};

/** Count rows in a table that reference this barangay by a column. */
const countBy = async (table, column, value) => {
  const { count, error } = await supabase()
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value);
  // A missing/inaccessible table should not crash the dependency check; treat
  // an error conservatively as "unknown" rather than silently zero.
  if (error) return null;
  return count ?? 0;
};

/**
 * Count every dependent record that would be orphaned or broken by deleting a
 * barangay. residents/households/visits carry an ON DELETE RESTRICT FK, so the
 * database itself also refuses the delete; profiles/facilities would be nulled
 * (ON DELETE SET NULL), which we equally refuse here to protect assignments.
 */
const getDependencies = async (id) => {
  const [personnel, facilities, residents, households, visits] = await Promise.all([
    countBy('profiles', 'barangay_id', id),
    countBy('facilities', 'barangay_id', id),
    countBy('residents', 'barangay_id', id),
    countBy('households', 'barangay_id', id),
    countBy('visits', 'barangay_id', id),
  ]);
  const parts = { personnel, facilities, residents, households, visits };
  const total = Object.values(parts).reduce((sum, n) => sum + (n || 0), 0);
  return { ...parts, total };
};

export const getBarangayOptions = async () => {
  const { data, error } = await supabase()
    .from('municipalities')
    .select('id, name, province')
    .eq('is_active', true)
    .order('name', { ascending: true });
  throwOnError(error, 'Could not load municipalities');
  return {
    municipalities: (data || []).map((m) => ({ id: m.id, name: m.name, province: m.province })),
    statuses: ['Active', 'Inactive'],
  };
};

export const listBarangays = async ({ q, municipalityId, status } = {}) => {
  let query = supabase().from('barangays').select(BARANGAY_SELECT);

  if (municipalityId) query = query.eq('municipality_id', municipalityId);
  if (status && (status === 'Active' || status === 'Inactive')) query = query.eq('status', status);

  const term = typeof q === 'string' ? q.trim() : '';
  if (term) query = query.ilike('name', `%${term}%`);

  query = query.order('name', { ascending: true });

  const { data, error } = await query;
  throwOnError(error, 'Could not load barangays');
  return { barangays: (data || []).map(toRecord) };
};

export const getBarangay = async ({ id }) => {
  const row = await getRow(id);
  const dependencies = await getDependencies(id);
  return { barangay: toRecord(row), dependencies };
};

export const createBarangay = async ({ actorId, input }) => {
  const municipality = await assertMunicipalityExists(input.municipalityId);

  const insertRow = {
    municipality_id: input.municipalityId,
    name: input.name,
    status: input.status || 'Active',
    captain: input.captain || '',
    contact: input.contact || '',
    health_station_name: input.healthStationName || '',
  };
  if (input.latitude !== undefined) insertRow.latitude = input.latitude;
  if (input.longitude !== undefined) insertRow.longitude = input.longitude;

  const { data, error } = await supabase()
    .from('barangays')
    .insert(insertRow)
    .select(BARANGAY_SELECT)
    .single();

  if (error?.code === PG_UNIQUE_VIOLATION) {
    throw ApiError.conflict(`A barangay named "${input.name}" already exists in ${municipality.name}.`);
  }
  throwOnError(error, 'Could not create the barangay');

  await recordAudit({
    actorId,
    action: 'BARANGAY_CREATED',
    entityId: data.id,
    municipalityId: data.municipality_id,
    barangayId: data.id,
    metadata: { name: data.name, status: data.status },
  });

  return toRecord(data);
};

export const updateBarangay = async ({ id, actorId, patch }) => {
  const existing = await getRow(id);

  // A move to another municipality must still resolve to a real one.
  const targetMunicipalityId = patch.municipalityId || existing.municipality_id;
  if (patch.municipalityId && patch.municipalityId !== existing.municipality_id) {
    await assertMunicipalityExists(patch.municipalityId);
  }

  const updateRow = {};
  if (patch.name !== undefined) updateRow.name = patch.name;
  if (patch.municipalityId !== undefined) updateRow.municipality_id = patch.municipalityId;
  if (patch.status !== undefined) updateRow.status = patch.status;
  if (patch.captain !== undefined) updateRow.captain = patch.captain;
  if (patch.contact !== undefined) updateRow.contact = patch.contact;
  if (patch.healthStationName !== undefined) updateRow.health_station_name = patch.healthStationName;
  if (patch.latitude !== undefined) updateRow.latitude = patch.latitude;
  if (patch.longitude !== undefined) updateRow.longitude = patch.longitude;

  const { data, error } = await supabase()
    .from('barangays')
    .update(updateRow)
    .eq('id', id)
    .select(BARANGAY_SELECT)
    .single();

  if (error?.code === PG_UNIQUE_VIOLATION) {
    throw ApiError.conflict(`A barangay with that name already exists in the selected municipality.`);
  }
  throwOnError(error, 'Could not update the barangay');

  // Rename propagation: residents and households keep a denormalized barangay
  // NAME for display/filtering alongside the stable barangay_id. The id-based
  // relationships are untouched by a rename, but the cached names must follow
  // the new name so the whole application stays consistent.
  const renamed = patch.name !== undefined && patch.name !== existing.name;
  if (renamed) {
    const residentsUpdate = await supabase()
      .from('residents')
      .update({ barangay: data.name })
      .eq('barangay_id', id);
    throwOnError(residentsUpdate.error, 'Could not propagate the barangay rename to residents');

    const householdsUpdate = await supabase()
      .from('households')
      .update({ barangay: data.name })
      .eq('barangay_id', id);
    throwOnError(householdsUpdate.error, 'Could not propagate the barangay rename to households');
  }

  await recordAudit({
    actorId,
    action: 'BARANGAY_UPDATED',
    entityId: id,
    municipalityId: targetMunicipalityId,
    barangayId: id,
    metadata: {
      changes: updateRow,
      previous: {
        name: existing.name,
        status: existing.status,
        municipality_id: existing.municipality_id,
      },
      renamed,
    },
  });

  return toRecord(data);
};

/**
 * Dedicated Active/Inactive status change for one barangay.
 *
 * Status-based management replaces deletion: an inactive barangay is preserved
 * together with its residents, households, personnel assignments and history,
 * while being excluded from new selections (the app-wide barangay registry
 * loads only status='Active' rows). Returns the updated record; the change is
 * audited and the frontend re-reads it immediately.
 */
export const updateBarangayStatus = async ({ id, actorId, status }) => {
  const normalized = String(status ?? '').trim();
  if (normalized !== 'Active' && normalized !== 'Inactive') {
    throw ApiError.badRequest('Status must be either Active or Inactive.');
  }
  const existing = await getRow(id);
  if (existing.status === normalized) {
    return toRecord(existing);
  }

  const { data, error } = await supabase()
    .from('barangays')
    .update({ status: normalized })
    .eq('id', id)
    .select(BARANGAY_SELECT)
    .single();
  throwOnError(error, 'Could not update the barangay status');

  await recordAudit({
    actorId,
    action: 'BARANGAY_STATUS_CHANGED',
    entityId: id,
    municipalityId: data.municipality_id,
    barangayId: id,
    metadata: { name: data.name, previousStatus: existing.status, newStatus: data.status },
  });

  return toRecord(data);
};

export default {
  getBarangayOptions,
  listBarangays,
  getBarangay,
  createBarangay,
  updateBarangay,
  updateBarangayStatus,
};
