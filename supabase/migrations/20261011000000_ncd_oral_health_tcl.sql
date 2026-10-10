-- KALUSAGAP - Program-specific Target Client List (TCL) records
-- Additive only. Integrates the official DOH TCL workbooks that are not part of
-- the FHSIS M1 report:
--   * NCD TCLs            (Part 1 Risk-Assessed Adults, Part 2 Cervical CA & BME,
--                          Part 3 Visual Acuity & PPV)
--   * Oral Health TCL     (client-level oral health care & services)
--
-- Each official worksheet gets its OWN table (its own RLS, indexes and
-- server-side validation schema) rather than being merged into one generic
-- table. Queryable/reportable columns (scope, dates, sex, age, SES, risk group)
-- are first-class columns; the remaining faithful worksheet fields live in a
-- validated `data` jsonb payload (the key whitelist + enum checks are enforced
-- in backend/src/services/programForms.service.js and mirrored by CHECK
-- constraints where practical).
--
-- Scope (municipality_id/barangay_id) is copied from the resident by the
-- existing public.sync_operational_scope() trigger so a caller can never select
-- an arbitrary barangay. RLS mirrors the operational-records policies.

begin;

-- ---------------------------------------------------------------------------
-- NCD Part 1 - Target Client List for Risk-Assessed Adults 20 y/o and above
-- ---------------------------------------------------------------------------
create table public.ncd_risk_assessments (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,
  assessment_date date,
  family_serial_no text not null default '',
  se_status text check (se_status in ('NHTS', 'Non-NHTS')),
  sex text check (sex in ('M', 'F')),
  age integer check (age is null or (age >= 0 and age <= 130)),
  -- data keys: current_smoker (Y/N), binge_alcohol (Y/N),
  --   weight_class (1=overweight 23.0-24.9 | 2=obese >=25 | null),
  --   htn_screening_date, htn_result (+/-), dm_screening_date, dm_result (+/-)
  data jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- NCD Part 2 - Cervical Cancer Screening and Breast Mass Examination
-- ---------------------------------------------------------------------------
create table public.ncd_cervical_breast (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,
  assessment_date date,
  family_serial_no text not null default '',
  se_status text check (se_status in ('NHTS', 'Non-NHTS')),
  age integer check (age is null or (age >= 0 and age <= 130)),
  -- data keys: risk_status (RISK/NO_RISK), cervical_screening_type (V=VIA | P=Pap),
  --   cervical_result (N=Negative | P=Positive | SC=Suspicious CA),
  --   breast_mass (Y/N)
  data jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- NCD Part 3 - Visual Acuity Screening and PPV Immunization (Senior Citizens)
-- ---------------------------------------------------------------------------
create table public.ncd_visual_ppv (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,
  assessment_date date,
  family_serial_no text not null default '',
  osca_id_no text not null default '',
  se_status text check (se_status in ('NHTS', 'Non-NHTS')),
  sex text check (sex in ('M', 'F')),
  age integer check (age is null or (age >= 0 and age <= 130)),
  -- data keys: eye_complaints (√/X), va_result (fraction string),
  --   with_eye_problem (√/X), pinhole (IMPROVED/NO_IMPROVEMENT/null),
  --   mgmt_optometrist_date, mgmt_ophthalmologist_date, mgmt_worse_date,
  --   ppv_date_given
  data jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Oral Health - Target Client List for Oral Health Care and Services
-- ---------------------------------------------------------------------------
create table public.oral_health_records (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,
  consultation_date date,
  family_serial_no text not null default '',
  date_of_birth date,
  -- Age/Risk group bucket per the worksheet sub-columns.
  age_group text check (age_group in ('0-11mos','1-4','5-9','10-19','20-59','>=60','pregnant')),
  -- For a pregnant client the worksheet records a pregnancy age band.
  pregnant_age_band text check (pregnant_age_band in ('10-14','15-19','20-49')),
  se_status text check (se_status in ('NHTS', 'Non-NHTS')),
  age integer check (age is null or (age >= 0 and age <= 130)),
  -- data keys: oh_status_12_59 (orally_fit_exam date | orally_fit_rehab date),
  --   dmft {decayed, missing, filled booleans},
  --   services [codes...] with dates, bohc_given {age bucket: date}, remarks
  data jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Scope + updated_at triggers (reuse the shared functions from the operational
-- records migration).
do $$
declare t text;
begin
  foreach t in array array['ncd_risk_assessments','ncd_cervical_breast','ncd_visual_ppv','oral_health_records'] loop
    execute format('create trigger %I_scope before insert or update on public.%I for each row execute function public.sync_operational_scope()', t, t);
    execute format('create trigger %I_updated before update on public.%I for each row execute function public.set_updated_at()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format($p$
      create policy %I_select on public.%I for select to authenticated using (
        public.is_admin() or (
          public.is_staff_active() and (
            (public.profile_role() in ('mho','phn','rhu_personnel') and municipality_id = public.profile_municipality_id())
            or (public.profile_role() in ('health_supervisor','bhw') and barangay_id = public.profile_barangay_id())
          )
        ) or exists (select 1 from public.residents r where r.id = %I.resident_id and r.auth_user_id = auth.uid())
      )
    $p$, t, t, t);
    execute format($p$
      create policy %I_insert on public.%I for insert to authenticated with check (
        public.is_staff_active() and (
          (public.profile_role() in ('mho','phn') and municipality_id = public.profile_municipality_id())
          or (public.profile_role() = 'health_supervisor' and public.profile_covers_barangay(barangay_id))
        )
      )
    $p$, t, t);
    execute format($p$
      create policy %I_update on public.%I for update to authenticated using (
        public.is_admin() or (public.is_staff_active() and (
          (public.profile_role() in ('mho','phn') and municipality_id = public.profile_municipality_id())
          or (public.profile_role() = 'health_supervisor' and public.profile_covers_barangay(barangay_id))
        ))
      ) with check (
        public.is_admin() or (public.is_staff_active() and (
          (public.profile_role() in ('mho','phn') and municipality_id = public.profile_municipality_id())
          or (public.profile_role() = 'health_supervisor' and public.profile_covers_barangay(barangay_id))
        ))
      )
    $p$, t, t);
  end loop;
end $$;

create index ncd_risk_assessments_scope_idx on public.ncd_risk_assessments(barangay_id, assessment_date);
create index ncd_risk_assessments_resident_idx on public.ncd_risk_assessments(resident_id);
create index ncd_cervical_breast_scope_idx on public.ncd_cervical_breast(barangay_id, assessment_date);
create index ncd_cervical_breast_resident_idx on public.ncd_cervical_breast(resident_id);
create index ncd_visual_ppv_scope_idx on public.ncd_visual_ppv(barangay_id, assessment_date);
create index ncd_visual_ppv_resident_idx on public.ncd_visual_ppv(resident_id);
create index oral_health_records_scope_idx on public.oral_health_records(barangay_id, consultation_date);
create index oral_health_records_resident_idx on public.oral_health_records(resident_id);
create index oral_health_records_agegroup_idx on public.oral_health_records(barangay_id, age_group);

commit;
