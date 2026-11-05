-- Household profiling visit history with household-scoped sequential numbers.
-- Existing quarterly dates are copied into chronological history; blank or
-- malformed dates are intentionally not converted into fabricated visits.

begin;

create table if not exists public.household_visits (
  id uuid primary key default gen_random_uuid(),
  household_id text not null references public.households(id) on delete cascade,
  visit_number integer not null check (visit_number > 0),
  visit_date date not null,
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_by_name text not null default '',
  status text,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  constraint household_visits_number_unique unique (household_id, visit_number),
  constraint household_visits_request_unique unique (household_id, request_id)
);

create index if not exists household_visits_household_date_idx
  on public.household_visits (household_id, visit_date desc, visit_number desc);

alter table public.household_visits enable row level security;

create policy household_visits_select on public.household_visits
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and exists (
        select 1
        from public.households h
        where h.id = household_visits.household_id
          and (
            (public.profile_role() in ('bhw', 'health_supervisor') and h.barangay_id = public.profile_barangay_id())
            or (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and h.municipality_id = public.profile_municipality_id())
          )
      )
    )
  );

-- Import existing q1..q4 dates where they are valid ISO dates. Ordering ties
-- are stable by quarter key; existing source dates are retained unchanged.
create or replace function public._household_visit_date_or_null(p_value text)
returns date
language plpgsql
immutable
as $$
begin
  if p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  return p_value::date;
exception when others then
  return null;
end;
$$;

with legacy as (
  select h.id as household_id, v.key as source_key, v.value as source_date
  from public.households h
  cross join lateral jsonb_each_text(
    case when jsonb_typeof(h.quarter_visits) = 'object' then h.quarter_visits else '{}'::jsonb end
  ) v
  where v.key in ('q1', 'q2', 'q3', 'q4')
    and v.value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
), parsed as (
  select household_id, source_key, source_date,
    public._household_visit_date_or_null(source_date) as visit_date
  from legacy
  where public._household_visit_date_or_null(source_date) is not null
), numbered as (
  select household_id, source_key, visit_date,
    row_number() over (partition by household_id order by visit_date, source_key)::integer as visit_number
  from parsed
)
insert into public.household_visits (
  household_id, visit_number, visit_date, recorded_by_name, request_id
)
select household_id, visit_number, visit_date, '', gen_random_uuid()
from numbered
on conflict (household_id, visit_number) do nothing;

drop function public._household_visit_date_or_null(text);

create or replace function public.record_household_visit(
  p_household_id text,
  p_visit_date date,
  p_recorded_by uuid,
  p_recorded_by_name text,
  p_request_id uuid
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
  if p_household_id is null or p_visit_date is null or p_request_id is null then
    raise exception 'Household, visit date, and request id are required';
  end if;

  -- Serializes concurrent BHW submissions for this household. The unique
  -- constraint remains the final integrity backstop.
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
    household_id, visit_number, visit_date, recorded_by, recorded_by_name, request_id
  ) values (
    p_household_id, v_next, p_visit_date, p_recorded_by, coalesce(p_recorded_by_name, ''), p_request_id
  ) returning * into v_visit;

  return v_visit;
end;
$$;

revoke all on function public.record_household_visit(text, date, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.record_household_visit(text, date, uuid, text, uuid) to service_role;

-- Make PostgREST see the new RPC immediately after the migration is applied.
notify pgrst, 'reload schema';

commit;
