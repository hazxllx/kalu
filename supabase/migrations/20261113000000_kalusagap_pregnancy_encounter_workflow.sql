-- KALUSAGAP Phase 1: Pregnancy Registration & Encounter-Based Workflow
--
-- This migration introduces a smart, encounter-based maternal care management system
-- that separates concerns and reduces repetitive data entry:
--
-- 1. Pregnancy Registration: One-time capture of pregnancy details, obstetric history,
--    pregnancy dating, and clinical baseline.
--
-- 2. Prenatal Encounters: Per-visit clinical recordings (BP, weight, fundal height, etc.)
--    with automatic gestational age calculation based on encounter date.
--
-- 3. Prenatal Services: Per-service documentation (immunization, micronutrient, screening)
--    with automatic due/overdue tracking and duplicate prevention.
--
-- 4. Delivery Record: One-time capture of delivery outcome, birth details, and delivery
--    classification.
--
-- 5. Postpartum Encounters: Per-visit postpartum assessments (separate from delivery record).
--
-- 6. Maternal Care Profile: Consolidated view of pregnancy status, encounters, services,
--    and postpartum follow-ups.
--
-- Schema Design:
-- - maternal_pregnancies: pregnancy case (one per resident per pregnancy)
-- - pregnancy_encounters: prenatal visits (flexible, encounter-driven)
-- - prenatal_services: individual service records (immunization, screening, supplementation)
-- - delivery_records: one delivery per pregnancy
-- - postpartum_encounters: postpartum visits (separate from delivery)
-- - postpartum_follow_ups: auto-generated follow-up schedule milestones
--
-- Migration strategy: ADDITIVE ONLY
-- - Existing maternal_records table remains intact for backward compatibility
-- - New tables are parallel: no data deleted, no existing references broken
-- - M1 reporting will use both tables during transition phase
-- - Health workers can transition gradually from old modal to new workflows

begin;

-- ============================================================================
-- PREGNANCY CASE MANAGEMENT
-- ============================================================================

-- Core pregnancy record: one per resident per active pregnancy
-- Stores pregnancy baseline, dating information, and outcome classification
create table public.maternal_pregnancies (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,

  -- Pregnancy identification & status
  status text not null default 'active' check (status in ('active', 'delivered', 'lost_to_followup', 'transferred', 'terminated')),
  pregnancy_number integer not null default 1, -- gravida equivalent
  parity_before_pregnancy integer not null default 0, -- para at conception
  
  -- Pregnancy dating (from most reliable source)
  lmp_date date,
  lmp_reliability text not null default 'certain' check (lmp_reliability in ('certain', 'uncertain', 'unknown')),
  edd_date date, -- calculated or ultrasound-based
  edd_source text not null default 'lmp' check (edd_source in ('lmp', 'ultrasound', 'clinical', 'manual')),
  pregnancy_dating_method text not null default 'lmp', -- preferred calculation method
  
  -- Obstetric classification
  gravida integer, -- total pregnancies (from resident history or resident input)
  para integer, -- live births before this pregnancy
  
  -- Gestational age tracking (auto-calculated on each encounter)
  current_gestational_age_weeks numeric(5, 2),
  current_gestational_age_calculated_at date,
  
  -- Registration & baseline
  date_of_registration date not null default current_date,
  registered_by uuid references public.profiles(id) on delete set null,
  socio_economic_status text not null default '', -- NHTS, Non-NHTS, Unknown
  
  -- Provider tracking
  primary_provider text not null default '',
  
  -- Pregnancy outcome (recorded when delivery happens)
  outcome text not null default '', check (outcome in ('', 'live_birth', 'stillbirth', 'abortion', 'ectopic', 'molar')),
  outcome_date date,
  outcome_notes text not null default '',
  
  -- Risk stratification (nullable; empty = not assessed)
  risk_level text not null default '', check (risk_level in ('', 'low', 'moderate', 'high', 'very_high')),
  risk_assessment_date date,
  risk_notes text not null default '',
  
  -- Audit & versioning
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

-- Ensure one active pregnancy per resident
create unique index maternal_pregnancies_active_per_resident
  on public.maternal_pregnancies(resident_id)
  where status in ('active', 'lost_to_followup', 'transferred');

create index maternal_pregnancies_resident_idx
  on public.maternal_pregnancies(resident_id, created_at desc);

create index maternal_pregnancies_scope_idx
  on public.maternal_pregnancies(barangay_id, created_at desc);

create index maternal_pregnancies_status_idx
  on public.maternal_pregnancies(status, outcome_date desc);

-- ============================================================================
-- PRENATAL ENCOUNTERS (Per-visit clinical recordings)
-- ============================================================================

-- One record per prenatal visit; non-destructive; encounter-driven
-- Captures only information relevant to the current visit
create table public.pregnancy_encounters (
  id uuid primary key default gen_random_uuid(),
  pregnancy_id uuid not null references public.maternal_pregnancies(id) on delete cascade,
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,

  -- Encounter identification
  encounter_type text not null default 'prenatal' check (encounter_type in ('prenatal', 'intrapartum', 'postpartum')),
  encounter_date date not null,
  encounter_number integer not null default 1, -- encounter sequence for this pregnancy
  
  -- Visit recording provider
  provider_id uuid references public.profiles(id) on delete set null,
  provider_name text not null default '',
  
  -- Clinical measurements (captured at this encounter only)
  gestational_age_weeks numeric(5, 2),
  gestational_age_source text not null default 'lmp' check (gestational_age_source in ('lmp', 'ultrasound', 'clinical', 'palpation')),
  
  systolic_bp numeric(3),
  diastolic_bp numeric(3),
  weight_kg numeric(5, 2),
  height_cm numeric(5, 2),
  bmi numeric(5, 2), -- calculated from height/weight if both present
  
  fundal_height_cm numeric(5, 2),
  fetal_heart_rate integer, -- beats per minute
  fetal_position text not null default '',
  
  -- Clinical findings & observations (free text; never auto-populated from prior visits)
  clinical_findings text not null default '',
  complications_identified text not null default '',
  assessment text not null default '',
  
  -- Care plan & next steps
  care_plan text not null default '',
  next_visit_planned_date date,
  referral_needed boolean not null default false,
  referral_reason text not null default '',
  referral_facility text not null default '',
  
  -- Service actions recorded during this encounter
  services_provided jsonb not null default '[]'::jsonb, -- array of service IDs provided at this visit
  
  -- Encounter notes
  notes text not null default '',
  
  -- Audit & versioning
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index pregnancy_encounters_pregnancy_idx
  on public.pregnancy_encounters(pregnancy_id, encounter_date desc);

create index pregnancy_encounters_resident_idx
  on public.pregnancy_encounters(resident_id, encounter_date desc);

create index pregnancy_encounters_scope_idx
  on public.pregnancy_encounters(barangay_id, encounter_date desc);

create index pregnancy_encounters_type_idx
  on public.pregnancy_encounters(encounter_type, encounter_date desc);

-- ============================================================================
-- PRENATAL SERVICES (Individual service documentation)
-- ============================================================================

-- One record per service per pregnancy
-- Tracks when services were provided, results, and next due date
-- Prevents accidental duplicate entries
create table public.prenatal_services (
  id uuid primary key default gen_random_uuid(),
  pregnancy_id uuid not null references public.maternal_pregnancies(id) on delete cascade,
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,

  -- Service classification
  service_category text not null check (service_category in (
    'immunization', 'micronutrient', 'deworming', 
    'infectious_disease_screening', 'laboratory_screening', 'other'
  )),
  service_type text not null, -- e.g., 'td1', 'iron_folic_v1', 'syphilis_screening', 'gdm_screening'
  service_name text not null, -- display name: 'Td/TT Dose 1', 'Iron-Folic Supplementation Visit 1', etc.
  
  -- Service status
  status text not null default 'pending' check (status in (
    'pending', 'due', 'overdue', 'completed', 'unable_to_provide', 'contraindicated', 'declined', 'not_applicable'
  )),
  
  -- Service provision details
  date_provided date,
  provider_id uuid references public.profiles(id) on delete set null,
  provider_name text not null default '',
  
  -- Results (for screenings/tests)
  result_status text not null default '', -- positive, negative, inconclusive, pending
  result_value text not null default '', -- structured result (e.g., "+", "-", "negative for infection")
  result_date date,
  result_notes text not null default '',
  
  -- Service-specific details (JSONB for flexibility)
  -- For immunization: { "dose_number": 1, "vaccine_lot": "ABC123", "route": "IM", "site": "left arm" }
  -- For micronutrient: { "tablet_count": 30, "type": "iron_folic", "dispensed": true }
  -- For screening: { "method": "RPR", "laboratory": "lab_name", "reference_range": "..." }
  service_details jsonb not null default '{}'::jsonb,
  
  -- Scheduling & follow-up
  date_due date, -- next service due date based on protocol
  date_overdue_after date, -- date after which service is overdue
  notes_on_non_completion text not null default '', -- why not completed, if applicable
  
  -- Audit & versioning
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

-- Prevent duplicate service entries (one per service_type per pregnancy)
create unique index prenatal_services_unique_type_per_pregnancy
  on public.prenatal_services(pregnancy_id, service_type)
  where status != 'not_applicable';

create index prenatal_services_pregnancy_idx
  on public.prenatal_services(pregnancy_id, status);

create index prenatal_services_resident_idx
  on public.prenatal_services(resident_id, date_provided desc);

create index prenatal_services_scope_idx
  on public.prenatal_services(barangay_id, status);

create index prenatal_services_due_idx
  on public.prenatal_services(date_due)
  where status in ('pending', 'due', 'overdue');

-- ============================================================================
-- DELIVERY RECORD (One per pregnancy)
-- ============================================================================

-- Separate delivery facts from pregnancy case
-- Created when delivery outcome is documented
create table public.delivery_records (
  id uuid primary key default gen_random_uuid(),
  pregnancy_id uuid not null references public.maternal_pregnancies(id) on delete restrict,
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,

  -- Delivery identification
  delivery_date date not null,
  delivery_time time,
  
  -- Delivery classification
  delivery_outcome text not null check (delivery_outcome in ('live_birth', 'stillbirth', 'abortion', 'ectopic')),
  type_of_delivery text not null default '' check (type_of_delivery in ('', 'vaginal', 'cesarean', 'instrumental', 'other')),
  place_of_delivery text not null default '' check (place_of_delivery in ('', 'public_facility', 'private_facility', 'home', 'other')),
  birth_attendant text not null default '' check (birth_attendant in ('', 'doctor', 'nurse', 'midwife', 'hilot', 'family', 'other')),
  
  -- Newborn details (for live births)
  newborn_sex text not null default '' check (newborn_sex in ('', 'm', 'f')),
  birth_weight_kg numeric(5, 2),
  birth_weight_class text not null default '' check (birth_weight_class in ('', 'low', 'normal', 'high', 'unknown')),
  apgar_1min integer,
  apgar_5min integer,
  
  -- Maternal complications (at delivery)
  maternal_complications text not null default '',
  newborn_complications text not null default '',
  
  -- Delivery notes
  delivery_notes text not null default '',
  
  -- Post-delivery follow-up generation flag
  postpartum_schedule_generated boolean not null default false,
  
  -- Audit & versioning
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index delivery_records_pregnancy_idx
  on public.delivery_records(pregnancy_id);

create index delivery_records_resident_idx
  on public.delivery_records(resident_id, delivery_date desc);

create index delivery_records_scope_idx
  on public.delivery_records(barangay_id, delivery_date desc);

-- ============================================================================
-- POSTPARTUM ENCOUNTERS (Per-visit postpartum assessments)
-- ============================================================================

-- Separate postpartum visits from delivery record
-- Flexible scheduling: 24h, 3d, 7-14d, 6 weeks, etc.
create table public.postpartum_encounters (
  id uuid primary key default gen_random_uuid(),
  pregnancy_id uuid not null references public.maternal_pregnancies(id) on delete cascade,
  delivery_record_id uuid not null references public.delivery_records(id) on delete cascade,
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,

  -- Encounter identification
  encounter_date date not null,
  encounter_number integer not null default 1, -- which postpartum visit (1st, 2nd, etc.)
  days_postpartum integer not null, -- calculated from delivery_date
  
  -- Visit classification
  visit_type text not null default 'routine' check (visit_type in ('routine', 'urgent', 'follow_up_concern')),
  scheduled_milestone text not null default '', -- e.g., '24h', '3d', '7-14d', '6wk'
  
  -- Provider & venue
  provider_id uuid references public.profiles(id) on delete set null,
  provider_name text not null default '',
  visit_location text not null default '',
  
  -- Maternal vital signs & measurements
  systolic_bp numeric(3),
  diastolic_bp numeric(3),
  temperature_celsius numeric(5, 2),
  weight_kg numeric(5, 2),
  
  -- Postpartum clinical assessment
  uterine_involution_status text not null default '', -- normal, delayed, excessive
  lochia_status text not null default '', -- normal, excessive, foul-smelling, absent
  episiotomy_wound_status text not null default '', -- intact, healing, infected, other
  breast_examination_findings text not null default '',
  
  -- Postpartum complications
  complications_identified text not null default '',
  referral_needed boolean not null default false,
  referral_reason text not null default '',
  referral_facility text not null default '',
  
  -- Supplementation & care
  iron_folic_given boolean not null default false,
  vitamin_a_given boolean not null default false,
  family_planning_discussed boolean not null default false,
  family_planning_method_chosen text not null default '',
  
  -- Newborn assessment (if seen at same visit)
  newborn_assessed boolean not null default false,
  newborn_findings text not null default '',
  newborn_referral_needed boolean not null default false,
  
  -- Services provided during this encounter
  services_provided jsonb not null default '[]'::jsonb,
  
  -- Assessment & plan
  assessment text not null default '',
  care_plan text not null default '',
  next_visit_planned_date date,
  notes text not null default '',
  
  -- Audit & versioning
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index postpartum_encounters_pregnancy_idx
  on public.postpartum_encounters(pregnancy_id, encounter_date desc);

create index postpartum_encounters_delivery_idx
  on public.postpartum_encounters(delivery_record_id, encounter_date desc);

create index postpartum_encounters_resident_idx
  on public.postpartum_encounters(resident_id, encounter_date desc);

create index postpartum_encounters_scope_idx
  on public.postpartum_encounters(barangay_id, encounter_date desc);

create index postpartum_encounters_scheduled_idx
  on public.postpartum_encounters(scheduled_milestone, encounter_date desc);

-- ============================================================================
-- POSTPARTUM FOLLOW-UP SCHEDULE (Auto-generated milestones)
-- ============================================================================

-- Tracks expected postpartum follow-up dates based on protocol
-- Auto-generated when delivery is recorded
-- Used for due/overdue identification and reminder scheduling
create table public.postpartum_follow_ups (
  id uuid primary key default gen_random_uuid(),
  pregnancy_id uuid not null references public.maternal_pregnancies(id) on delete cascade,
  delivery_record_id uuid not null references public.delivery_records(id) on delete cascade,
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,

  -- Follow-up milestone
  milestone text not null check (milestone in ('24h', '3d', '7-14d', '6wk')),
  days_from_delivery integer not null, -- e.g., 1 for 24h, 3 for 3d, etc.
  
  -- Scheduling
  expected_start_date date not null,
  expected_end_date date not null,
  
  -- Status tracking
  status text not null default 'pending' check (status in ('pending', 'due', 'overdue', 'completed', 'not_applicable', 'cancelled')),
  scheduled_date date,
  completed_date date,
  
  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index postpartum_follow_ups_pregnancy_idx
  on public.postpartum_follow_ups(pregnancy_id, milestone);

create index postpartum_follow_ups_resident_idx
  on public.postpartum_follow_ups(resident_id, status);

create index postpartum_follow_ups_scope_idx
  on public.postpartum_follow_ups(barangay_id, status);

create index postpartum_follow_ups_due_idx
  on public.postpartum_follow_ups(expected_start_date)
  where status in ('pending', 'due', 'overdue');

-- ============================================================================
-- MATERNAL CARE AUDIT LOG
-- ============================================================================

-- Track changes to pregnancy, encounters, services, and delivery records
-- for audit trail and regulatory compliance
create table public.maternal_care_audit_log (
  id uuid primary key default gen_random_uuid(),
  pregnancy_id uuid references public.maternal_pregnancies(id) on delete set null,
  entity_type text not null check (entity_type in (
    'pregnancy', 'encounter', 'service', 'delivery', 'postpartum_encounter', 'postpartum_follow_up'
  )),
  entity_id uuid not null,
  action text not null check (action in ('created', 'updated', 'deleted', 'status_changed')),
  
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text not null default '',
  
  changes jsonb not null default '{}'::jsonb, -- before/after comparison for updates
  
  municipality_id uuid,
  barangay_id uuid,
  
  created_at timestamptz not null default now()
);

create index maternal_care_audit_pregnancy_idx
  on public.maternal_care_audit_log(pregnancy_id, created_at desc);

create index maternal_care_audit_entity_idx
  on public.maternal_care_audit_log(entity_type, entity_id, created_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY & SCOPING
-- ============================================================================

-- Sync municipality/barangay scope from resident
create or replace function public.sync_maternal_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.residents%rowtype;
begin
  select * into r from public.residents where id = new.resident_id;
  if not found then raise exception 'maternal record: resident not found'; end if;
  new.municipality_id := r.municipality_id;
  new.barangay_id := r.barangay_id;
  return new;
end; $$;

-- Triggers for all tables to auto-sync scope and set updated_at
create trigger maternal_pregnancies_scope
  before insert or update on public.maternal_pregnancies
  for each row execute function public.sync_maternal_scope();

create trigger maternal_pregnancies_updated
  before update on public.maternal_pregnancies
  for each row execute function public.set_updated_at();

create trigger pregnancy_encounters_scope
  before insert or update on public.pregnancy_encounters
  for each row execute function public.sync_maternal_scope();

create trigger pregnancy_encounters_updated
  before update on public.pregnancy_encounters
  for each row execute function public.set_updated_at();

create trigger prenatal_services_scope
  before insert or update on public.prenatal_services
  for each row execute function public.sync_maternal_scope();

create trigger prenatal_services_updated
  before update on public.prenatal_services
  for each row execute function public.set_updated_at();

create trigger delivery_records_scope
  before insert or update on public.delivery_records
  for each row execute function public.sync_maternal_scope();

create trigger delivery_records_updated
  before update on public.delivery_records
  for each row execute function public.set_updated_at();

create trigger postpartum_encounters_scope
  before insert or update on public.postpartum_encounters
  for each row execute function public.sync_maternal_scope();

create trigger postpartum_encounters_updated
  before update on public.postpartum_encounters
  for each row execute function public.set_updated_at();

-- Enable RLS on all new tables
alter table public.maternal_pregnancies enable row level security;
alter table public.pregnancy_encounters enable row level security;
alter table public.prenatal_services enable row level security;
alter table public.delivery_records enable row level security;
alter table public.postpartum_encounters enable row level security;
alter table public.postpartum_follow_ups enable row level security;
alter table public.maternal_care_audit_log enable row level security;

-- RLS Policies: SELECT
create policy maternal_pregnancies_select on public.maternal_pregnancies
  for select to authenticated using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() in ('health_supervisor', 'bhw') and barangay_id = public.profile_barangay_id())
      )
    ) or exists (
      select 1 from public.residents r
      where r.id = public.maternal_pregnancies.resident_id and r.auth_user_id = auth.uid()
    )
  );

create policy pregnancy_encounters_select on public.pregnancy_encounters
  for select to authenticated using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() in ('health_supervisor', 'bhw') and barangay_id = public.profile_barangay_id())
      )
    ) or exists (
      select 1 from public.residents r
      where r.id = public.pregnancy_encounters.resident_id and r.auth_user_id = auth.uid()
    )
  );

create policy prenatal_services_select on public.prenatal_services
  for select to authenticated using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() in ('health_supervisor', 'bhw') and barangay_id = public.profile_barangay_id())
      )
    ) or exists (
      select 1 from public.residents r
      where r.id = public.prenatal_services.resident_id and r.auth_user_id = auth.uid()
    )
  );

create policy delivery_records_select on public.delivery_records
  for select to authenticated using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() in ('health_supervisor', 'bhw') and barangay_id = public.profile_barangay_id())
      )
    ) or exists (
      select 1 from public.residents r
      where r.id = public.delivery_records.resident_id and r.auth_user_id = auth.uid()
    )
  );

create policy postpartum_encounters_select on public.postpartum_encounters
  for select to authenticated using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() in ('health_supervisor', 'bhw') and barangay_id = public.profile_barangay_id())
      )
    ) or exists (
      select 1 from public.residents r
      where r.id = public.postpartum_encounters.resident_id and r.auth_user_id = auth.uid()
    )
  );

create policy postpartum_follow_ups_select on public.postpartum_follow_ups
  for select to authenticated using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() in ('health_supervisor', 'bhw') and barangay_id = public.profile_barangay_id())
      )
    ) or exists (
      select 1 from public.residents r
      where r.id = public.postpartum_follow_ups.resident_id and r.auth_user_id = auth.uid()
    )
  );

create policy maternal_care_audit_select on public.maternal_care_audit_log
  for select to authenticated using (
    public.is_admin() or public.is_staff_active()
  );

-- RLS Policies: INSERT
create policy maternal_pregnancies_insert on public.maternal_pregnancies
  for insert to authenticated with check (
    public.is_staff_active() and public.profile_covers_barangay(barangay_id)
  );

create policy pregnancy_encounters_insert on public.pregnancy_encounters
  for insert to authenticated with check (
    public.is_staff_active() and public.profile_covers_barangay(barangay_id)
  );

create policy prenatal_services_insert on public.prenatal_services
  for insert to authenticated with check (
    public.is_staff_active() and public.profile_covers_barangay(barangay_id)
  );

create policy delivery_records_insert on public.delivery_records
  for insert to authenticated with check (
    public.is_staff_active() and public.profile_covers_barangay(barangay_id)
  );

create policy postpartum_encounters_insert on public.postpartum_encounters
  for insert to authenticated with check (
    public.is_staff_active() and public.profile_covers_barangay(barangay_id)
  );

create policy postpartum_follow_ups_insert on public.postpartum_follow_ups
  for insert to authenticated with check (
    public.is_staff_active() and public.profile_covers_barangay(barangay_id)
  );

-- RLS Policies: UPDATE
create policy maternal_pregnancies_update on public.maternal_pregnancies
  for update to authenticated using (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  ) with check (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  );

create policy pregnancy_encounters_update on public.pregnancy_encounters
  for update to authenticated using (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  ) with check (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  );

create policy prenatal_services_update on public.prenatal_services
  for update to authenticated using (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  ) with check (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  );

create policy delivery_records_update on public.delivery_records
  for update to authenticated using (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  ) with check (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  );

create policy postpartum_encounters_update on public.postpartum_encounters
  for update to authenticated using (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  ) with check (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  );

create policy postpartum_follow_ups_update on public.postpartum_follow_ups
  for update to authenticated using (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  ) with check (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  );

-- RLS Policies: DELETE
create policy maternal_pregnancies_delete on public.maternal_pregnancies
  for delete to authenticated using (
    public.is_admin()
  );

create policy pregnancy_encounters_delete on public.pregnancy_encounters
  for delete to authenticated using (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  );

create policy prenatal_services_delete on public.prenatal_services
  for delete to authenticated using (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  );

create policy delivery_records_delete on public.delivery_records
  for delete to authenticated using (
    public.is_admin()
  );

create policy postpartum_encounters_delete on public.postpartum_encounters
  for delete to authenticated using (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  );

create policy postpartum_follow_ups_delete on public.postpartum_follow_ups
  for delete to authenticated using (
    public.is_admin()
  );

commit;
