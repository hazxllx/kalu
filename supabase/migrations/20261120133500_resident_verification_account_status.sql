begin;

create function public.sync_resident_verification_account_status()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.auth_user_id is not null and new.verification_status is distinct from old.verification_status then
    update public.profiles
      set status = case when status = 'disabled' then 'disabled'
        when new.verification_status = 'approved' then 'active' else 'pending_verification' end,
        role = case when new.verification_status = 'approved' then 'resident'::public.app_role else role end,
        updated_at = now()
      where id = new.auth_user_id and role in ('resident', 'resident-limited');
  end if;
  return new;
end;
$$;

create trigger resident_verification_account_status
  after update of verification_status on public.residents
  for each row execute function public.sync_resident_verification_account_status();

revoke all on function public.sync_resident_verification_account_status() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
