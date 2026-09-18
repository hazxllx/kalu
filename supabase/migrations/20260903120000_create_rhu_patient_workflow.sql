-- =============================================================================
-- KALUSAGAP — RHU patient workflow schema
--
-- Adds the resident -> BHW/RHU personnel -> PHN submission lifecycle:
--   residents  master patient profile (paper: RHU Patient Information)
--   visits     one row per intake/consultation; carries the submission status,
--              vitals (BMI recomputed server-side) and PHN processing fields
--   referrals  RHU referral documents with frozen patient/visit snapshots
--   record_counters  human-readable RES-/SUB-/REF- identifier allocation
--
-- RLS is enabled on every health table. The KALUSAGAP API talks to this
-- database through the service-role client AFTER its own authenticate +
-- authorize middleware has run, so application RBAC is enforced in the API
-- layer; these policies are the database-level defense for direct access.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.jwt_role()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      auth.jwt() -> 'app_metadata' ->> 'role',
      auth.jwt() ->> 'role'
    ),
    ''
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Identifier counter: atomically increments and returns the new value.
create or replace function public.increment_counter(counter_name text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_value integer;
begin
  insert into public.record_counters (name, value)
  values (counter_name, 1)
  on conflict (name) do update set value = public.record_counters.value + 1
  returning public.record_counters.value into next_value;
  return next_value;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.record_counters (
  name text primary key,
  value integer not null default 0
);

insert into public.record_counters (name, value) values
  ('residents', 0),
  ('submissions', 0),
  ('referrals', 0);

create table public.residents (
  id text primary key,
  health_record_no text not null unique,
  last_name text not null,
  first_name text not null,
  middle_name text not null default '',
  suffix text not null default '',
  birth_date date,
  birth_place text not null default '',
  sex text not null default '' check (sex in ('', 'Female', 'Male', 'Other')),
  civil_status text not null default '',
  religion text not null default '',
  employment_status text not null default '',
  father_name text not null default '',
  mother_name text not null default '',
  is_4ps_member boolean not null default false,
  philhealth_no text not null default '',
  current_address text not null default '',
  permanent_address text not null default '',
  cellphone_no text not null default '',
  identity_no text not null default '',
  barangay text not null default '',
  created_by_id text not null default '',
  created_by_role text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.visits (
  id text primary key,
  resident_id text not null references public.residents(id) on delete restrict,
  recorded_by_id text not null,
  recorded_by_role text not null,
  recorded_by_name text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'received', 'in_review', 'referred', 'completed')),
  visit_date timestamptz,
  chief_complaint text not null default '',
  clinical_history text not null default '',
  findings text not null default '',
  treatment_given text not null default '',
  recommendation text not null default '',
  bp text not null default '',
  hr numeric,
  rr numeric,
  o2sat numeric,
  temperature numeric,
  height_cm numeric,
  weight_kg numeric,
  bmi numeric,
  bmi_category text not null default '',
  phn_assessment text not null default '',
  phn_notes text not null default '',
  submitted_at timestamptz,
  received_at timestamptz,
  reviewed_at timestamptz,
  referred_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index visits_resident_id_idx on public.visits(resident_id);
create index visits_status_idx on public.visits(status);
create index visits_recorded_by_idx on public.visits(recorded_by_id);

create table public.referrals (
  id text primary key,
  resident_id text not null references public.residents(id) on delete restrict,
  visit_id text not null references public.visits(id) on delete restrict,
  constraint referrals_visit_id_unique unique (visit_id),
  status text not null default 'referred',
  referring_facility text not null default '',
  referring_facility_address text not null default '',
  referring_personnel text not null default '',
  referring_contact text not null default '',
  receiving_facility text not null default '',
  receiving_facility_address text not null default '',
  receiving_personnel text not null default '',
  referral_date timestamptz not null default now(),
  appointment_date date,
  appointment_time text not null default '',
  reason_for_referral text not null default '',
  working_impression text not null default '',
  referral_category text not null default '',
  outpatient_service text not null default '',
  patient_snapshot jsonb not null default '{}'::jsonb,
  visit_snapshot jsonb not null default '{}'::jsonb,
  created_by_id text not null default '',
  created_by_role text not null default '',
  created_by_name text not null default '',
  printed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index referrals_resident_id_idx on public.referrals(resident_id);
create index referrals_visit_id_idx on public.referrals(visit_id);

create trigger residents_set_updated_at before update on public.residents
  for each row execute function public.set_updated_at();
create trigger visits_set_updated_at before update on public.visits
  for each row execute function public.set_updated_at();
create trigger referrals_set_updated_at before update on public.referrals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.residents enable row level security;
alter table public.visits enable row level security;
alter table public.referrals enable row level security;
alter table public.record_counters enable row level security;

-- record_counters is manipulated only through the security-definer
-- increment_counter() function used by the API; no direct policies.
grant execute on function public.increment_counter(text) to anon, authenticated, service_role;

-- residents
create policy residents_select_staff on public.residents
  for select to authenticated
  using (
    public.jwt_role() in ('mho', 'health_supervisor', 'phn', 'rhu_personnel', 'bhw')
  );

create policy residents_insert_staff on public.residents
  for insert to authenticated
  with check (
    public.jwt_role() in ('health_supervisor', 'phn', 'rhu_personnel', 'bhw')
  );

create policy residents_update_staff on public.residents
  for update to authenticated
  using (
    public.jwt_role() in ('phn', 'health_supervisor')
  );

-- visits
create policy visits_select on public.visits
  for select to authenticated
  using (
    public.jwt_role() in ('mho', 'phn')
    or (
      public.jwt_role() in ('bhw', 'rhu_personnel', 'health_supervisor')
      and recorded_by_id = auth.uid()::text
    )
    or (
      public.jwt_role() = 'health_supervisor'
      and status <> 'draft'
    )
  );

create policy visits_insert on public.visits
  for insert to authenticated
  with check (
    public.jwt_role() in ('bhw', 'rhu_personnel', 'health_supervisor', 'phn')
  );

create policy visits_update_phn on public.visits
  for update to authenticated
  using (
    public.jwt_role() = 'phn' and status <> 'draft'
  );

create policy visits_update_owner_draft on public.visits
  for update to authenticated
  using (
    public.jwt_role() in ('bhw', 'rhu_personnel', 'health_supervisor')
    and recorded_by_id = auth.uid()::text
    and status = 'draft'
  );

-- referrals
create policy referrals_select_staff on public.referrals
  for select to authenticated
  using (
    public.jwt_role() in ('mho', 'health_supervisor', 'phn', 'rhu_personnel')
  );

create policy referrals_insert_phn on public.referrals
  for insert to authenticated
  with check (public.jwt_role() = 'phn');

create policy referrals_update_phn on public.referrals
  for update to authenticated
  using (public.jwt_role() = 'phn');

commit;
