-- KALUSAGAP - Maternal visit history
--
-- This table stores the repeated prenatal / intrapartum / postpartum visit rows
-- that the official maternal TCL workflow expects. The underlying maternal case
-- remains the patient-level pregnancy record; each visit is a separate row tied
-- back to the case, preserving history without overwriting older entries.
--
-- Additive only: the case record and existing data remain intact. This migration
-- creates the row-level visit model and the matching RLS boundary used by the
-- operational service layer.

begin;

create table public.maternal_visits (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null references public.residents(id) on delete restrict,
  maternal_case_id uuid not null references public.maternal_records(id) on delete cascade,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,
  visit_date date not null,
  visit_type text not null default 'prenatal' check (visit_type in ('prenatal', 'intrapartum', 'postpartum')),
  blood_pressure text not null default '',
  weight numeric(5, 2),
  fundal_height text not null default '',
  fetal_heart_tone text not null default '',
  gestational_age_weeks numeric(5, 2),
  provider text not null default '',
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger maternal_visits_scope
before insert or update on public.maternal_visits
for each row execute function public.sync_operational_scope();

create trigger maternal_visits_updated
before update on public.maternal_visits
for each row execute function public.set_updated_at();

create index maternal_visits_case_idx
  on public.maternal_visits(maternal_case_id, visit_date desc);

create index maternal_visits_scope_idx
  on public.maternal_visits(barangay_id, visit_date desc);

alter table public.maternal_visits enable row level security;

create policy maternal_visits_select on public.maternal_visits
for select to authenticated using (
  public.is_admin() or (
    public.is_staff_active() and (
      (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
      or (public.profile_role() in ('health_supervisor', 'bhw') and barangay_id = public.profile_barangay_id())
    )
  ) or exists (
    select 1 from public.residents r
    where r.id = public.maternal_visits.resident_id and r.auth_user_id = auth.uid()
  )
);

create policy maternal_visits_insert on public.maternal_visits
for insert to authenticated with check (
  public.is_staff_active() and public.profile_covers_barangay(barangay_id)
);

create policy maternal_visits_update on public.maternal_visits
for update to authenticated using (
  public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
) with check (
  public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
);

create policy maternal_visits_delete on public.maternal_visits
for delete to authenticated using (
  public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
);

commit;
