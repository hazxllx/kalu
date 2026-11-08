-- Reserve account ownership without rewriting or selecting a winner among
-- existing duplicate clinical profiles. A real unique key arbitrates new claims
-- even when the older residents unique index could not be installed.
begin;

lock table public.residents in share row exclusive mode;

create table if not exists public.resident_auth_ownership_guard (
  auth_user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.resident_auth_ownership_guard enable row level security;
revoke all on public.resident_auth_ownership_guard from public, anon, authenticated, service_role;

insert into public.resident_auth_ownership_guard (auth_user_id)
select distinct auth_user_id from public.residents where auth_user_id is not null
on conflict (auth_user_id) do nothing;

create or replace function public.guard_resident_account_ownership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and old.auth_user_id is not null then
    if new.auth_user_id is not distinct from old.auth_user_id then return new; end if;
    -- FK SET NULL runs after Auth deletes its parent row. Do not block account
    -- deletion/creation rollback, or allow a two-step unlink/reassign bypass.
    if new.auth_user_id is not null or exists (
      select 1 from auth.users where id = old.auth_user_id
    ) then
      raise exception using errcode = '23514', message = 'Resident account ownership cannot be changed.';
    end if;
  end if;

  if new.auth_user_id is not null then
    begin
      insert into public.resident_auth_ownership_guard (auth_user_id) values (new.auth_user_id);
    exception when unique_violation then
      raise exception using errcode = '23505', message = 'This account already has a resident record.';
    end;
  end if;
  return new;
end;
$$;

create or replace function public.release_deleted_resident_account_ownership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.auth_user_id is not null then
    delete from public.resident_auth_ownership_guard g
     where g.auth_user_id = old.auth_user_id
       and not exists (select 1 from public.residents r where r.auth_user_id = old.auth_user_id);
  end if;
  return null;
end;
$$;

revoke all on function public.guard_resident_account_ownership() from public, anon, authenticated, service_role;
revoke all on function public.release_deleted_resident_account_ownership() from public, anon, authenticated, service_role;

drop trigger if exists residents_account_ownership_guard on public.residents;
create trigger residents_account_ownership_guard
before insert or update of auth_user_id on public.residents
for each row execute function public.guard_resident_account_ownership();

drop trigger if exists residents_release_deleted_account_ownership on public.residents;
create trigger residents_release_deleted_account_ownership
after delete on public.residents
for each row execute function public.release_deleted_resident_account_ownership();

commit;
