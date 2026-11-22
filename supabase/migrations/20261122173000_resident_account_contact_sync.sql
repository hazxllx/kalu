-- Keep a linked resident's contact and account contact in the same transaction.
-- Ownership is never created or changed here, and no existing data is backfilled.
begin;

create function public.sync_resident_account_contact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- A no-op ownership/contact patch must not invalidate grandfathered account links.
  if tg_op = 'UPDATE' and new.auth_user_id is not distinct from old.auth_user_id
    and new.cellphone_no is not distinct from old.cellphone_no then
    return new;
  end if;
  if new.auth_user_id is not null then
    if (select count(*) from public.residents where auth_user_id = new.auth_user_id) > 1 then
      raise exception using errcode = '23505', message = 'Resident account contact requires an unambiguous account link.';
    end if;
    if new.cellphone_no ~ '^09[0-9]{9}$' then
      update public.profiles
        set contact = new.cellphone_no, updated_at = now()
        where id = new.auth_user_id
          and role in ('resident', 'resident-limited')
          and contact is distinct from new.cellphone_no;
    end if;
  end if;
  return new;
end;
$$;

create trigger resident_account_contact_sync
  after insert or update of cellphone_no, auth_user_id on public.residents
  for each row execute function public.sync_resident_account_contact();

revoke all on function public.sync_resident_account_contact() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
