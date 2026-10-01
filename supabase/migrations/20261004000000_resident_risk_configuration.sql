-- Resident risk assessment configuration + persisted resident risk.
--
-- Establishes a SINGLE authoritative, rule-based source for resident risk:
--   public.risk_criteria   configurable scoring criteria (HEALTH DATA -> SCORE)
--   public.risk_settings    configurable Low/Moderate/High thresholds
--   residents.risk_*        the persisted, server-computed classification
--
-- The backend computes risk from these criteria + thresholds and the resident's
-- recorded vitals; a client-supplied score/level is never stored. Writes to the
-- configuration are admin-only (RLS + service guard) and audited in
-- health_audit_logs; residents are recalculated when the configuration changes.
--
-- The seed criteria faithfully reproduce the system's prior resident risk
-- behavior (systolic >= 140 or SpO2 < 95 => High; systolic 130-139 => Moderate;
-- otherwise Low) as a scored, configurable model. They are NOT new clinical
-- guidelines.

begin;

-- ---------------------------------------------------------------------------
-- Configurable risk criteria
-- ---------------------------------------------------------------------------
create table if not exists public.risk_criteria (
  code text primary key,
  name text not null,
  description text not null default '',
  field text not null,
  operator text not null check (operator in ('gte', 'gt', 'lte', 'lt', 'eq', 'between')),
  value numeric not null,
  value2 numeric,
  weight numeric not null default 0 check (weight >= 0),
  enabled boolean not null default true,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists risk_criteria_enabled_idx on public.risk_criteria(enabled);

drop trigger if exists risk_criteria_set_updated_at on public.risk_criteria;
create trigger risk_criteria_set_updated_at
  before update on public.risk_criteria
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Configurable classification thresholds (single authoritative row)
-- ---------------------------------------------------------------------------
create table if not exists public.risk_settings (
  id boolean primary key default true check (id),
  moderate_min integer not null default 40 check (moderate_min >= 0),
  high_min integer not null default 70 check (high_min > moderate_min),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

drop trigger if exists risk_settings_set_updated_at on public.risk_settings;
create trigger risk_settings_set_updated_at
  before update on public.risk_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Persisted resident risk classification
-- ---------------------------------------------------------------------------
alter table public.residents
  add column if not exists risk_score integer,
  add column if not exists risk_level text check (risk_level is null or risk_level in ('Low', 'Moderate', 'High')),
  add column if not exists risk_factors jsonb not null default '[]'::jsonb,
  add column if not exists risk_assessed_at timestamptz;

create index if not exists residents_risk_level_idx on public.residents(risk_level);

-- ---------------------------------------------------------------------------
-- Row Level Security
--   read:  any active staff member (drives the admin editor + detail labels)
--   write: System Administrator only
-- The Express API performs trusted reads/writes with the service-role key; the
-- policies below are the boundary for any direct end-user token access.
-- ---------------------------------------------------------------------------
alter table public.risk_criteria enable row level security;
alter table public.risk_settings enable row level security;

drop policy if exists risk_criteria_select on public.risk_criteria;
create policy risk_criteria_select on public.risk_criteria
  for select to authenticated
  using (public.is_admin() or public.is_staff_active());

drop policy if exists risk_criteria_write on public.risk_criteria;
create policy risk_criteria_write on public.risk_criteria
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists risk_settings_select on public.risk_settings;
create policy risk_settings_select on public.risk_settings
  for select to authenticated
  using (public.is_admin() or public.is_staff_active());

drop policy if exists risk_settings_write on public.risk_settings;
create policy risk_settings_write on public.risk_settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Seed defaults (idempotent). Reproduces the pre-existing behavior.
-- ---------------------------------------------------------------------------
insert into public.risk_settings (id, moderate_min, high_min)
values (true, 40, 70)
on conflict (id) do nothing;

insert into public.risk_criteria (code, name, description, field, operator, value, value2, weight, enabled, priority)
values
  ('bp_systolic_high', 'High blood pressure', 'Systolic blood pressure of 140 mmHg or higher (recorded vitals).', 'systolic', 'gte', 140, null, 70, true, 10),
  ('o2sat_low', 'Low oxygen saturation', 'Oxygen saturation (SpO2) below 95% (recorded vitals).', 'o2sat', 'lt', 95, null, 70, true, 20),
  ('bp_systolic_elevated', 'Elevated blood pressure', 'Systolic blood pressure between 130 and 139 mmHg (recorded vitals).', 'systolic', 'between', 130, 139, 40, true, 30)
on conflict (code) do nothing;

commit;
