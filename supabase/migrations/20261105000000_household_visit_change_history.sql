begin;

alter table public.household_visits
  add column if not exists visit_reason text not null default 'Follow-up',
  add column if not exists updated_sections text[] not null default '{}',
  add column if not exists profile_snapshot jsonb;

update public.household_visits
set visit_reason = case when visit_number = 1 then 'Initial Profiling' else 'Follow-up' end
where visit_reason = 'Follow-up';

drop function if exists public.record_household_visit(text, date, uuid, text, uuid);

create function public.record_household_visit(
  p_household_id text,
  p_visit_date date,
  p_recorded_by uuid,
  p_recorded_by_name text,
  p_request_id uuid,
  p_visit_reason text,
  p_updated_sections text[],
  p_profile_snapshot jsonb
)
returns public.household_visits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit public.household_visits;
  v_next integer;
begin
  if p_household_id is null or p_visit_date is null or p_request_id is null
     or nullif(trim(p_visit_reason), '') is null then
    raise exception 'Household, visit date, reason, and request id are required';
  end if;

  perform 1 from public.households where id = p_household_id for update;
  if not found then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;

  select * into v_visit
  from public.household_visits
  where household_id = p_household_id and request_id = p_request_id;
  if found then return v_visit; end if;

  select coalesce(max(visit_number), 0) + 1 into v_next
  from public.household_visits where household_id = p_household_id;

  insert into public.household_visits (
    household_id, visit_number, visit_date, recorded_by, recorded_by_name,
    request_id, visit_reason, updated_sections, profile_snapshot
  ) values (
    p_household_id, v_next, p_visit_date, p_recorded_by,
    coalesce(p_recorded_by_name, ''), p_request_id,
    trim(p_visit_reason), coalesce(p_updated_sections, '{}'), p_profile_snapshot
  ) returning * into v_visit;

  return v_visit;
end;
$$;

revoke all on function public.record_household_visit(text, date, uuid, text, uuid, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.record_household_visit(text, date, uuid, text, uuid, text, text[], jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
