-- KALUSAGAP - Environmental Health Masterlist (household sanitation monitoring)
-- Additive only. Integrates the official "Environmental Masterlist" workbook
-- (Part 1 Household & Water Supply, Part 2 Sanitation Facilities, Part 3 Solid
-- Waste Management, Part 4 Complete Sanitation Facilities).
--
-- This is a HOUSEHOLD-level record, not an individual consultation. Each row is
-- an environmental-health assessment of one household in public.households.
-- Scope (municipality_id/barangay_id) is copied from the household so a caller
-- can never target an arbitrary barangay. Derived indicator flags
-- (has_basic_safe_water, has_sanitary_toilet, open_defecation,
-- complete_sanitation, safely_managed_*) are computed server-side from the
-- official dependency rules and stored for reporting; the full faithful field
-- set lives in the validated `data` jsonb payload.

begin;

create table public.environmental_masterlist (
  id uuid primary key default gen_random_uuid(),
  household_id text not null references public.households(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,
  assessment_date date,
  se_status text check (se_status in ('NHTS', 'Non-NHTS')),

  -- Part 1 - Water supply
  water_supply_type text check (water_supply_type in ('level1','level2','level3','others')),
  water_supply_other text not null default '',
  has_basic_safe_water boolean,          -- Col 4: WS is Level I/II/III
  within_premises boolean,                -- Col 5
  available_247 boolean,                  -- Col 6

  -- Part 2 - Sanitation facility
  sanitary_facility_type text check (sanitary_facility_type in ('a','b','c')),      -- 10a/10b/10c
  unsanitary_facility_type text check (unsanitary_facility_type in ('ws_no_tank','overhung','open_pit','none')), -- 11
  has_sanitary_toilet boolean,            -- Col 12
  open_defecation boolean,                -- Col 13

  -- Part 4 derived
  complete_sanitation boolean,            -- Col 20

  data jsonb not null default '{}'::jsonb,
  remarks text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Copy geographic scope from the household (defense in depth beyond RLS).
create or replace function public.sync_household_record_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare h public.households%rowtype;
begin
  select * into h from public.households where id = new.household_id;
  if not found then raise exception 'environmental masterlist: household not found'; end if;
  new.municipality_id := h.municipality_id;
  new.barangay_id := h.barangay_id;
  return new;
end; $$;

create trigger environmental_masterlist_scope before insert or update on public.environmental_masterlist
  for each row execute function public.sync_household_record_scope();
create trigger environmental_masterlist_updated before update on public.environmental_masterlist
  for each row execute function public.set_updated_at();

create index environmental_masterlist_household_idx on public.environmental_masterlist(household_id);
create index environmental_masterlist_scope_idx on public.environmental_masterlist(barangay_id, assessment_date);

alter table public.environmental_masterlist enable row level security;

create policy environmental_masterlist_select on public.environmental_masterlist for select to authenticated using (
  public.is_admin() or (
    public.is_staff_active() and (
      (public.profile_role() in ('mho','phn','rhu_personnel') and municipality_id = public.profile_municipality_id())
      or (public.profile_role() in ('health_supervisor','bhw') and barangay_id = public.profile_barangay_id())
    )
  )
);
create policy environmental_masterlist_insert on public.environmental_masterlist for insert to authenticated with check (
  public.is_staff_active() and (
    (public.profile_role() in ('mho','phn') and municipality_id = public.profile_municipality_id())
    or (public.profile_role() = 'health_supervisor' and public.profile_covers_barangay(barangay_id))
  )
);
create policy environmental_masterlist_update on public.environmental_masterlist for update to authenticated using (
  public.is_admin() or (public.is_staff_active() and (
    (public.profile_role() in ('mho','phn') and municipality_id = public.profile_municipality_id())
    or (public.profile_role() = 'health_supervisor' and public.profile_covers_barangay(barangay_id))
  ))
) with check (
  public.is_admin() or (public.is_staff_active() and (
    (public.profile_role() in ('mho','phn') and municipality_id = public.profile_municipality_id())
    or (public.profile_role() = 'health_supervisor' and public.profile_covers_barangay(barangay_id))
  ))
);

commit;
