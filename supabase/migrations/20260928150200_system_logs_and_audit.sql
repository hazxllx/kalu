-- =============================================================================
-- KALUSAGAP — system log + account audit + RHU referral boundary
--
-- 1. public.system_logs — the TECHNICAL request log (method, path, status,
--    duration, acting role) that System Management → Logs is designed to show.
--    This is deliberately NOT a second copy of the Audit Trail:
--      * Audit Trail  = business events (approvals, record CRUD) -> health_audit_logs
--      * System Log   = request-level runtime events      -> system_logs
--    Bodies, headers, tokens and query strings are never stored, matching the
--    existing backend/src/middleware/requestLogger.js contract.
--
-- 2. public.log_profile_status_change() — records role/status transitions on
--    `profiles` into health_audit_logs, so an account activated or disabled
--    from ANY path (PHN, Health Supervisor, or System Admin maintenance) is
--    real, queryable system activity.
--
-- 3. RHU Personnel is removed from the health_referrals read boundary. The
--    referrals module is not part of the RHU Personnel role, so the database
--    must refuse the rows as well as the API and the UI.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. System (request) log
-- ---------------------------------------------------------------------------
create table if not exists public.system_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  method text not null,
  path text not null,
  status_code integer not null,
  duration_ms numeric(10, 2) not null default 0,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text not null default '',
  request_id text not null default ''
);

comment on table public.system_logs is
  'Technical request log shown by System Management → Logs. Contains no bodies, headers, tokens or query strings.';

create index if not exists system_logs_time_idx on public.system_logs (occurred_at desc);
create index if not exists system_logs_actor_idx on public.system_logs (actor_id, occurred_at desc);
create index if not exists system_logs_path_idx on public.system_logs (path, occurred_at desc);

-- Administrators read the system log. Nobody else may, and nobody may write:
-- the API inserts with the service-role key.
alter table public.system_logs enable row level security;

create policy system_logs_select_admin on public.system_logs
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. Account lifecycle audit
-- ---------------------------------------------------------------------------
create or replace function public.log_profile_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status or new.role is distinct from old.role then
    insert into public.health_audit_logs
      (actor_id, action, entity_type, entity_id, municipality_id, barangay_id, metadata)
    values (
      auth.uid(),
      case
        when new.status = 'active' and old.status = 'pending_verification' then 'ACCOUNT_APPROVED'
        when new.status = 'disabled' then 'ACCOUNT_DISABLED'
        when new.role is distinct from old.role then 'ACCOUNT_ROLE_CHANGED'
        else 'ACCOUNT_STATUS_CHANGED'
      end,
      'profiles',
      new.id::text,
      new.municipality_id,
      new.barangay_id,
      jsonb_build_object(
        'email', new.email,
        'full_name', new.full_name,
        'previous_status', old.status,
        'new_status', new.status,
        'previous_role', old.role::text,
        'new_role', new.role::text
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_status_audit on public.profiles;
create trigger profiles_status_audit
  after update on public.profiles
  for each row execute function public.log_profile_status_change();

-- ---------------------------------------------------------------------------
-- 3. RHU Personnel has no referral access
-- ---------------------------------------------------------------------------
-- The Express route and the UI already refuse the module for this role; the
-- policy is aligned here so a direct PostgREST read with a user token cannot
-- return referral rows either.
drop policy if exists health_referrals_select on public.health_referrals;
create policy health_referrals_select on public.health_referrals
  for select to authenticated
  using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() = 'health_supervisor' and barangay_id = public.profile_barangay_id())
      )
    ) or exists (
      select 1 from public.residents r
      where r.id = health_referrals.resident_id and r.auth_user_id = auth.uid()
    )
  );

-- The service mirrors the same list (backend/src/services/referrals.service.js).
-- Referrals are a Health Supervisor / PHN / MHO function; bhw never had a
-- write path and keeps none.

commit;
