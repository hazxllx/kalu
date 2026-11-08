import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import repository from '../src/repositories/index.js';
import { updateResident, parseResidentPrecondition } from '../src/services/residents.service.js';
import { updateResident as updateController } from '../src/controllers/residents.controller.js';

const originalGet = repository.getResident;
const originalUpdate = repository.updateResident;
afterEach(() => { repository.getResident = originalGet; repository.updateResident = originalUpdate; });

const user = { id: 'test-phn', role: 'phn', municipalityId: 'municipality-a' };
const record = () => ({
  id: 'test-resident', municipalityId: 'municipality-a', barangay: 'San Isidro',
  cellphoneNo: '', currentAddress: 'Original address', permanentAddress: '', revision: 3,
  updatedAt: '2026-11-05T09:00:00.123456+00:00',
});

test('resident If-Match accepts integer tokens and existing timestamp drafts, never wildcard/invalid versions', () => {
  assert.deepEqual(parseResidentPrecondition('3'), { expectedRevision: 3 });
  assert.deepEqual(parseResidentPrecondition('W/"3"'), { expectedRevision: 3 });
  assert.deepEqual(parseResidentPrecondition('"2026-11-05T09:00:00.123456+00:00"'), { expectedUpdatedAt: '2026-11-05T09:00:00.123456+00:00' });
  for (const input of ['', '*', '0', '-1', '3.5', '2147483648', 'revision-3', '2026-11-05']) {
    assert.throws(() => parseResidentPrecondition(input), { statusCode: 400 });
  }
});

test('HTTP resident updates require a version before calling persistence', async () => {
  let writes = 0;
  repository.updateResident = async () => { writes += 1; };
  await assert.rejects(updateController({ get: () => null, params: { id: 'test-resident' }, body: {}, user }, {}), { statusCode: 428, code: 'REVISION_REQUIRED' });
  assert.equal(writes, 0);
});

test('resident update passes an integer comparison and does not trust client revision or protected fields', async () => {
  repository.getResident = async () => record();
  let written;
  repository.updateResident = async (id, patch, options) => {
    written = { id, patch, options };
    return { ...record(), ...patch, revision: 4 };
  };
  const result = await updateResident({ id: 'test-resident', user, expectedRevision: 3, patch: { currentAddress: 'New address', revision: 99, authUserId: 'someone-else' } });
  assert.equal(result.revision, 4);
  assert.deepEqual(written.options, { expectedRevision: 3, expectedUpdatedAt: null });
  assert.equal(written.patch.currentAddress, 'New address');
  assert.equal('revision' in written.patch, false);
  assert.equal('authUserId' in written.patch, false);
});

test('a writer racing a resident edit returns STALE_REVISION and preserves the newer row', async () => {
  let current = record();
  repository.getResident = async () => ({ ...current });
  repository.updateResident = async () => { current = { ...current, revision: 4, currentAddress: 'Concurrent address' }; return null; };
  await assert.rejects(updateResident({ id: current.id, user, expectedRevision: 3, patch: { currentAddress: 'Stale address' } }), (error) => {
    assert.equal(error.code, 'STALE_REVISION');
    assert.equal(error.statusCode, 409);
    assert.deepEqual(error.details, { currentRevision: 4 });
    return true;
  });
  assert.equal(current.currentAddress, 'Concurrent address');
});

test('resident revision tokens cannot bypass the existing municipality authorization guard', async () => {
  repository.getResident = async () => ({ ...record(), municipalityId: 'municipality-b' });
  let writes = 0;
  repository.updateResident = async () => { writes += 1; };
  await assert.rejects(updateResident({ id: 'test-resident', user, expectedRevision: 3, patch: {} }), { statusCode: 404 });
  assert.equal(writes, 0);
});

test('barangay-scoped staff cannot edit a same-named barangay in another municipality', async () => {
  repository.getResident = async () => ({ ...record(), municipalityId: 'municipality-b', barangayId: 'barangay-b' });
  let writes = 0;
  repository.updateResident = async () => { writes += 1; };
  await assert.rejects(updateResident({ id: 'test-resident', user: { ...user, role: 'health_supervisor', barangay: 'San Isidro', barangayId: 'barangay-a' }, expectedRevision: 3, patch: {} }), { statusCode: 404 });
  assert.equal(writes, 0);
});

test('legacy resident timestamps remain compared atomically alongside the fetched integer version', async () => {
  repository.getResident = async () => record();
  let options;
  repository.updateResident = async (_id, patch, value) => { options = value; return { ...record(), ...patch, revision: 4 }; };
  await updateResident({ id: 'test-resident', user, expectedUpdatedAt: record().updatedAt, patch: {} });
  assert.deepEqual(options, { expectedRevision: 3, expectedUpdatedAt: record().updatedAt });
});

test('PostgreSQL resident revisions increment for all writers; stale SQL CAS and migration replay preserve data', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.residents (id text primary key, current_address text, revision integer not null default 1, updated_at timestamptz default now());
      alter table public.residents enable row level security;
      create policy test_resident_scope on public.residents for select using (true);
      insert into public.residents(id,current_address,revision) values ('historical', 'Preserved', 5);
    `);
    const sql = await readFile(new URL('../../supabase/migrations/20261106040000_resident_revision_concurrency.sql', import.meta.url), 'utf8');
    await pg.exec(sql);
    await pg.exec(sql);
    assert.deepEqual((await pg.query('select id,current_address,revision from residents where id = $1', ['historical'])).rows, [{ id: 'historical', current_address: 'Preserved', revision: 5 }]);
    const insert = await pg.query("insert into residents(id,current_address,revision) values ('new', 'Initial', 100) returning revision");
    assert.equal(insert.rows[0].revision, 1);
    const first = await pg.query("update residents set current_address='Accepted' where id='new' and revision=1 returning revision");
    assert.equal(first.rows[0].revision, 2);
    const stale = await pg.query("update residents set current_address='Stale' where id='new' and revision=1 returning revision");
    assert.equal(stale.rows.length, 0);
    const direct = await pg.query("update residents set revision=100 where id='new' returning revision,current_address");
    assert.deepEqual(direct.rows, [{ revision: 3, current_address: 'Accepted' }]);
    assert.equal((await pg.query("select count(*)::int as count from pg_policies where tablename='residents' and policyname='test_resident_scope'")).rows[0].count, 1);
    assert.equal((await pg.query("select has_function_privilege('authenticated','public.increment_resident_revision()','EXECUTE') as allowed")).rows[0].allowed, false);
  } finally {
    await pg.close();
  }
});
