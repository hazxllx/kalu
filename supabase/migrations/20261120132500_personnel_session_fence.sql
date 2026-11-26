-- supabase/migrations/20261120132500_personnel_session_fence.sql
begin;

alter table public.personnel_accounts
  add column credential_valid_after bigint not null default 0;

update public.personnel_accounts
  set credential_valid_after = floor(extract(epoch from password_changed_at))::bigint + 1
  where password_changed_at is not null and not must_change_password and not setup_required;

-- Auth session revocation alone does not invalidate JWTs used by PostgREST.
create function public.fence_completed_personnel_credentials()
returns trigger language plpgsql set search_path = public
as $$
begin
  if (old.must_change_password or old.setup_required)
    and not new.must_change_password and not new.setup_required then
    new.credential_valid_after := greatest(old.credential_valid_after,
      floor(extract(epoch from clock_timestamp()))::bigint + 1);
  end if;
  return new;
end;
$$;

create trigger personnel_completed_credentials_fence
  before update of must_change_password, setup_required on public.personnel_accounts
  for each row execute function public.fence_completed_personnel_credentials();

create or replace function public.personnel_session_is_usable()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((select
    case when p.role in ('resident', 'resident-limited') then p.status in ('active', 'pending_verification')
    else p.status = 'active' and (a.account_id is null or
      (a.approval_status = 'approved' and not a.setup_required
        and not a.must_change_password and a.suspended_at is null
        and (a.temporary_password_expires_at is null or a.temporary_password_expires_at > now())
        and (a.credential_valid_after = 0 or coalesce(
          case
            when (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'iat') ~ '^[0-9]{1,12}$'
            then (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'iat')::bigint >= a.credential_valid_after
            else false
          end, false)))) end
    from public.profiles p left join public.personnel_accounts a on a.account_id = p.id
    where p.id = auth.uid()), false);
$$;

revoke all on function public.fence_completed_personnel_credentials() from public, anon, authenticated;
revoke all on function public.personnel_session_is_usable() from public, anon;
grant execute on function public.personnel_session_is_usable() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
