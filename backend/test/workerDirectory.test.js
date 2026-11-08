import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { listHouseholdWorkers, resolveHouseholdWorker } from '../src/services/households.service.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const bhw = { id: id(901), role: 'bhw', municipalityId: 'm1', barangayId: 'b1' };
const phn = { id: id(902), role: 'phn', municipalityId: 'm1' };
const worker = (n, fields = {}) => ({ id: id(n), full_name: 'Shared Worker Name', role: 'bhw', municipality_id: 'm1', barangay_id: 'b1', status: 'active', ...fields });

const client = (profiles, { error = null } = {}) => {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      let range = null;
      const builder = {
        select(value) { calls.push({ table, select: value }); return builder; },
        eq(field, value) { filters.push((row) => row[field] === value); return builder; },
        in(field, values) { filters.push((row) => values.includes(row[field])); return builder; },
        order() { return builder; },
        range(start, end) { range = [start, end]; calls.push({ table, range }); return builder; },
        maybeSingle() { return builder.then((result) => ({ ...result, data: result.data[0] || null })); },
        then(resolve, reject) {
          const source = table === 'profiles' ? profiles : [{ id: 'b1', municipality_id: 'm1' }, { id: 'b2', municipality_id: 'm1' }, { id: 'b3', municipality_id: 'm2' }];
          const matched = source.filter((row) => filters.every((filter) => filter(row)));
          const data = range ? matched.slice(range[0], range[1] + 1) : matched;
          return Promise.resolve({ data, error }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
};

test('BHW directory contains only scoped active worker identities, never account/contact fields', async () => {
  const supabase = client([
    worker(1), worker(2), worker(3, { barangay_id: 'b2' }), worker(4, { municipality_id: 'm2' }),
    worker(5, { status: 'disabled' }), worker(6, { role: 'resident' }), worker(7, { role: 'admin' }),
    worker(8, { role: 'phn', barangay_id: null }),
  ]);
  const rows = await listHouseholdWorkers({ user: bhw, supabase });
  assert.deepEqual(rows.map((row) => row.id), [id(1), id(2), id(8)]);
  rows.forEach((row) => assert.deepEqual(Object.keys(row).sort(), ['barangayId', 'id', 'name', 'role']));
  assert.equal(rows[0].name, rows[1].name, 'duplicate display names remain independent stable identities');
  assert.ok(!supabase.calls.some((call) => /email|contact|license|password/.test(call.select || '')));
});

test('missing or disabled assignment never broadens directory scope', async () => {
  for (const user of [{ ...bhw, barangayId: null }, { ...phn, municipalityId: null }]) {
    const supabase = client([worker(1)]);
    assert.deepEqual(await listHouseholdWorkers({ user, supabase }), []);
    assert.equal(supabase.calls.length, 0);
  }
  await assert.rejects(listHouseholdWorkers({ user: { ...bhw, role: 'resident' }, supabase: client([]) }), { statusCode: 403 });
  await assert.rejects(listHouseholdWorkers({ user: null, supabase: client([]) }), { statusCode: 401 });
});

test('explicit barangay selection is checked against actor scope and municipality', async () => {
  await assert.rejects(listHouseholdWorkers({ user: bhw, barangayId: 'b2', supabase: client([]) }), { statusCode: 403 });
  await assert.rejects(listHouseholdWorkers({ user: phn, barangayId: 'b3', supabase: client([]) }), { statusCode: 404 });
  const rows = await listHouseholdWorkers({ user: phn, barangayId: 'b2', supabase: client([worker(1), worker(2, { barangay_id: 'b2' })]) });
  assert.deepEqual(rows.map((row) => row.id), [id(2)]);
});

test('directory pages all authorized identities and deduplicates IDs, not names', async () => {
  const roster = Array.from({ length: 205 }, (_, n) => worker(n + 1));
  const supabase = client([...roster, roster[0]]);
  const rows = await listHouseholdWorkers({ user: phn, supabase });
  assert.equal(rows.length, 205);
  assert.deepEqual(supabase.calls.filter((call) => call.range).map((call) => call.range), [[0, 199], [200, 399]]);
});

test('server assignment resolver rejects fabricated names and stale/cross-scope IDs', async () => {
  const supabase = client([worker(1), worker(2, { status: 'disabled' }), worker(3, { barangay_id: 'b2' }), worker(4, { municipality_id: 'm2' })]);
  assert.equal((await resolveHouseholdWorker({ user: bhw, workerId: id(1), supabase })).id, id(1));
  for (const workerId of ['Shared Worker Name', id(2), id(3), id(4), id(999)]) {
    await assert.rejects(resolveHouseholdWorker({ user: bhw, workerId, supabase }), { statusCode: 422 });
  }
});

test('directory source failures are errors, not fabricated empty results', async () => {
  await assert.rejects(listHouseholdWorkers({ user: bhw, supabase: client([], { error: { message: 'database unavailable' } }) }), /Could not load the worker directory/);
});

test('municipal writers cannot assign a worker to a target without a recorded barangay', async () => {
  const supabase = client([worker(1)]);
  await assert.rejects(resolveHouseholdWorker({ user: phn, workerId: id(1), supabase }), { statusCode: 422 });
  assert.equal(supabase.calls.length, 0);
  assert.equal((await resolveHouseholdWorker({ user: phn, barangayId: 'b1', workerId: id(1), supabase })).id, id(1));
});

test('worker route remains authenticated, permission-gated and before dynamic household IDs', async () => {
  const source = await readFile(new URL('../src/routes/households.routes.js', import.meta.url), 'utf8');
  assert.ok(source.includes('router.use(authenticate, resolveBarangayScope)'));
  assert.match(source, /'\/workers',\s*authorize\(HOUSEHOLD_ROLES, \{ anyPermission: \['households.view', 'households.create', 'followups.edit'\] \}\)/);
  assert.ok(source.indexOf("'/workers'") < source.indexOf("'/:id'"));
  assert.doesNotMatch(source, /\/users/);
});
