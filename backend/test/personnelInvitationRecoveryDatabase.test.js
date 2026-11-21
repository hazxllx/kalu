import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
const migrationUrl = new URL('../../supabase/migrations/20261120132000_personnel_invitation_recovery.sql', import.meta.url);
const fenceMigrationUrl = new URL('../../supabase/migrations/20261120132500_personnel_session_fence.sql', import.meta.url);
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const rpc = async (name, params) => {
  const args = params.map((_, index) => `$${index + 1}`).join(',');
  return (await query(`select public.${name}(${args}) as result`, params))[0].result;
};
const serviceRpc = async (name, params) => {
  await db.exec('set role service_role');
  try { return await rpc(name, params); } finally { await db.exec('reset role'); }
};
const id = () => randomUUID();
const tokenDigest = 'a'.repeat(64);
const passwordDigest = 'b'.repeat(64);

const account = async ({ activationRequested = true, suspendedAt = null, temporaryExpiresAt = '2020-01-01T00:00:00.000Z' } = {}) => {
  const accountId = id();
  const notificationId = id();
  const claimToken = id();
  await query("insert into public.profiles(id,status) values ($1,'disabled')", [accountId]);
  await query(`insert into public.personnel_accounts(
    account_id,approval_status,activation_requested,setup_required,setup_completed_at,
    must_change_password,temporary_password_expires_at,suspended_at,updated_at,version
  ) values ($1,'approved',$2,true,null,true,$4,$3,now(),1)`, [accountId, activationRequested, suspendedAt, temporaryExpiresAt]);
  await query(`insert into public.personnel_notification_outbox(id,account_id,event_type,status,claim_token,next_attempt_at,claimed_at)
    values ($1,$2,'invitation','processing',$3,now(),now())`, [notificationId, accountId, claimToken]);
  return { accountId, notificationId, claimToken };
};

before(async () => {
  await db.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.profiles(id uuid primary key, status text not null, role text not null default 'rhu_personnel');
    create table public.personnel_accounts(
      account_id uuid primary key references public.profiles(id), approval_status text not null,
      activation_requested boolean not null, setup_required boolean not null, setup_completed_at timestamptz,
      must_change_password boolean not null, temporary_password_expires_at timestamptz,
      temporary_password_assigned_by uuid, activation_requested_by uuid, approved_by uuid, created_by uuid,
      suspended_at timestamptz, updated_by uuid, updated_at timestamptz, password_changed_at timestamptz,
      version bigint not null
    );
    create table public.personnel_notification_outbox(
      id uuid primary key, account_id uuid not null, event_type text not null, status text not null,
      claim_token uuid, next_attempt_at timestamptz, claimed_at timestamptz
    );
    create table public.recovery_audit(action text, metadata jsonb);
    grant usage on schema auth to service_role;
    grant all on auth.users, public.profiles, public.personnel_accounts,
      public.personnel_notification_outbox, public.recovery_audit to service_role;
    create function public.personnel_profile_json(p_target_id uuid) returns jsonb language sql stable as $$
      select to_jsonb(p) || jsonb_build_object('personnel_account', to_jsonb(a))
      from public.profiles p join public.personnel_accounts a on a.account_id = p.id where p.id = p_target_id
    $$;
    create function public.personnel_assert_activation_scope(p_target_id uuid) returns void language plpgsql as $$
      begin return; end
    $$;
    create function public.personnel_audit(p_target_id uuid, p_actor_id uuid, p_action text, p_previous jsonb,
      p_new jsonb, p_extra jsonb default '{}'::jsonb) returns void language plpgsql as $$
      begin insert into public.recovery_audit(action,metadata) values (p_action,p_extra); end
    $$;
    create function public.complete_temporary_personnel_password_change(p_target_id uuid) returns jsonb language plpgsql as $$
      declare v_account public.personnel_accounts%rowtype; v_status text;
      begin
        select * into v_account from public.personnel_accounts where account_id = p_target_id;
        v_status := case when v_account.activation_requested then 'active' else 'disabled' end;
        update public.personnel_accounts set must_change_password = false, setup_required = false,
          setup_completed_at = now(), temporary_password_expires_at = null where account_id = p_target_id;
        update public.profiles set status = v_status where id = p_target_id;
        return public.personnel_profile_json(p_target_id);
      end
    $$;
    select set_config('request.jwt.claim.role', 'service_role', false);
  `);
  await db.exec(await readFile(migrationUrl, 'utf8'));
  await db.exec(await readFile(fenceMigrationUrl, 'utf8'));
}, { timeout: 120000 });
after(async () => { await db.close(); });

test('proof registration requires its claimed invitation and a live temporary-password setup', async () => {
  const row = await account();
  assert.equal(await rpc('register_personnel_invitation_recovery', [row.notificationId, row.claimToken, tokenDigest]), true);
  const other = await account();
  assert.equal(await rpc('begin_personnel_invitation_recovery', [other.accountId, tokenDigest, passwordDigest]), null);
  const proof = await query('select * from public.personnel_invitation_recovery_proofs where account_id = $1', [row.accountId]);
  assert.equal(proof[0].notification_id, row.notificationId);
  assert.equal(proof[0].token_digest, tokenDigest);
  assert.equal(Date.parse(proof[0].expires_at) > Date.now(), true);
});

test('invitation send boundary requires an active recovery proof for temporary-password accounts', async () => {
  const row = await account();
  assert.equal(await rpc('begin_personnel_notification_send', [row.notificationId, row.claimToken]), false);
  const cancelled = await query('select status from public.personnel_notification_outbox where id = $1', [row.notificationId]);
  assert.equal(cancelled[0].status, 'cancelled');

  const prepared = await account();
  await rpc('register_personnel_invitation_recovery', [prepared.notificationId, prepared.claimToken, tokenDigest]);
  assert.equal(await rpc('begin_personnel_notification_send', [prepared.notificationId, prepared.claimToken]), true);
  const sending = await query('select status from public.personnel_notification_outbox where id = $1', [prepared.notificationId]);
  assert.equal(sending[0].status, 'sending');
});

test('an in-flight initial temporary-password change cannot race a recovery invitation', async () => {
  const row = await account({ temporaryExpiresAt: '2099-01-01T00:00:00.000Z' });
  const password = 'c'.repeat(64);
  const claimId = await rpc('begin_personnel_temporary_password_change', [row.accountId, password]);
  assert.ok(claimId);
  assert.equal(await rpc('register_personnel_invitation_recovery', [row.notificationId, row.claimToken, tokenDigest]), false);
  assert.equal(await rpc('begin_personnel_temporary_password_change', [row.accountId, password]), claimId);
  assert.equal(await rpc('begin_personnel_temporary_password_change', [row.accountId, 'd'.repeat(64)]), null);
  await query('insert into auth.users(id,email_confirmed_at) values ($1,now())', [row.accountId]);
  const completed = await rpc('complete_claimed_temporary_personnel_password_change', [row.accountId, claimId]);
  assert.equal(completed.personnel_account.must_change_password, false);
  const accountRow = await query('select temporary_password_change_claim_id from public.personnel_accounts where account_id = $1', [row.accountId]);
  assert.equal(accountRow[0].temporary_password_change_claim_id, null);
});

test('setup completion fences old session iat but permits post-cutoff sessions', async () => {
  const row = await account();
  await query('insert into auth.users(id,email_confirmed_at) values ($1,now())', [row.accountId]);
  await rpc('register_personnel_invitation_recovery', [row.notificationId, row.claimToken, tokenDigest]);
  const claimId = await rpc('begin_personnel_invitation_recovery', [row.accountId, tokenDigest, passwordDigest]);
  const completed = await rpc('complete_personnel_invitation_recovery', [row.accountId, tokenDigest, claimId]);
  const cutoff = Number(completed.personnel_account.credential_valid_after);
  await query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)", [
    row.accountId, JSON.stringify({ sub: row.accountId, iat: cutoff - 1 }),
  ]);
  assert.equal((await query('select public.personnel_session_is_usable() as allowed'))[0].allowed, false);
  await query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: row.accountId, iat: cutoff })]);
  assert.equal((await query('select public.personnel_session_is_usable() as allowed'))[0].allowed, true);
});

test('expired and consumed email proofs are denied', async () => {
  const expired = await account();
  await rpc('register_personnel_invitation_recovery', [expired.notificationId, expired.claimToken, tokenDigest]);
  await query('update public.personnel_invitation_recovery_proofs set expires_at = now() - interval \'1 second\' where account_id = $1', [expired.accountId]);
  assert.equal(await rpc('begin_personnel_invitation_recovery', [expired.accountId, tokenDigest, passwordDigest]), null);
  assert.equal(await rpc('begin_personnel_temporary_password_change', [expired.accountId, passwordDigest]), null);

  const consumed = await account({ activationRequested: false });
  await query('insert into auth.users(id,email_confirmed_at) values ($1,now())', [consumed.accountId]);
  await rpc('register_personnel_invitation_recovery', [consumed.notificationId, consumed.claimToken, tokenDigest]);
  const claimId = await rpc('begin_personnel_invitation_recovery', [consumed.accountId, tokenDigest, passwordDigest]);
  assert.ok(claimId);
  const completed = await rpc('complete_personnel_invitation_recovery', [consumed.accountId, tokenDigest, claimId]);
  assert.equal(completed.status, 'disabled');
  assert.equal(completed.personnel_account.activation_requested, false);
  assert.equal(completed.personnel_account.must_change_password, false);
  assert.equal(completed.personnel_account.setup_required, false);
  assert.equal(completed.personnel_account.temporary_password_expires_at, null);
  assert.ok(Number(completed.personnel_account.credential_valid_after) > Math.floor(Date.now() / 1000));
  const proof = await query('select token_digest,consumed_at from public.personnel_invitation_recovery_proofs where account_id = $1', [consumed.accountId]);
  assert.equal(proof[0].token_digest, null);
  assert.ok(proof[0].consumed_at);
  assert.equal(await rpc('begin_personnel_invitation_recovery', [consumed.accountId, tokenDigest, passwordDigest]), null);
  assert.equal((await query(`select action from public.recovery_audit where action = 'ACCOUNT_TEMPORARY_PASSWORD_RECOVERED'
    and metadata->>'recovery_notification_id' = $1`, [consumed.notificationId])).length, 1);
});

test('a rejected Auth password update can release only its matching unconsumed claim', async () => {
  const row = await account();
  await rpc('register_personnel_invitation_recovery', [row.notificationId, row.claimToken, tokenDigest]);
  const claim = await rpc('begin_personnel_invitation_recovery', [row.accountId, tokenDigest, passwordDigest]);
  assert.equal(await rpc('release_personnel_invitation_recovery', [row.accountId, tokenDigest, id()]), false);
  assert.equal(await rpc('release_personnel_invitation_recovery', [row.accountId, tokenDigest, claim]), true);
  assert.ok(await rpc('begin_personnel_invitation_recovery', [row.accountId, tokenDigest, 'c'.repeat(64)]));
});

test('suspension is enforced both before Auth mutation and during finalization', async () => {
  const alreadySuspended = await account({ suspendedAt: new Date().toISOString() });
  await rpc('register_personnel_invitation_recovery', [alreadySuspended.notificationId, alreadySuspended.claimToken, tokenDigest]);
  assert.equal(await rpc('begin_personnel_invitation_recovery', [alreadySuspended.accountId, tokenDigest, passwordDigest]), null);

  const suspendedDuringSetup = await account();
  await query('insert into auth.users(id,email_confirmed_at) values ($1,now())', [suspendedDuringSetup.accountId]);
  await rpc('register_personnel_invitation_recovery', [suspendedDuringSetup.notificationId, suspendedDuringSetup.claimToken, tokenDigest]);
  const claimId = await rpc('begin_personnel_invitation_recovery', [suspendedDuringSetup.accountId, tokenDigest, passwordDigest]);
  await query('update public.personnel_accounts set suspended_at = now() where account_id = $1', [suspendedDuringSetup.accountId]);
  await assert.rejects(() => rpc('complete_personnel_invitation_recovery', [suspendedDuringSetup.accountId, tokenDigest, claimId]));
  const state = await query(`select p.status,a.must_change_password,a.setup_required
    from public.profiles p join public.personnel_accounts a on a.account_id = p.id where p.id = $1`, [suspendedDuringSetup.accountId]);
  assert.deepEqual(state[0], { status: 'disabled', must_change_password: true, setup_required: true });
});

test('definitively failed or cancelled invitations invalidate stored proofs', async () => {
  const row = await account();
  await rpc('register_personnel_invitation_recovery', [row.notificationId, row.claimToken, tokenDigest]);
  await query("update public.personnel_notification_outbox set status = 'failed' where id = $1", [row.notificationId]);
  assert.equal(await rpc('begin_personnel_invitation_recovery', [row.accountId, tokenDigest, passwordDigest]), null);
});

test('recovery RPCs are unavailable to authenticated clients', async () => {
  await db.exec('set role authenticated');
  try {
    await assert.rejects(() => rpc('begin_personnel_invitation_recovery', [id(), tokenDigest, passwordDigest]));
  } finally {
    await db.exec('reset role');
  }
});

test('service_role can register and begin recovery through the granted RPC surface', async () => {
  const row = await account();
  assert.equal(await serviceRpc('register_personnel_invitation_recovery', [row.notificationId, row.claimToken, tokenDigest]), true);
  assert.ok(await serviceRpc('begin_personnel_invitation_recovery', [row.accountId, tokenDigest, passwordDigest]));
});
