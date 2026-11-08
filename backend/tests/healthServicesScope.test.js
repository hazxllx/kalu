import assert from 'node:assert/strict';
import test from 'node:test';
import env from '../src/config/env.js';
import * as healthServices from '../src/services/healthServices.service.js';

env.isSupabaseConfigured = false;

const uuid = (value) => `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`;
const municipalityId = uuid(1);
const otherMunicipalityId = uuid(2);
const barangayId = uuid(11);
const otherBarangayId = uuid(12);
const foreignBarangayId = uuid(21);
const serviceId = uuid(101);
const bhsServiceId = uuid(102);
const assignedServiceId = uuid(103);
const foreignServiceId = uuid(104);
const personnelId = uuid(201);
const supervisor = { id: uuid(301), role: 'health_supervisor', status: 'active', name: 'Supervisor', municipalityId, barangayId };
const phn = { id: uuid(302), role: 'phn', status: 'active', name: 'PHN', municipalityId, barangayId: null };
const barangays = [
  { id: barangayId, municipality_id: municipalityId, name: 'San Isidro', status: 'Active' },
  { id: otherBarangayId, municipality_id: municipalityId, name: 'San Antonio', status: 'Active' },
  { id: foreignBarangayId, municipality_id: otherMunicipalityId, name: 'San Isidro', status: 'Active' },
];
const facilities = [
  { id: uuid(401), municipality_id: municipalityId, barangay_id: barangayId, type: 'barangay_health_station', name: 'BHS' },
  { id: uuid(402), municipality_id: municipalityId, barangay_id: null, type: 'rhu', name: 'RHU' },
];
const profile = (patch = {}) => {
  const row = { id: personnelId, role: 'bhw', status: 'active', municipality_id: municipalityId, barangay_id: barangayId,
    facility_id: null, full_name: 'Actual Worker', email: 'worker@example.test', account: null, ...patch };
  return { municipality: { id: row.municipality_id, is_active: true },
    barangay: barangays.find((barangay) => barangay.id === row.barangay_id) || null,
    facility: facilities.find((facility) => facility.id === row.facility_id) || null, ...row };
};
const services = [
  { id: serviceId, municipality_id: municipalityId, barangay_id: null, facility_id: null, name: 'Municipal Program', category: 'Other', active: true },
  { id: bhsServiceId, municipality_id: municipalityId, barangay_id: barangayId, facility_id: uuid(401), name: 'Barangay Program', category: 'Maternal', active: true },
  { id: assignedServiceId, municipality_id: municipalityId, barangay_id: otherBarangayId, facility_id: null, name: 'Assigned Program', category: 'Other', active: true },
  { id: foreignServiceId, municipality_id: otherMunicipalityId, barangay_id: foreignBarangayId, facility_id: null, name: 'Foreign Program', category: 'Other', active: true },
];
const residents = [
  { id: 'RES-OWN', first_name: 'Scoped', last_name: 'Resident', municipality_id: municipalityId, barangay_id: barangayId, barangay: 'San Isidro' },
  { id: 'RES-OTHER', first_name: 'Private Other', last_name: 'Resident', municipality_id: municipalityId, barangay_id: otherBarangayId, barangay: 'San Antonio' },
  { id: 'RES-FOREIGN', first_name: 'Private Foreign', last_name: 'Resident', municipality_id: otherMunicipalityId, barangay_id: foreignBarangayId, barangay: 'San Isidro' },
  { id: 'RES-NO-MUNICIPALITY', first_name: 'Private Missing', municipality_id: null, barangay_id: barangayId, barangay: 'San Isidro' },
  { id: 'RES-NO-BARANGAY', first_name: 'Private Missing', municipality_id: municipalityId, barangay_id: null, barangay: 'San Isidro' },
];
const attendance = residents.map((resident, index) => ({ id: uuid(501 + index), service_id: serviceId,
  resident_id: resident.id, scheduled_date: '2026-11-07', attendance_status: 'scheduled', notes: `${resident.first_name} notes` }));
const plan = (id, residentId, patch = {}) => ({ id: uuid(id), service_id: serviceId, resident_id: residentId,
  barangay_id: barangayId, facility_type: 'RHU', planned_date: '2026-11-07', note: `${residentId} private registration note`, status: 'Planned', ...patch });

// Emulate service-role reads, including PostgREST inner joins and filtering before
// ranges. Every profile/resident uses the current persisted field contract.
const makeSupabase = (seed = {}, fail = () => null) => {
  const store = {
    health_services: services.map((row) => ({ ...row })), profiles: [profile()], facilities: facilities.map((row) => ({ ...row })),
    residents: residents.map((row) => ({ ...row })), health_service_assignments: [], health_service_attendance: [], visit_plans: [], ...seed,
  };
  const calls = [];
  let sequence = 10000;
  const from = (table) => {
    const state = { table, op: 'select', select: '', filters: [], orders: [], range: null, payload: null };
    const valueAt = (row, key) => key.split('.').reduce((value, part) => value?.[part], row);
    const matches = (row) => state.filters.every(({ type, key, value }) => {
      const actual = valueAt(row, key);
      if (type === 'eq') return actual === value;
      if (type === 'neq') return actual !== value;
      if (type === 'in') return value.includes(actual);
      if (type === 'gte') return actual >= value;
      if (type === 'lte') return actual <= value;
      return String(actual).toLowerCase() === String(value).toLowerCase();
    });
    const run = (single = false) => {
      calls.push({ ...state, filters: [...state.filters], range: state.range && [...state.range] });
      const error = fail(state);
      if (error) return { data: null, error };
      const rows = store[table] || [];
      if (state.op === 'insert' || state.op === 'upsert') {
        const written = [].concat(state.payload).map((payload) => {
          const existing = state.op === 'upsert' && rows.find((row) => row.service_id === payload.service_id && row.personnel_id === payload.personnel_id);
          if (existing) { Object.assign(existing, payload); return existing; }
          const row = { id: uuid(sequence++), ...payload };
          rows.push(row);
          return row;
        });
        return { data: single ? written[0] : written, error: null };
      }
      if (state.op === 'update') {
        const written = rows.filter(matches);
        for (const row of written) Object.assign(row, state.payload);
        return { data: single ? written[0] : written, error: null };
      }
      let result = rows.map((row) => {
        if (table === 'health_services') return { ...row, health_service_assignments: store.health_service_assignments
          .filter((assignment) => assignment.service_id === row.id)
          .map((assignment) => ({ ...assignment, personnel: store.profiles.find((person) => person.id === assignment.personnel_id) || null })) };
        const joined = { ...row };
        if (state.select.includes('resident:')) joined.resident = store.residents.find((resident) => resident.id === row.resident_id) || null;
        if (state.select.includes('service:')) joined.service = store.health_services.find((service) => service.id === row.service_id) || null;
        return joined;
      }).filter((row) => (!state.select.includes('residents!inner') || row.resident)
        && (!state.select.includes('health_services!inner') || row.service)).filter(matches);
      result.sort((left, right) => {
        for (const { key, ascending } of state.orders) {
          const comparison = String(valueAt(left, key) ?? '').localeCompare(String(valueAt(right, key) ?? ''));
          if (comparison) return ascending ? comparison : -comparison;
        }
        return 0;
      });
      if (state.range) result = result.slice(state.range[0], state.range[1] + 1);
      return { data: single ? result[0] || null : result, error: null };
    };
    const chain = {
      select(value) { state.select = value; return chain; },
      eq(key, value) { state.filters.push({ type: 'eq', key, value }); return chain; },
      neq(key, value) { state.filters.push({ type: 'neq', key, value }); return chain; },
      in(key, value) { state.filters.push({ type: 'in', key, value }); return chain; },
      gte(key, value) { state.filters.push({ type: 'gte', key, value }); return chain; },
      lte(key, value) { state.filters.push({ type: 'lte', key, value }); return chain; },
      ilike(key, value) { state.filters.push({ type: 'ilike', key, value }); return chain; },
      order(key, { ascending = true } = {}) { state.orders.push({ key, ascending }); return chain; },
      range(start, end) { state.range = [start, end]; return chain; },
      limit(value) { state.range = [0, value - 1]; return chain; },
      insert(value) { state.op = 'insert'; state.payload = value; return chain; },
      upsert(value) { state.op = 'upsert'; state.payload = value; return chain; },
      update(value) { state.op = 'update'; state.payload = value; return chain; },
      single() { return Promise.resolve(run(true)); },
      maybeSingle() { return Promise.resolve(run(true)); },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return chain;
  };
  return { client: { from }, store, calls, writes: () => calls.filter((call) => call.op !== 'select') };
};

test('active cross-municipality assignments cannot grant get, catalog or mine visibility', async () => {
  const { client, calls } = makeSupabase({ health_service_assignments: [
    { id: uuid(601), service_id: foreignServiceId, personnel_id: supervisor.id, active: true },
    { id: uuid(602), service_id: assignedServiceId, personnel_id: supervisor.id, active: true },
  ] });
  await assert.rejects(healthServices.getById({ user: supervisor, id: foreignServiceId, supabase: client }), { statusCode: 404 });
  assert.equal(calls.some((call) => call.table === 'health_service_assignments'), false, 'municipality fails before the assignment exception');
  assert.equal((await healthServices.getById({ user: supervisor, id: assignedServiceId, supabase: client })).id, assignedServiceId);
  assert.deepEqual((await healthServices.list({ user: supervisor, mine: true, supabase: client })).map((row) => row.id), [assignedServiceId]);
  assert.deepEqual((await healthServices.list({ user: supervisor, supabase: client })).map((row) => row.id).sort(), [serviceId, bhsServiceId, assignedServiceId].sort());
});

test('historical active assignments do not expose an invalid personnel identity in service responses', async () => {
  const { client, store } = makeSupabase({ profiles: [profile({ municipality_id: otherMunicipalityId, barangay_id: foreignBarangayId })],
    health_service_assignments: [{ id: uuid(601), service_id: serviceId, personnel_id: personnelId, active: true }] });
  const service = await healthServices.getById({ user: phn, id: serviceId, supabase: client });
  assert.deepEqual(service.assignedPersonnel, []);
  assert.equal(store.health_service_assignments.length, 1, 'invalid history is retained for remediation');
});

test('create, update and assign reject wrong-role, inactive or out-of-scope personnel before ANY writes', async () => {
  const invalid = [
    profile({ role: 'resident' }), profile({ role: 'admin' }), profile({ status: 'disabled' }), profile({ status: 'pending_verification' }),
    profile({ status: null }), profile({ municipality_id: otherMunicipalityId, barangay_id: foreignBarangayId }),
    profile({ municipality_id: null }), profile({ barangay_id: otherBarangayId }), profile({ barangay_id: null }),
    profile({ barangay: { ...barangays[0], status: 'Inactive' } }), profile({ barangay: { ...barangays[0], municipality_id: otherMunicipalityId } }),
    profile({ barangay: { ...barangays[0], name: 'Unapproved' } }), profile({ municipality: { id: municipalityId, is_active: false } }),
    profile({ account: { approval_status: 'pending', setup_required: false } }),
    profile({ account: { approval_status: 'approved', setup_required: true } }),
    profile({ account: { approval_status: 'approved', setup_required: false, suspended_at: '2026-11-01T00:00:00Z' } }),
    profile({ role: 'rhu_personnel', facility_id: uuid(401) }),
    profile({ role: 'rhu_personnel', facility_id: uuid(402), facility: { ...facilities[1], municipality_id: otherMunicipalityId } }),
    profile({ role: 'rhu_personnel', facility_id: null }),
    profile({ facility_id: uuid(401), facility: { ...facilities[0], barangay_id: otherBarangayId } }),
    profile({ id: 'submitted-name-not-an-account' }),
  ];
  for (const person of [...invalid, null]) {
    const id = person?.id || uuid(999);
    for (const operation of ['create', 'update', 'assign']) {
      const fixture = makeSupabase({ profiles: person ? [person] : [] });
      const args = { user: supervisor, supabase: fixture.client, serviceId: bhsServiceId,
        personnelId: id, payload: { name: 'Must not persist', facilityName: 'Must not create a facility', personnelIds: [id] } };
      await assert.rejects(healthServices[operation](args), { statusCode: 422 }, `${operation}: ${JSON.stringify(person)}`);
      assert.deepEqual(fixture.writes(), [], `${operation} must validate before facility, catalog or assignment writes`);
    }
  }
});

test('same-scope valid create, update and assign retain actual personnel identity and soft-removal history', async () => {
  const fixture = makeSupabase();
  const assigned = await healthServices.assign({ user: supervisor, serviceId: bhsServiceId, personnelId, supabase: fixture.client });
  assert.equal(assigned.assignedPersonnel[0].name, 'Actual Worker');
  assert.equal(assigned.assignedPersonnel[0].role, 'bhw');
  const created = await healthServices.create({ user: supervisor, supabase: fixture.client,
    payload: { name: 'New scoped service', facilityId: uuid(401), personnelIds: [personnelId, personnelId], personnelName: 'Forged name', role: 'mho' } });
  assert.equal(created.assignedPersonnel.length, 1);
  assert.equal(created.assignedPersonnel[0].name, 'Actual Worker');
  await healthServices.update({ user: supervisor, serviceId: bhsServiceId, payload: { name: 'Edited', personnelIds: [] }, supabase: fixture.client });
  assert.equal(fixture.store.health_service_assignments.find((row) => row.service_id === bhsServiceId).active, false);
  await healthServices.update({ user: supervisor, serviceId: bhsServiceId, payload: { personnelIds: [personnelId] }, supabase: fixture.client });
  assert.equal(fixture.store.health_service_assignments.filter((row) => row.service_id === bhsServiceId).length, 1);
});

test('municipal managers retain explicit same-municipality cross-barangay and RHU personnel assignments', async () => {
  const other = profile({ id: uuid(202), barangay_id: otherBarangayId });
  const rhu = profile({ id: uuid(203), role: 'rhu_personnel', barangay_id: null, facility_id: uuid(402) });
  const { client } = makeSupabase({ profiles: [other, rhu] });
  await healthServices.assign({ user: phn, serviceId: bhsServiceId, personnelId: other.id, supabase: client });
  await healthServices.assign({ user: phn, serviceId: bhsServiceId, personnelId: rhu.id, supabase: client });
  assert.equal((await healthServices.getById({ user: { id: other.id, role: 'bhw', municipalityId, barangayId: otherBarangayId }, id: bhsServiceId, supabase: client })).id, bhsServiceId);
});

test('municipality-wide and assigned services cannot leak another barangay resident, ID or notes on any attendance read', async () => {
  for (const id of [serviceId, assignedServiceId]) {
    const { client } = makeSupabase({ health_service_assignments: [{ id: uuid(601), service_id: assignedServiceId, personnel_id: supervisor.id, active: true }],
      health_service_attendance: attendance.map((row) => ({ ...row, service_id: id })) });
    for (const user of [supervisor, { ...supervisor, role: 'bhw' }]) {
      const byService = await healthServices.listAttendanceByService({ user, query: { service_id: id }, supabase: client });
      assert.deepEqual(byService.map((row) => row.resident_id), ['RES-OWN']);
      assert.equal('resident' in byService[0], false, 'existing raw attendance API is preserved');
      const calendar = await healthServices.listScopeAttendance({ user, supabase: client });
      assert.equal(calendar.length, 1);
      assert.equal(calendar[0].resident, 'Scoped Resident');
      assert.ok(!JSON.stringify(calendar).includes('Private'));
      assert.ok(!JSON.stringify(calendar).includes('RES-OTHER'));
    }
  }
});

test('resident-id attendance filters revalidate resident geography before reading attendance', async () => {
  const { client, calls } = makeSupabase({ health_service_attendance: attendance });
  for (const resident of residents.slice(1)) {
    await assert.rejects(healthServices.listAttendanceByResident({ user: supervisor, query: { resident_id: resident.id }, supabase: client }), { statusCode: 404 });
  }
  assert.equal(calls.some((call) => call.table === 'health_service_attendance'), false);
  const own = await healthServices.listAttendanceByResident({ user: supervisor, query: { resident_id: 'RES-OWN' }, supabase: client });
  assert.deepEqual(own.map((row) => row.resident_id), ['RES-OWN']);
});

test('municipal attendance reads retain all same-municipality barangays but reject cross-municipality service/resident links', async () => {
  const { client } = makeSupabase({ health_service_attendance: [
    ...attendance.slice(0, 3), { ...attendance[0], id: uuid(510), service_id: foreignServiceId },
  ] });
  const calendar = await healthServices.listScopeAttendance({ user: phn, supabase: client });
  assert.deepEqual(calendar.map((row) => row.resident_id).sort(), ['RES-OTHER', 'RES-OWN']);
  await assert.rejects(healthServices.listAttendanceByResident({ user: phn, query: { resident_id: 'RES-FOREIGN' }, supabase: client }), { statusCode: 404 });
});

test('registration identities, notes and counts are scoped by current residents, never a forged/stale plan barangay', async () => {
  const { client } = makeSupabase({ visit_plans: [
    plan(701, 'RES-OWN', { barangay_id: otherBarangayId }), plan(702, 'RES-OWN', { status: 'Cancelled' }),
    ...residents.slice(1).map((resident, index) => plan(710 + index, resident.id)),
  ], health_service_attendance: attendance });
  const roster = await healthServices.listServiceRegistrations({ user: supervisor, serviceId, supabase: client });
  assert.deepEqual(roster.registrations.map((row) => row.residentId), ['RES-OWN', 'RES-OWN']);
  assert.equal(roster.counts.registered, 1);
  assert.equal(roster.counts.cancelled, 1);
  assert.ok(!JSON.stringify(roster).includes('RES-OTHER'));
  const catalog = await healthServices.list({ user: supervisor, supabase: client });
  assert.equal(catalog.find((row) => row.id === serviceId).registrationCount, 1);
});

test('missing actor/resident municipality or required barangay scope fails closed for reads and attendance writes', async () => {
  const fixture = makeSupabase({ health_service_attendance: attendance, visit_plans: [plan(701, 'RES-OWN')] });
  const noBarangay = { ...supervisor, barangayId: null };
  const noMunicipality = { ...phn, municipalityId: null };
  assert.deepEqual(await healthServices.listScopeAttendance({ user: noBarangay, supabase: fixture.client }), []);
  assert.deepEqual(await healthServices.listScopeAttendance({ user: noMunicipality, supabase: fixture.client }), []);
  assert.deepEqual(await healthServices.listAttendanceByService({ user: noBarangay, query: { service_id: serviceId }, supabase: fixture.client }), []);
  assert.deepEqual((await healthServices.listServiceRegistrations({ user: noBarangay, serviceId, supabase: fixture.client })).registrations, []);
  await assert.rejects(healthServices.getById({ user: noMunicipality, id: serviceId, supabase: fixture.client }), { statusCode: 404 });
  await assert.rejects(healthServices.listAttendanceByResident({ user: noBarangay, query: { resident_id: 'RES-OWN' }, supabase: fixture.client }), { statusCode: 404 });
  for (const residentId of ['RES-OTHER', 'RES-FOREIGN', 'RES-NO-MUNICIPALITY', 'RES-NO-BARANGAY']) {
    await assert.rejects(healthServices.createHealthServiceAttendance({ user: supervisor, payload: {
      service_id: bhsServiceId, resident_id: residentId, scheduled_date: '2026-11-07', status: 'scheduled',
    }, supabase: fixture.client }), { statusCode: 404 });
  }
  assert.deepEqual(fixture.writes(), []);
});

test('attendance updates cannot mutate or return an out-of-scope resident behind a manageable service', async () => {
  const fixture = makeSupabase({ health_service_attendance: [{ ...attendance[1], service_id: bhsServiceId }] });
  await assert.rejects(healthServices.updateHealthServiceAttendance({ user: supervisor, params: { id: attendance[1].id },
    payload: { status: 'attended', notes: 'Unauthorized change' }, supabase: fixture.client }), { statusCode: 404 });
  assert.deepEqual(fixture.writes(), []);
});

test('resident filters precede pagination and full rosters/counts are not truncated at the database page cap', async () => {
  const ownPlans = Array.from({ length: 1205 }, (_, index) => plan(2000 + index, 'RES-OWN'));
  const otherPlans = Array.from({ length: 800 }, (_, index) => plan(4000 + index, 'RES-OTHER'));
  const fixture = makeSupabase({ visit_plans: [...otherPlans, ...ownPlans], health_service_attendance:
    ownPlans.map((row) => ({ ...attendance[0], id: row.id })) });
  const roster = await healthServices.listServiceRegistrations({ user: supervisor, serviceId, supabase: fixture.client });
  assert.equal(roster.registrations.length, 1205);
  assert.equal(roster.counts.registered, 1205);
  const catalog = await healthServices.list({ user: supervisor, supabase: fixture.client });
  assert.equal(catalog.find((row) => row.id === serviceId).registrationCount, 1205);
  assert.equal((await healthServices.listAttendanceByService({ user: supervisor, query: { service_id: serviceId }, supabase: fixture.client })).length, 1205);
  const pagedResidentReads = fixture.calls.filter((call) => call.range && ['visit_plans', 'health_service_attendance'].includes(call.table)
    && call.select.includes('resident:'));
  assert.ok(pagedResidentReads.some((call) => call.range[0] === 1000));
  for (const call of pagedResidentReads) {
    assert.ok(call.select.includes('residents!inner'));
    assert.ok(call.filters.some((filter) => filter.key === 'resident.municipality_id' && filter.value === municipalityId));
    assert.ok(call.filters.some((filter) => filter.key === 'resident.barangay_id' && filter.value === barangayId));
  }
});

test('resident, personnel, roster, attendance and count lookup errors are not hidden as empty lists or zero counts', async () => {
  const error = { message: 'Lookup unavailable' };
  const cases = [
    ['residents', (supabase) => healthServices.listAttendanceByResident({ user: supervisor, query: { resident_id: 'RES-OWN' }, supabase })],
    ['profiles', (supabase) => healthServices.assign({ user: supervisor, serviceId: bhsServiceId, personnelId, supabase })],
    ['visit_plans', (supabase) => healthServices.listServiceRegistrations({ user: supervisor, serviceId, supabase })],
    ['visit_plans', (supabase) => healthServices.list({ user: supervisor, supabase })],
    ['health_service_attendance', (supabase) => healthServices.listScopeAttendance({ user: supervisor, supabase })],
  ];
  for (const [table, run] of cases) {
    const fixture = makeSupabase({}, (query) => query.table === table ? error : null);
    await assert.rejects(run(fixture.client), { statusCode: 500 });
    assert.deepEqual(fixture.writes(), []);
  }
});
