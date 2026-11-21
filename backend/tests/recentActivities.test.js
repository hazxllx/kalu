import assert from 'node:assert/strict';
import test from 'node:test';
import { getRecentActivities } from '../src/services/recentActivities.service.js';
import { createRecentActivitiesController } from '../src/controllers/recentActivities.controller.js';

const actorId = '00000000-0000-4000-8000-000000000001';
const rowlessRepo = (driver = 'supabase') => new Proxy({ driver }, {
  get(target, key) {
    if (key === 'mode') return undefined;
    if (key in target) return target[key];
    throw new Error(`Unexpected row access: ${String(key)}`);
  },
});
const row = { id: '0123456789abcdef0123456789abcdef', kind: 'visit_created', occurredAt: '2026-11-21T10:00:00.123456+00:00' };

test('service uses only the scoped service-role RPC and passes no client geography, paging or identity overrides', async () => {
  let calls = 0;
  const result = await getRecentActivities({ actorId, barangay: 'San Antonio', municipalityId: 'forged', limit: 100 }, {
    repo: rowlessRepo(), rpc: async (name, params) => {
      calls += 1;
      assert.equal(name, 'scoped_recent_monitoring_activities');
      assert.deepEqual(params, { p_actor_id: actorId, p_barangay: 'San Antonio' });
      return { data: { activities: [row] } };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { activities: [{ ...row, title: 'Visit recorded', description: 'A health visit was recorded.' }] });
});

test('service projects fixed copy and only safe fields, ignoring PII, metadata, record references and links', async () => {
  const result = await getRecentActivities({ actorId }, { repo: rowlessRepo(), rpc: async () => ({ data: {
    name: 'PRIVATE', activities: [{ ...row, title: 'PRIVATE', description: 'PRIVATE', notes: 'PRIVATE',
      metadata: { resident: 'PRIVATE' }, residentId: 'PRIVATE', href: '/PRIVATE', recordReference: 'PRIVATE' },
    { id: row.id, kind: 'referral_status_changed', occurredAt: row.occurredAt, status: 'Completed', actorName: 'PRIVATE' }],
  } }) });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|href|recordReference|actorName|residentId|metadata|notes/);
  assert.deepEqual(Object.keys(result.activities[0]).sort(), ['description', 'id', 'kind', 'occurredAt', 'title']);
  assert.equal(result.activities[1].status, 'Completed');
});

test('missing actor is rejected before either driver; file mode returns a safe empty actual-source feed', async () => {
  const rpc = async () => assert.fail('RPC must not run');
  for (const driver of ['file', 'supabase']) {
    await assert.rejects(() => getRecentActivities({}, { repo: rowlessRepo(driver), rpc }), { statusCode: 401 });
  }
  assert.deepEqual(await getRecentActivities({ actorId }, { repo: rowlessRepo('file'), rpc }), { activities: [] });
});

test('safe SQL-authorized targets use only supported record types and IDs, with no arbitrary href or metadata', async () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const activities = [
    { ...row, kind: 'household_visit_created', target: { type: 'household', id: 'HH-001', name: 'PRIVATE', href: '/PRIVATE' } },
    { ...row, kind: 'follow_up_created', target: { type: 'follow_up', id: uuid, notes: 'PRIVATE' } },
    { ...row, kind: 'referral_created', target: { type: 'referral', id: uuid, href: '/PRIVATE' } },
    { ...row, kind: 'assessment_form_created' }, { ...row, kind: 'record_updated' },
  ];
  const result = await getRecentActivities({ actorId }, { repo: rowlessRepo(), rpc: async () => ({ data: { activities } }) });
  assert.deepEqual(result.activities.slice(0, 3).map((event) => event.target), [
    { type: 'household', id: 'HH-001' }, { type: 'follow_up', id: uuid }, { type: 'referral', id: uuid },
  ]);
  assert.equal(result.activities[3].title, 'Health assessment form recorded');
  assert.equal(result.activities[4].title, 'Health record updated');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|href|notes|name/);
  for (const event of [
    { ...row, target: { type: 'household', id: 'HH-001' } },
    { ...row, kind: 'follow_up_created', target: { type: 'referral', id: uuid } },
    { ...row, kind: 'household_visit_created', target: { type: 'household', id: '../PRIVATE' } },
    { ...row, kind: 'referral_created', target: { type: 'referral', id: 'PRIVATE' } },
    { ...row, kind: 'household_verified' },
  ]) {
    await assert.rejects(() => getRecentActivities({ actorId }, {
      repo: rowlessRepo(), rpc: async () => ({ data: { activities: [event] } }),
    }), { statusCode: 503 });
  }
});

test('unknown drivers never fall back to file reads; errors and malformed responses fail closed without SQL details', async () => {
  for (const driver of ['supabase', 'unknown']) {
    for (const data of [null, {}, [], { activities: null }, { activities: Array(6).fill(row) },
      { activities: [{ ...row, kind: 'PRIVATE' }] }, { activities: [{ ...row, status: 'PRIVATE' }] },
      { activities: [{ ...row, kind: {} }] }, { activities: [{ ...row, id: 'PRIVATE RECORD ID' }] },
      { activities: [{ ...row, occurredAt: 'bad date' }] }, { activities: [null] }]) {
      await assert.rejects(() => getRecentActivities({ actorId }, {
        repo: rowlessRepo(driver), rpc: async () => ({ data }),
      }), { statusCode: 503 });
    }
  }
  for (const [code, statusCode] of [['42501', 403], ['22023', 422], ['PGRST202', 503], ['42P01', 503]]) {
    await assert.rejects(() => getRecentActivities({ actorId }, {
      repo: rowlessRepo(), rpc: async () => ({ error: { code, message: 'PRIVATE SQL DETAIL' } }),
    }), (error) => error.statusCode === statusCode && !error.message.includes('PRIVATE'));
  }
  await assert.rejects(() => getRecentActivities({ actorId }, {
    repo: rowlessRepo(), rpc: async () => { throw new Error('PRIVATE transport detail'); },
  }), { statusCode: 503 });
});

test('controller binds verified actor and resolved assignment, returns standard envelope and ignores other query overrides', async () => {
  const calls = [];
  const controller = createRecentActivitiesController({ service: { getRecentActivities: async (scope) => {
    calls.push(scope); return { activities: [] };
  } } });
  const response = { set(name, value) { assert.equal(name, 'Cache-Control'); assert.equal(value, 'private, no-store'); return this; },
    status(code) { assert.equal(code, 200); return this; }, json(body) {
    assert.deepEqual(body, { data: { activities: [] } });
  } };
  await controller.getRecentActivities({ user: { id: actorId }, assignedBarangay: 'San Antonio',
    query: { actorId: 'forged', municipalityId: 'forged', barangay: 'San Isidro', limit: '100' } }, response);
  await controller.getRecentActivities({ user: { id: actorId }, query: { barangay: ' San Isidro ' } }, response);
  await controller.getRecentActivities({ user: { id: actorId }, query: {} }, response);
  assert.deepEqual(calls, [{ actorId, barangay: 'San Antonio' }, { actorId, barangay: 'San Isidro' }, { actorId, barangay: null }]);
  for (const barangay of ['Unknown', ['San Antonio'], {}]) {
    await assert.rejects(() => controller.getRecentActivities({ user: { id: actorId }, query: { barangay } }, response), { statusCode: 422 });
  }
});
