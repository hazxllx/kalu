-- Smart Blood Pressure classification configuration + Medicine catalog.
--
-- Adds three capabilities to the existing consultation workflow WITHOUT
-- renaming or dropping any existing column:
--
--   1. public.visits gains structured, non-lossy storage for prescribed
--      medications, the recorded blood-pressure classification snapshot, and
--      the previously-dropped "referral required" flag.
--   2. public.bp_threshold_settings — a single authoritative, admin-editable
--      row of the numeric cut-offs used to classify a blood-pressure reading.
--      When absent the backend falls back to documented default reference
--      values (config/bpThresholds.js); it is NEVER a clinical diagnosis.
--   3. public.medicines — an admin-managed generic-first medicine catalog
--      (seeded with the 21 PhilHealth YAKAP medicines plus common primary-care
--      items) and public.medicine_facility_availability for per-facility
--      stock/availability, kept separate from medicine selection.
--
-- Writes to the configuration + catalog are admin-only (RLS + service guard)
-- and audited in health_audit_logs. Reads are available to active staff so the
-- consultation form can search the catalog and classify readings. Existing
-- consultation records remain intact: a deactivated catalog entry never alters
-- a medication already recorded on a visit (medications are stored by value).

begin;

-- ---------------------------------------------------------------------------
-- 1. Structured consultation fields (additive; existing records keep working)
-- ---------------------------------------------------------------------------
alter table public.visits
  add column if not exists medications jsonb not null default '[]'::jsonb,
  add column if not exists bp_classification jsonb,
  add column if not exists referral_required boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Configurable blood-pressure thresholds (single authoritative row)
--
-- The classification ALGORITHM (precedence Crisis > Stage 2 > Stage 1 > Low >
-- Elevated > Normal, "more severe applicable category wins") is fixed and safe;
-- the admin configures the numeric cut-offs below. Check constraints prevent
-- overlapping / contradictory configurations.
-- ---------------------------------------------------------------------------
create table if not exists public.bp_threshold_settings (
  id boolean primary key default true check (id),
  low_systolic_max integer not null default 89 check (low_systolic_max > 0),
  low_diastolic_max integer not null default 59 check (low_diastolic_max > 0),
  elevated_systolic_min integer not null default 120 check (elevated_systolic_min > 0),
  stage1_systolic_min integer not null default 130,
  stage1_diastolic_min integer not null default 80,
  stage2_systolic_min integer not null default 140,
  stage2_diastolic_min integer not null default 90,
  crisis_systolic_min integer not null default 181,
  crisis_diastolic_min integer not null default 121,
  labels jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  -- Ordering guards: each successive category boundary must be higher than the
  -- previous so categories can never overlap or contradict each other.
  constraint bp_systolic_order check (
    low_systolic_max < elevated_systolic_min
    and elevated_systolic_min < stage1_systolic_min
    and stage1_systolic_min < stage2_systolic_min
    and stage2_systolic_min < crisis_systolic_min
  ),
  constraint bp_diastolic_order check (
    low_diastolic_max < stage1_diastolic_min
    and stage1_diastolic_min < stage2_diastolic_min
    and stage2_diastolic_min < crisis_diastolic_min
  )
);

drop trigger if exists bp_threshold_settings_set_updated_at on public.bp_threshold_settings;
create trigger bp_threshold_settings_set_updated_at
  before update on public.bp_threshold_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Medicine catalog (generic-name first)
-- ---------------------------------------------------------------------------
create table if not exists public.medicines (
  id uuid primary key default gen_random_uuid(),
  generic_name text not null,
  brand_name text not null default '',
  strength text not null default '',
  dosage_form text not null default '',
  category text not null default '',
  -- 'yakap' = PhilHealth Advisory 2026-0007 YAKAP list; 'local' = facility /
  -- locally configured catalog (NOT a guaranteed PhilHealth benefit).
  source text not null default 'local' check (source in ('yakap', 'local')),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prevent duplicates on the clinically-identifying triple
-- (generic name + strength + dosage form), case-insensitive.
create unique index if not exists medicines_identity_uidx
  on public.medicines (lower(generic_name), lower(strength), lower(dosage_form));

create index if not exists medicines_generic_name_idx on public.medicines (lower(generic_name));
create index if not exists medicines_active_idx on public.medicines (active);
create index if not exists medicines_source_idx on public.medicines (source);

drop trigger if exists medicines_set_updated_at on public.medicines;
create trigger medicines_set_updated_at
  before update on public.medicines
  for each row execute function public.set_updated_at();

-- Per-facility availability, kept SEPARATE from medicine selection: a medicine
-- can be prescribed even where a facility has not flagged local stock.
create table if not exists public.medicine_facility_availability (
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  available boolean not null default true,
  note text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (medicine_id, facility_id)
);

create index if not exists medicine_availability_facility_idx
  on public.medicine_facility_availability (facility_id);

drop trigger if exists medicine_availability_set_updated_at on public.medicine_facility_availability;
create trigger medicine_availability_set_updated_at
  before update on public.medicine_facility_availability
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--   read:  admin OR active staff (consultation form search + admin editor)
--   write: System Administrator only
-- The Express API performs trusted reads/writes with the service-role key; the
-- policies below bound any direct end-user token access.
-- ---------------------------------------------------------------------------
alter table public.bp_threshold_settings enable row level security;
alter table public.medicines enable row level security;
alter table public.medicine_facility_availability enable row level security;

drop policy if exists bp_threshold_settings_select on public.bp_threshold_settings;
create policy bp_threshold_settings_select on public.bp_threshold_settings
  for select to authenticated
  using (public.is_admin() or public.is_staff_active());

drop policy if exists bp_threshold_settings_write on public.bp_threshold_settings;
create policy bp_threshold_settings_write on public.bp_threshold_settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists medicines_select on public.medicines;
create policy medicines_select on public.medicines
  for select to authenticated
  using (public.is_admin() or public.is_staff_active());

drop policy if exists medicines_write on public.medicines;
create policy medicines_write on public.medicines
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists medicine_availability_select on public.medicine_facility_availability;
create policy medicine_availability_select on public.medicine_facility_availability
  for select to authenticated
  using (public.is_admin() or public.is_staff_active());

drop policy if exists medicine_availability_write on public.medicine_facility_availability;
create policy medicine_availability_write on public.medicine_facility_availability
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Seed defaults (idempotent)
-- ---------------------------------------------------------------------------
insert into public.bp_threshold_settings (id) values (true)
on conflict (id) do nothing;

-- 21 PhilHealth Advisory 2026-0007 (YAKAP) medicines + common primary-care /
-- supplement items used in barangay health stations and municipal RHUs. The
-- 'local' entries are NOT a guaranteed PhilHealth benefit.
insert into public.medicines (generic_name, brand_name, strength, dosage_form, category, source)
values
  ('Amoxicillin', '', '500 mg', 'Capsule', 'Antibiotic', 'yakap'),
  ('Co-amoxiclav', '', '625 mg', 'Tablet', 'Antibiotic', 'yakap'),
  ('Cotrimoxazole', '', '800/160 mg', 'Tablet', 'Antibiotic', 'yakap'),
  ('Nitrofurantoin', '', '100 mg', 'Capsule', 'Antibiotic', 'yakap'),
  ('Ciprofloxacin', '', '500 mg', 'Tablet', 'Antibiotic', 'yakap'),
  ('Clarithromycin', '', '500 mg', 'Tablet', 'Antibiotic', 'yakap'),
  ('Oral Rehydration Salts (ORS)', '', '', 'Sachet', 'Electrolyte', 'yakap'),
  ('Prednisone', '', '20 mg', 'Tablet', 'Corticosteroid', 'yakap'),
  ('Salbutamol', '', '2 mg', 'Tablet', 'Bronchodilator', 'yakap'),
  ('Fluticasone + Salmeterol', '', '250/25 mcg', 'Inhaler', 'Respiratory', 'yakap'),
  ('Paracetamol', '', '500 mg', 'Tablet', 'Analgesic / Antipyretic', 'yakap'),
  ('Gliclazide', '', '80 mg', 'Tablet', 'Antidiabetic', 'yakap'),
  ('Metformin', '', '500 mg', 'Tablet', 'Antidiabetic', 'yakap'),
  ('Simvastatin', '', '20 mg', 'Tablet', 'Statin', 'yakap'),
  ('Enalapril', '', '10 mg', 'Tablet', 'Antihypertensive', 'yakap'),
  ('Metoprolol', '', '50 mg', 'Tablet', 'Antihypertensive', 'yakap'),
  ('Amlodipine', '', '5 mg', 'Tablet', 'Antihypertensive', 'yakap'),
  ('Hydrochlorothiazide', '', '25 mg', 'Tablet', 'Diuretic', 'yakap'),
  ('Losartan', '', '50 mg', 'Tablet', 'Antihypertensive', 'yakap'),
  ('Aspirin', '', '80 mg', 'Tablet', 'Antiplatelet', 'yakap'),
  ('Chlorphenamine', '', '4 mg', 'Tablet', 'Antihistamine', 'yakap'),
  ('Zinc Sulfate', '', '20 mg', 'Tablet', 'Supplement', 'local'),
  ('Ferrous Sulfate + Folic Acid', '', '', 'Tablet', 'Supplement', 'local'),
  ('Vitamin A', '', '200,000 IU', 'Capsule', 'Supplement', 'local'),
  ('Multivitamins', '', '', 'Syrup', 'Supplement', 'local')
on conflict do nothing;

commit;
