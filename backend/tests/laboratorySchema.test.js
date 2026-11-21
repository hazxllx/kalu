import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Apply the repository migrations in local PostgreSQL with synthetic identities only.
const database = new PGlite({ extensions: { pgcrypto } });
const migrations = new URL('../../supabase/migrations/', import.meta.url);
const candidate = '20261120200000_resident_laboratory_documents.sql';
const RESIDENT_A = '11111111-1111-4111-8111-111111111111';
const RESIDENT_B = '22222222-2222-4222-8222-222222222222';
const SUPERVISOR = '33333333-3333-4333-8333-333333333333';
const PHN = '44444444-4444-4444-8444-444444444444';
const DISABLED_PHN = '55555555-5555-4555-8555-555555555555';
const RESIDENT_C = '66666666-6666-4666-8666-666666666666';
const DOC_A = '10000000-0000-4000-8000-000000000001';
const DOC_B = '20000000-0000-4000-8000-000000000002';
const DOC_C = '30000000-0000-4000-8000-000000000003';
const PATH_A = `LAB-RESIDENT-A/${DOC_A}.pdf`;
const query = async (sql, params = []) => (await database.query(sql, params)).rows;
let municipalityA;
let barangayA;

before(async () => {
  await database.exec(`
    create schema auth; create schema storage;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb not null default '{}',raw_app_meta_data jsonb not null default '{}',email_confirmed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid);
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
    alter table storage.objects enable row level security;
    select set_config('request.jwt.claim.role','service_role',false);
  `);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith('.sql') && name < candidate).sort()) {
    try { await database.exec(await readFile(new URL(file, migrations), 'utf8')); }
    catch (error) { throw new Error(`Laboratory baseline ${file}: ${error.message}`, { cause: error }); }
  }

  const municipality = async (name) => (await query('select id from public.municipalities where name=$1', [name]))[0]?.id
    || (await query('insert into public.municipalities(name) values ($1) returning id', [name]))[0].id;
  municipalityA = await municipality('Pili');
  const municipalityB = await municipality('Other Municipality');
  const barangay = async (municipalityId, name) => (await query('select id from public.barangays where municipality_id=$1 and name=$2', [municipalityId, name]))[0]?.id
    || (await query('insert into public.barangays(municipality_id,name) values ($1,$2) returning id', [municipalityId, name]))[0].id;
  barangayA = await barangay(municipalityA, 'San Antonio');
  const barangayB = await barangay(municipalityA, 'San Isidro');
  const barangayC = await barangay(municipalityB, 'San Antonio');
  const accounts = [
    [RESIDENT_A, 'resident', municipalityA, barangayA, 'active'],
    [RESIDENT_B, 'resident', municipalityA, barangayB, 'active'],
    [SUPERVISOR, 'health_supervisor', municipalityA, barangayA, 'active'],
    [PHN, 'phn', municipalityA, null, 'active'],
    [DISABLED_PHN, 'phn', municipalityA, null, 'disabled'],
    [RESIDENT_C, 'resident', municipalityB, barangayC, 'active'],
  ];
  for (const [id, role, municipalityId, barangayId, status] of accounts) {
    await query('insert into auth.users(id,email) values ($1,$2)', [id, `${id}@example.test`]);
    await query("update public.profiles set role=$2,status=$3,municipality_id=$4,barangay_id=$5 where id=$1",
      [id, role, status, municipalityId, barangayId]);
  }
  for (const [id, name, scope, owner] of [
    ['LAB-RESIDENT-A', 'Resident A', barangayA, RESIDENT_A], ['LAB-RESIDENT-B', 'Resident B', barangayB, RESIDENT_B],
    ['LAB-RESIDENT-C', 'Resident C', barangayC, RESIDENT_C],
  ]) {
    await query("insert into public.residents(id,health_record_no,first_name,last_name,barangay_id,auth_user_id,verification_status) values ($1,$2,$3,'Synthetic',$4,$5,'approved')",
      [id, `HR-${id}`, name, scope, owner]);
  }
  await query("insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,status,chief_complaint,findings,treatment_given) values ('LAB-VISIT-A','LAB-RESIDENT-A',$1,'phn','completed','Synthetic complaint','Synthetic finding','Synthetic treatment'),('LAB-VISIT-B','LAB-RESIDENT-B',$2,'phn','completed','Synthetic complaint','Synthetic finding','Synthetic treatment')", [PHN, PHN]);
  await query(`insert into public.role_permissions(role,permission_id,granted) values
    ('phn','consultation.history.view',true),('phn','consultation.records.update',true),
    ('health_supervisor','consultation.history.view',true),('health_supervisor','consultation.records.update',true)
    on conflict (role,permission_id) do update set granted=excluded.granted`);
  await database.exec(await readFile(new URL(candidate, migrations), 'utf8'));
  await asRole('service_role', '', async () => {
    await upload('LAB-RESIDENT-A', RESIDENT_A, DOC_A);
    await upload('LAB-RESIDENT-B', RESIDENT_B, DOC_B);
    await upload('LAB-RESIDENT-C', RESIDENT_C, DOC_C);
    await query("insert into storage.objects(bucket_id,name,owner) values ('resident-laboratory',$1,$2)", [PATH_A, RESIDENT_A]);
  });
}, { timeout: 120000 });

after(async () => { await database.close(); });

async function asRole(role, id, callback) {
  await query(`set role ${role}`);
  await query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [id, role]);
  try { return await callback(); }
  finally {
    await query('reset role');
    await query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false)");
  }
}

async function upload(residentId, uploader, id, overrides = {}) {
  const { consultationId = null, category = 'cbc', fileName = 'result.pdf', contentType = 'application/pdf',
    size = 1024, path = `${residentId}/${id}.pdf` } = overrides;
  return query(`insert into public.resident_laboratory_documents
    (id,resident_id,consultation_id,category,file_name,content_type,size_bytes,storage_path,uploaded_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
  [id, residentId, consultationId, category, fileName, contentType, size, path, uploader]);
}

test('migration creates constrained metadata, scoped indexes, and a private bucket', async () => {
  const foreignKeys = await query(`select pg_get_constraintdef(oid) as definition from pg_constraint
    where conrelid='public.resident_laboratory_documents'::regclass and contype='f' order by definition`);
  assert.deepEqual(foreignKeys.map(({ definition }) => definition), [
    'FOREIGN KEY (consultation_id) REFERENCES visits(id) ON DELETE RESTRICT',
    'FOREIGN KEY (resident_id) REFERENCES residents(id) ON DELETE RESTRICT',
    'FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE SET NULL',
  ]);
  const indexes = await query("select indexname,indexdef from pg_indexes where schemaname='public' and tablename='resident_laboratory_documents'");
  assert.match(indexes.find((index) => index.indexname === 'resident_laboratory_history_idx').indexdef, /\(resident_id, uploaded_at DESC, id\)/);
  assert.match(indexes.find((index) => index.indexname === 'resident_laboratory_consultation_idx').indexdef, /\(consultation_id\) WHERE \(consultation_id IS NOT NULL\)/);
  assert.ok(indexes.some(({ indexdef }) => /CREATE UNIQUE INDEX .* \(storage_path\)/.test(indexdef)));
  assert.deepEqual((await query("select public from storage.buckets where id='resident-laboratory'"))[0], { public: false });
  for (const overrides of [{ category: 'invalid' }, { fileName: '' }, { contentType: 'text/plain' }, { size: 10485761 },
    { size: 0 }, { fileName: 'x'.repeat(256) },
    { path: 'LAB-RESIDENT-A/not-the-row.pdf' }, { path: 'LAB-RESIDENT-A/00000000-0000-4000-8000-000000000001.png' }]) {
    await assert.rejects(upload('LAB-RESIDENT-A', RESIDENT_A, '00000000-0000-4000-8000-000000000001', overrides), { code: '23514' });
  }
  await assert.rejects(upload('LAB-RESIDENT-A', RESIDENT_B, '00000000-0000-4000-8000-000000000001'), /uploader must own/i);
});

const rowsFor = (id) => asRole('authenticated', id, async () =>
  (await query('select resident_id from public.resident_laboratory_documents order by resident_id')).map((row) => row.resident_id));

test('residents, supervisors, and PHNs read only their permitted laboratory scope', async () => {
  assert.deepEqual(await rowsFor(RESIDENT_A), ['LAB-RESIDENT-A']);
  assert.deepEqual(await rowsFor(RESIDENT_B), ['LAB-RESIDENT-B']);
  assert.deepEqual(await rowsFor(SUPERVISOR), ['LAB-RESIDENT-A']);
  assert.deepEqual(await rowsFor(PHN), ['LAB-RESIDENT-A', 'LAB-RESIDENT-B']);
});

test('disabled and permission-revoked staff have no laboratory reads', async () => {
  assert.deepEqual(await rowsFor(DISABLED_PHN), []);
  await query("update public.role_permissions set granted=false where role='phn' and permission_id='consultation.history.view'");
  try { assert.deepEqual(await rowsFor(PHN), []); }
  finally { await query("update public.role_permissions set granted=true where role='phn' and permission_id='consultation.history.view'"); }
});

test('supervisor access follows the resident current barangay assignment', async () => {
  const [{ barangay_id: otherBarangay }] = await query("select barangay_id from public.residents where id='LAB-RESIDENT-B'");
  await query("update public.residents set barangay_id=$1,barangay='San Isidro' where id='LAB-RESIDENT-A'", [otherBarangay]);
  try {
    assert.deepEqual(await rowsFor(SUPERVISOR), []);
    assert.deepEqual(await rowsFor(RESIDENT_A), ['LAB-RESIDENT-A']);
    assert.deepEqual(await rowsFor(PHN), ['LAB-RESIDENT-A', 'LAB-RESIDENT-B']);
  } finally {
    await query("update public.residents set barangay_id=$1,barangay='San Antonio' where id='LAB-RESIDENT-A'", [barangayA]);
  }
});

test('browser roles cannot insert or delete laboratory metadata', async () => {
  for (const actor of [RESIDENT_A, PHN]) {
    await asRole('authenticated', actor, async () => {
      await assert.rejects(upload('LAB-RESIDENT-A', RESIDENT_A, '00000000-0000-4000-8000-000000000001'), { code: '42501' });
      await assert.rejects(query('delete from public.resident_laboratory_documents where id=$1', [DOC_A]), { code: '42501' });
    });
  }
});

test('metadata is immutable and consultation links must reference the same resident', async () => {
  const link = (document, visit, actor) => query('select consultation_id from public.link_resident_laboratory_document($1,$2,$3)', [document, visit, actor]);
  await asRole('authenticated', PHN, async () => {
    await assert.rejects(link(DOC_A, 'LAB-VISIT-A', PHN), { code: '42501' });
    await assert.rejects(query("update public.resident_laboratory_documents set consultation_id='LAB-VISIT-A' where id=$1", [DOC_A]), { code: '42501' });
  });
  await asRole('service_role', '', async () => {
    await assert.rejects(query("update public.resident_laboratory_documents set file_name='changed.pdf' where id=$1", [DOC_A]), /history is immutable/i);
    await assert.rejects(query("update public.resident_laboratory_documents set consultation_id='LAB-VISIT-B' where id=$1", [DOC_A]), /same resident/i);
    await assert.rejects(link(DOC_B, 'LAB-VISIT-B', SUPERVISOR), { code: '42501' });
    await assert.rejects(link(DOC_A, 'LAB-VISIT-B', PHN), { code: '23514' });
    assert.deepEqual(await link(DOC_A, 'LAB-VISIT-A', PHN), [{ consultation_id: 'LAB-VISIT-A' }]);
    assert.deepEqual(await link(DOC_A, 'LAB-VISIT-A', PHN), [{ consultation_id: 'LAB-VISIT-A' }]);
    await assert.rejects(query('update public.resident_laboratory_documents set consultation_id=null where id=$1', [DOC_A]), /history cannot be replaced/i);
  });
  const audit = await query(`select action,actor_id,municipality_id,barangay_id,metadata from public.health_audit_logs
    where entity_type='resident_laboratory_documents' and entity_id=$1 order by action`, [DOC_A]);
  assert.deepEqual(audit, [
    { action: 'LABORATORY_CONSULTATION_LINKED', actor_id: PHN, municipality_id: municipalityA, barangay_id: barangayA,
      metadata: { consultation_id: 'LAB-VISIT-A' } },
    { action: 'LABORATORY_UPLOADED', actor_id: RESIDENT_A, municipality_id: municipalityA, barangay_id: barangayA,
      metadata: { consultation_id: null, verified_clinical_finding: false } },
  ]);
});

test('storage metadata for a known object is not accessible to browser roles', async () => {
  const object = () => query("select name from storage.objects where bucket_id='resident-laboratory' and name=$1", [PATH_A]);
  assert.deepEqual(await asRole('service_role', '', object), [{ name: PATH_A }]);
  assert.deepEqual(await asRole('authenticated', RESIDENT_A, object), []);
  assert.deepEqual(await asRole('authenticated', PHN, object), []);
  assert.deepEqual(await asRole('anon', '', object), []);
});
