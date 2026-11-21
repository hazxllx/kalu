import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create type public.app_role as enum ('resident','resident-limited','phn');
    create table public.profiles (id uuid primary key, role public.app_role not null, status text not null, updated_at timestamptz);
    create table public.residents (id uuid primary key, auth_user_id uuid, verification_status text not null);
  `);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261120133500_resident_verification_account_status.sql', import.meta.url), 'utf8'));
});
after(async () => { await db?.close(); });

const account = async (role = 'resident', status = 'pending_verification', verification = 'pending') => {
  const id = randomUUID();
  await query('insert into public.profiles(id,role,status) values ($1,$2,$3)', [id, role, status]);
  await query('insert into public.residents values ($1,$1,$2)', [id, verification]);
  return id;
};
const decide = (id, status) => query('update public.residents set verification_status = $2 where id = $1', [id, status]);
const profile = async (id) => (await query('select * from public.profiles where id = $1', [id]))[0];

test('approval atomically activates either resident identity and removes the limited role', async () => {
  for (const role of ['resident', 'resident-limited']) {
    const id = await account(role);
    await decide(id, 'approved');
    assert.equal((await profile(id)).status, 'active');
    assert.equal((await profile(id)).role, 'resident');
  }
});

test('rejection and resubmission retain limited access without enabling administrative disables', async () => {
  for (const status of ['approved', 'rejected', 'resubmission_required']) {
    const disabled = await account('resident', 'disabled');
    await decide(disabled, status);
    assert.equal((await profile(disabled)).status, 'disabled');
    if (status !== 'approved') {
      const id = await account('resident', 'active', 'approved');
      await decide(id, status);
      assert.equal((await profile(id)).status, 'pending_verification');
    }
  }
});

test('a failed account synchronization rolls back the verification decision', async () => {
  const id = await account();
  await db.exec(`create function public.reject_test_profile_update() returns trigger language plpgsql as $$
    begin raise exception 'Profile write unavailable'; end; $$;
    create trigger reject_test_profile_update before update on public.profiles
      for each row execute function public.reject_test_profile_update();`);
  try {
    await assert.rejects(() => decide(id, 'approved'), /Profile write unavailable/);
    assert.equal((await query('select verification_status from public.residents where id = $1', [id]))[0].verification_status, 'pending');
    assert.equal((await profile(id)).status, 'pending_verification');
  } finally {
    await db.exec('drop trigger reject_test_profile_update on public.profiles; drop function public.reject_test_profile_update();');
  }
});

test('linked personnel identities are never activated or converted by resident verification', async () => {
  const id = await account('phn', 'pending_verification');
  await decide(id, 'approved');
  assert.equal((await profile(id)).role, 'phn');
  assert.equal((await profile(id)).status, 'pending_verification');
});

test('approval normalizes a disabled limited resident without restoring account access', async () => {
  const id = await account('resident-limited', 'disabled');
  await decide(id, 'approved');
  assert.equal((await profile(id)).role, 'resident');
  assert.equal((await profile(id)).status, 'disabled');
});
