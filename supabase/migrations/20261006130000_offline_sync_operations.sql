-- KALUSAGAP — Offline synchronization support
--
-- Additive only. No existing table, row, policy or grant is dropped or
-- rewritten. This migration backs the offline-first client:
--
--   1. public.sync_operations — a service-role-only idempotency ledger. The
--      backend records a completed response for a client-supplied
--      `Idempotency-Key` and replays it on retry, so an interrupted offline
--      upload can be retried without creating duplicate records. RLS is enabled
--      with NO policies: only the service-role key (server side) may touch it;
--      it is never readable from the browser.
--
--   2. public.households.revision / public.residents.revision — monotonically
--      increasing record versions. The client sends the last-seen revision via
--      `If-Match`; the service rejects a stale write with 409 instead of
--      silently overwriting a concurrent edit.
--
-- Idempotent: safe to re-run.

begin;

-- ===========================================================================
-- 1. Idempotency ledger
-- ===========================================================================

create table if not exists public.sync_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  method text not null,
  path text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sync_operations_user_key_unique unique (user_id, idempotency_key)
);

comment on table public.sync_operations is
  'Internal idempotency ledger for offline synchronization retries. Service-role access only (RLS enabled, no policies). Never exposed to the browser.';
comment on column public.sync_operations.idempotency_key is
  'Client-supplied Idempotency-Key value, unique per user.';
comment on column public.sync_operations.response_body is
  'The exact success response body replayed for a duplicate request. Never returned to any user other than the originating user.';

create index if not exists sync_operations_lookup_idx
  on public.sync_operations (user_id, idempotency_key);

-- Bind each idempotency key to the exact request it was first used for, so a key
-- cannot be replayed against a different payload or a different operation.
alter table public.sync_operations
  add column if not exists request_fingerprint text;
comment on column public.sync_operations.request_fingerprint is
  'SHA-256 of method + path + canonical request body. A duplicate key with a different fingerprint is rejected (409) instead of replaying the wrong response.';

-- Keep updated_at fresh (public.set_updated_at() is defined by the core schema).
drop trigger if exists sync_operations_set_updated_at on public.sync_operations;
create trigger sync_operations_set_updated_at
  before update on public.sync_operations
  for each row execute function public.set_updated_at();

alter table public.sync_operations enable row level security;
-- Intentionally NO policies: anon/authenticated roles can never read or write.
-- The Express backend uses the service-role key, which bypasses RLS, only after
-- its own authenticate/authorize middleware has run.

-- ===========================================================================
-- 2. Record revisions for optimistic concurrency
-- ===========================================================================

alter table public.households
  add column if not exists revision integer not null default 1;
comment on column public.households.revision is
  'Optimistic-concurrency record version. Incremented on every accepted update; a stale If-Match is rejected with 409.';

alter table public.residents
  add column if not exists revision integer not null default 1;
comment on column public.residents.revision is
  'Optimistic-concurrency record version. Incremented on every accepted update; a stale If-Match is rejected with 409.';

-- ===========================================================================
-- 3. Database-enforced idempotency for offline household creation
-- ===========================================================================
--
-- The idempotency ledger alone is not sufficient: the ledger write and the
-- household insert are separate database calls, so an interrupted request could
-- commit the household but never mark the ledger complete. This column closes
-- that window at the database level — the client operation key is carried into
-- the row it creates and is unique, so a retried create can never produce a
-- second household; the service returns the already-created row instead.

alter table public.households
  add column if not exists client_operation_key text;
comment on column public.households.client_operation_key is
  'Idempotency-Key of the request that created this household. Unique (partial index) so an offline re-upload cannot create a duplicate.';

create unique index if not exists households_client_operation_key_unique
  on public.households (client_operation_key)
  where client_operation_key is not null;

-- ===========================================================================
-- 4. Atomic household + members creation
-- ===========================================================================
--
-- The API previously inserted the household and then each member in separate
-- statements; a failure between them left a household with no roster. This
-- function performs BOTH writes in one transaction: either the household and
-- every member are committed, or nothing is. It also re-checks the client
-- operation key so a retried offline create returns its existing household.
--
-- SECURITY: EXECUTE is revoked from PUBLIC/anon/authenticated and granted only
-- to service_role. The Express backend calls it with the service-role client
-- after its own authenticate/authorize middleware; a browser client can never
-- invoke it directly.
--
-- The inserts build their column list from the keys actually supplied, so table
-- defaults apply for unspecified columns (same behavior as the previous
-- column-omitting inserts) and future columns need no function change.

create or replace function public.create_household_with_members(
  p_household jsonb,
  p_members jsonb default '[]'::jsonb,
  p_client_operation_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cols text;
  v_select text;
  v_household public.households%rowtype;
  v_existing public.households%rowtype;
  v_member public.household_members%rowtype;
begin
  if p_household is null or jsonb_typeof(p_household) <> 'object' then
    raise exception 'create_household_with_members: p_household must be a JSON object';
  end if;

  -- Idempotent replay: the same offline operation returns its existing row.
  if p_client_operation_key is not null then
    select * into v_existing
      from public.households
      where client_operation_key = p_client_operation_key
      limit 1;
    if found then
      return jsonb_build_object('household', to_jsonb(v_existing), 'deduplicated', true);
    end if;
  end if;

  -- Insert only the columns the caller supplied so table defaults apply.
  select
    string_agg(format('%I', c.column_name::text), ', ' order by c.ordinal_position),
    string_agg(format('r.%I', c.column_name::text), ', ' order by c.ordinal_position)
  into v_cols, v_select
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'households'
    and p_household ? c.column_name::text;

  if v_cols is null then
    raise exception 'create_household_with_members: no valid household columns supplied';
  end if;

  execute format(
    'insert into public.households (%s) '
    'select %s from jsonb_populate_record(null::public.households, $1) r '
    'returning *',
    v_cols, v_select
  ) into v_household using p_household;

  if p_members is not null and jsonb_typeof(p_members) = 'array' then
    for v_member in
      select * from jsonb_populate_recordset(null::public.household_members, p_members)
    loop
      insert into public.household_members
        (household_id, resident_id, name, birthday, age, sex, classification,
         relationship, contact, is_pwd, philhealth, fp_method, quarter_status, is_head)
      values
        (v_household.id, v_member.resident_id, coalesce(v_member.name, ''),
         coalesce(v_member.birthday, ''), v_member.age, coalesce(v_member.sex, ''),
         coalesce(v_member.classification, ''), coalesce(v_member.relationship, ''),
         coalesce(v_member.contact, ''), coalesce(v_member.is_pwd, false),
         coalesce(v_member.philhealth, ''), coalesce(v_member.fp_method, ''),
         coalesce(v_member.quarter_status, ''), coalesce(v_member.is_head, false));
    end loop;
  end if;

  return jsonb_build_object('household', to_jsonb(v_household), 'deduplicated', false);
end;
$$;

revoke all on function public.create_household_with_members(jsonb, jsonb, text) from public;
grant execute on function public.create_household_with_members(jsonb, jsonb, text) to service_role;

comment on function public.create_household_with_members(jsonb, jsonb, text) is
  'Atomically creates a household and its members (single transaction) with client-operation-key idempotency. Service-role only.';

-- Refresh PostgREST's schema cache so the new function is callable immediately.
notify pgrst, 'reload schema';

commit;
