-- supabase/migrations/20261126000000_bhw_profile_first_name.sql
begin;

alter table public.profiles
  add column first_name text not null default '',
  add constraint profiles_first_name_length check (char_length(first_name) <= 80);

create function public.update_bhw_profile_first_name(
  p_target_id uuid,
  p_actor_id uuid,
  p_first_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_before jsonb;
  v_first_name text := btrim(coalesce(p_first_name, ''));
begin
  perform pg_advisory_xact_lock(734920184);
  select * into v_profile from public.profiles where id = p_target_id for update;
  if not found or v_profile.role <> 'bhw' then
    raise exception using errcode = 'P0002', message = 'BHW profile not found.';
  end if;
  if char_length(v_first_name) > 80 then
    raise exception using errcode = '22023', message = 'BHW first name must be at most 80 characters.';
  end if;

  if exists (
    select 1 from public.profiles where id = p_actor_id and role = 'admin' and status = 'active'
  ) then
    perform public.personnel_assert_admin(p_actor_id, '{}'::text[]);
  else
    perform public.personnel_assert_delegated_scope(
      p_actor_id, v_profile.role::text, v_profile.municipality_id, v_profile.barangay_id, v_profile.facility_id
    );
  end if;

  if v_profile.first_name is distinct from v_first_name then
    v_before := public.personnel_profile_json(p_target_id);
    perform set_config('app.admin_account_rpc', 'true', true);
    update public.profiles set first_name = v_first_name, updated_at = now() where id = p_target_id;
    update public.personnel_accounts
      set updated_by = p_actor_id, updated_at = now(), version = version + 1
      where account_id = p_target_id;
    if not found then
      raise exception using errcode = '23514', message = 'BHW profile has no personnel account record.';
    end if;
    perform public.personnel_audit(
      p_target_id, p_actor_id, 'ACCOUNT_PROFILE_UPDATED', v_before,
      public.personnel_profile_json(p_target_id)
    );
  end if;

  return public.personnel_profile_json(p_target_id);
end;
$$;

revoke all on function public.update_bhw_profile_first_name(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.update_bhw_profile_first_name(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
