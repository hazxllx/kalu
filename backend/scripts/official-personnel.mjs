export const isPersonnel = (role) => ['admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw'].includes(role);

export function buildProfilePatch(acct, profile, scope) {
  // Provisioning retries must not reverse administrator decisions/assignments.
  if (isPersonnel(profile.role)) return {};
  const patch = {};
  if (profile.role !== acct.role) patch.role = acct.role;
  // Preserve resident verification; new official personnel start active.
  if (acct.role === 'resident') {
    if (profile.status === 'disabled') patch.status = 'active';
  } else if (profile.status !== acct.status) {
    patch.status = acct.status;
  }
  if (!profile.full_name) patch.full_name = acct.fullName;

  if (acct.scope === 'municipality') {
    if (!profile.municipality_id) patch.municipality_id = scope.municipalityId;
    if (profile.barangay_id) patch.barangay_id = null;
  } else if (acct.scope === 'barangay') {
    if (!profile.municipality_id) patch.municipality_id = scope.municipalityId;
    if (!profile.barangay_id) {
      const bId = scope.barangayByName.get(acct.barangay);
      if (!bId) throw new Error(`barangay '${acct.barangay}' not found in seed data`);
      patch.barangay_id = bId;
    }
  } else if (acct.scope === 'none' && acct.role !== 'resident') {
    if (profile.barangay_id) patch.barangay_id = null;
  }
  if (acct.role === 'rhu_personnel') Object.assign(patch, newRhuAssignment(scope));
  return patch;
}

// Check before credential or profile writes, including the resident profile
// automatically created for an unfinished managed Auth reservation.
export async function assertOfficialPersonnelIdentity(admin, user) {
  const { data: residents, error: residentError } = await admin.from('residents')
    .select('id').eq('auth_user_id', user.id).limit(1);
  if (residentError) throw new Error(`resident identity lookup failed: ${residentError.message}`);
  const { data: reservations, error: reservationError } = await admin.from('personnel_account_operations')
    .select('id').eq('account_id', user.id).eq('action', 'create').is('completed_at', null).limit(1);
  if (reservationError) throw new Error(`personnel reservation lookup failed: ${reservationError.message}`);
  if (residents.length || reservations.length || user.app_metadata?.personnel_managed === true
    || user.app_metadata?.personnel_managed === 'true') {
    throw new Error('Official provisioning cannot adopt a resident-linked or managed personnel identity.');
  }
}

export async function reconcileOfficialPersonnel(admin, id, apply) {
  if (!apply) return 'WOULD RECONCILE missing personnel lifecycle (eligible identities only)';
  const { data, error } = await admin.rpc('reconcile_provisioned_personnel', { p_target_id: id });
  if (error) throw new Error(`personnel reconciliation failed: ${error.message}`);
  return data ? 'CREATED personnel lifecycle (preserved current access)' : 'Personnel lifecycle unchanged';
}

export function newRhuAssignment(scope) {
  if (!scope.rhuFacilityId) throw new Error('Seeded RHU facility not found in the official municipality');
  return { facility_id: scope.rhuFacilityId, rhu_stations: ['triage', 'consultation'] };
}
