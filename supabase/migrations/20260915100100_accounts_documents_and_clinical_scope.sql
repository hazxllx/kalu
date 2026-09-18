-- =============================================================================
-- KALUSAGAP — account applications, documents & clinical scope
--
-- Phase 2 (continued). Runs AFTER both earlier migrations:
--   20260903120000_create_rhu_patient_workflow.sql  (residents/visits/referrals)
--   20260915100000_create_core_org_and_profiles.sql (org registry + helpers)
--
-- Creates:
--   account_applications  staff & health-supervisor registration applications
--                         (the two admin review queues: Staff Registration
--                         Requests + Health Supervisor Verification)
--   documents             upload metadata for application/resident documents;
--                         files live in the private `documents` storage bucket
--
-- Extends the clinical tables:
--   residents  + municipality_id / barangay_id FKs (synced from the existing
--              free-text `barangay` column), auth_user_id link for resident
--              accounts, verification_status
--   visits     + municipality_id / barangay_id (copied from the resident),
--              blood_sugar
--   referrals  + municipality_id / barangay_id, status check, status_history
--
-- Replaces the role-only RLS policies from the first migration with
-- scope-aware policies (municipality / barangay coverage) so a barangay-assigned
-- user can never read another barangay's records even with direct database
-- access. The original migration file is untouched; its policies are superseded
-- here at runtime.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Account applications
-- ---------------------------------------------------------------------------

create type public.application_type as enum ('staff', 'health_supervisor');

create type public.application_status as enum (
  'pending',
  'approved',
  'rejected',
  'requires_documents',
  'requires_correction'
);

create table public.account_applications (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  application_type public.application_type not null,
  -- Applicant identity
  first_name text not null,
  middle_name text not null default '',
  last_name text not null,
  suffix text not null default '',
  email text not null,
  contact text not null default '',
  -- Professional information
  position text not null default '',
  role_applied public.app_role not null default 'bhw',
  license_no text not null default '',
  license_expiration date,
  -- Assignment
  municipality_id uuid not null references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete set null,
  facility text not null default '',
  department text not null default '',
  employment_status text not null default '',
  years_of_service text not null default '',
  -- Review
  status public.application_status not null default 'pending',
  notes text not null default '',
  phn_note text not null default '',
  document_status text not null default 'pending'
    check (document_status in ('pending', 'complete')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index account_applications_status_idx on public.account_applications(status);
create index account_applications_municipality_id_idx on public.account_applications(municipality_id);
create index account_applications_type_idx on public.account_applications(application_type);

create trigger account_applications_set_updated_at before update on public.account_applications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Documents (metadata only — files live in the private storage bucket)
-- ---------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.account_applications(id) on delete cascade,
  resident_id text references public.residents(id) on delete cascade,
  purpose text not null,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  status text not null default 'uploaded' check (status in ('uploaded', 'verified', 'rejected')),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A document belongs to exactly one parent: an account application OR a
  -- resident (verification/identity documents).
  constraint documents_single_parent_check
    check ((application_id is not null)::int + (resident_id is not null)::int = 1),
  constraint documents_mime_check
    check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/jpg'))
);

create index documents_application_id_idx on public.documents(application_id);
create index documents_resident_id_idx on public.documents(resident_id);

create trigger documents_set_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Extend residents: municipality/barangay FKs + resident-account link
-- ---------------------------------------------------------------------------
-- The existing free-text `barangay` column stays (the Express repository maps
-- it directly); the sync trigger below keeps text and FK in sync in BOTH
-- directions, so existing backend code keeps working unchanged.

alter table public.residents
  add column municipality_id uuid references public.municipalities(id) on delete restrict,
  add column barangay_id uuid references public.barangays(id) on delete restrict,
  add column auth_user_id uuid references auth.users(id) on delete set null,
  add column verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified', 'rejected'));

create index residents_municipality_id_idx on public.residents(municipality_id);
create index residents_barangay_id_idx on public.residents(barangay_id);
create index residents_auth_user_id_idx on public.residents(auth_user_id);
create index residents_verification_status_idx on public.residents(verification_status);

-- Resolve barangay text <-> FK and derive the municipality.
--   barangay_id set    -> canonical name + municipality copied from the FK row
--   barangay text only -> looked up by name (case-insensitive; the deployment
--                         is single-municipality) and backfilled
create or replace function public.residents_sync_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.barangays%rowtype;
begin
  if new.barangay_id is not null then
    select * into b from public.barangays where id = new.barangay_id;
    if not found then
      raise exception 'residents: unknown barangay_id %', new.barangay_id;
    end if;
    new.barangay := b.name;
    new.municipality_id := b.municipality_id;
  elsif coalesce(new.barangay, '') <> '' then
    select * into b from public.barangays
    where lower(name) = lower(new.barangay)
    limit 1;
    if found then
      new.barangay_id := b.id;
      new.municipality_id := b.municipality_id;
      new.barangay := b.name;
    end if;
  end if;
  return new;
end;
$$;

create trigger residents_sync_scope_trigger
  before insert or update on public.residents
  for each row execute function public.residents_sync_scope();

-- ---------------------------------------------------------------------------
-- Extend visits: scope columns + blood sugar
-- ---------------------------------------------------------------------------

alter table public.visits
  add column municipality_id uuid references public.municipalities(id) on delete restrict,
  add column barangay_id uuid references public.barangays(id) on delete restrict,
  add column blood_sugar numeric;

create index visits_municipality_id_idx on public.visits(municipality_id);
create index visits_barangay_id_idx on public.visits(barangay_id);

-- Copy the resident's scope onto every visit — unconditionally, so a visit's
-- barangay/municipality can never diverge from its resident's.
create or replace function public.visits_sync_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_municipality uuid;
  v_barangay uuid;
begin
  select municipality_id, barangay_id into v_municipality, v_barangay
  from public.residents where id = new.resident_id;
  new.municipality_id := v_municipality;
  new.barangay_id := v_barangay;
  return new;
end;
$$;

create trigger visits_sync_scope_trigger
  before insert or update on public.visits
  for each row execute function public.visits_sync_scope();

-- ---------------------------------------------------------------------------
-- Extend referrals: scope columns, status workflow, history
-- ---------------------------------------------------------------------------

alter table public.referrals
  add column municipality_id uuid references public.municipalities(id) on delete restrict,
  add column barangay_id uuid references public.barangays(id) on delete restrict,
  add column status_history jsonb not null default '[]'::jsonb,
  add constraint referrals_status_check check (
    status in ('draft', 'pending', 'for_review', 'accepted', 'in_progress',
               'completed', 'rejected', 'referred')
  );

create index referrals_municipality_id_idx on public.referrals(municipality_id);
create index referrals_barangay_id_idx on public.referrals(barangay_id);

create or replace function public.referrals_sync_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_municipality uuid;
  v_barangay uuid;
begin
  select municipality_id, barangay_id into v_municipality, v_barangay
  from public.residents where id = new.resident_id;
  new.municipality_id := v_municipality;
  new.barangay_id := v_barangay;
  return new;
end;
$$;

create trigger referrals_sync_scope_trigger
  before insert or update on public.referrals
  for each row execute function public.referrals_sync_scope();

-- ---------------------------------------------------------------------------
-- Private document storage bucket
-- ---------------------------------------------------------------------------
-- Private by default: no public URLs. The Express backend authorizes every
-- upload/download and hands out short-lived signed URLs. The service-role key
-- (server only) is the only client with blanket access.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Tighten the counter function
-- ---------------------------------------------------------------------------
-- The first migration granted increment_counter() to anon/authenticated; only
-- the server (service role) needs it. Direct counter manipulation from the
-- browser is revoked.

revoke execute on function public.increment_counter(text) from public, anon, authenticated;
grant execute on function public.increment_counter(text) to service_role;

-- ---------------------------------------------------------------------------
-- RLS — account applications & documents
-- ---------------------------------------------------------------------------

alter table public.account_applications enable row level security;
alter table public.documents enable row level security;

-- Applications are submitted from the PUBLIC registration pages (no account
-- yet), so inserts are allowed for anon/authenticated but must start as
-- 'pending'. Reading and deciding is admin-only, and an applicant can never
-- have the admin role — approving your own application is structurally
-- impossible (the service layer additionally refuses reviewed_by = applicant).
create policy account_applications_select on public.account_applications
  for select to authenticated using (public.is_admin());

create policy account_applications_insert on public.account_applications
  for insert to anon, authenticated
  with check (status = 'pending' and reviewed_by is null);

create policy account_applications_update on public.account_applications
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy account_applications_delete on public.account_applications
  for delete to authenticated using (public.is_admin());

-- Uploads/downloads go through the Express backend (which authorizes and
-- streams or signs URLs), so no direct insert policy exists. Admins can read
-- document metadata; a resident can read the metadata of their OWN documents.
create policy documents_select on public.documents
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.residents r
      where r.id = documents.resident_id
        and r.auth_user_id = auth.uid()
    )
  );

create policy documents_update on public.documents
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy documents_delete on public.documents
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- RLS — replace the role-only clinical policies with scope-aware policies
-- ---------------------------------------------------------------------------
-- The first migration's policies allowed any staff role to read every row.
-- These replace them with the coverage rules the frontend already enforces:
--   admin                          everything
--   mho / phn / rhu_personnel      their own municipality
--   health_supervisor / bhw        exactly their assigned barangay
--   resident                       only rows linked to their own account

drop policy if exists residents_select_staff on public.residents;
drop policy if exists residents_insert_staff on public.residents;
drop policy if exists residents_update_staff on public.residents;

create policy residents_select on public.residents
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_staff_active()
      and (
        (
          public.profile_role() in ('mho', 'phn', 'rhu_personnel')
          and municipality_id = public.profile_municipality_id()
        )
        or (
          public.profile_role() in ('health_supervisor', 'bhw')
          and barangay_id = public.profile_barangay_id()
        )
      )
    )
  );

create policy residents_insert on public.residents
  for insert to authenticated
  with check (
    public.is_staff_active()
    and public.profile_covers_barangay(barangay_id)
  );

create policy residents_update on public.residents
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('phn', 'health_supervisor')
      and public.profile_covers_barangay(barangay_id)
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('phn', 'health_supervisor')
      and public.profile_covers_barangay(barangay_id)
    )
  );

-- No delete policy: residents are archived (verification_status / status
-- fields), never removed, preserving clinical history.

drop policy if exists visits_select on public.visits;
drop policy if exists visits_insert on public.visits;
drop policy if exists visits_update_phn on public.visits;
drop policy if exists visits_update_owner_draft on public.visits;

create policy visits_select on public.visits
  for select to authenticated
  using (
    public.is_admin()
    or recorded_by_id = auth.uid()::text
    or (
      public.is_staff_active()
      and (
        (
          public.profile_role() in ('mho', 'phn', 'rhu_personnel')
          and municipality_id = public.profile_municipality_id()
        )
        or (
          public.profile_role() = 'health_supervisor'
          and barangay_id = public.profile_barangay_id()
        )
      )
    )
    or exists (
      select 1 from public.residents r
      where r.id = visits.resident_id
        and r.auth_user_id = auth.uid()
    )
  );

create policy visits_insert on public.visits
  for insert to authenticated
  with check (
    public.is_staff_active()
    and public.profile_role() in ('bhw', 'rhu_personnel', 'health_supervisor', 'phn')
    and public.profile_covers_barangay(barangay_id)
  );

-- Workflow transitions stay inside the caller's scope; the state machine
-- itself (draft -> submitted -> received -> ... ) is validated by the service
-- layer, so WITH CHECK drops the status conditions USING carries.
create policy visits_update on public.visits
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() = 'phn'
      and municipality_id = public.profile_municipality_id()
      and status <> 'draft'
    )
    or (
      public.is_staff_active()
      and public.profile_role() in ('bhw', 'rhu_personnel', 'health_supervisor')
      and recorded_by_id = auth.uid()::text
      and status = 'draft'
    )
    or (
      public.is_staff_active()
      and public.profile_role() = 'health_supervisor'
      and barangay_id = public.profile_barangay_id()
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and (
        (
          public.profile_role() = 'phn'
          and municipality_id = public.profile_municipality_id()
        )
        or (
          public.profile_role() in ('bhw', 'rhu_personnel', 'health_supervisor')
          and recorded_by_id = auth.uid()::text
        )
        or (
          public.profile_role() = 'health_supervisor'
          and barangay_id = public.profile_barangay_id()
        )
      )
    )
  );

drop policy if exists referrals_select_staff on public.referrals;
drop policy if exists referrals_insert_phn on public.referrals;
drop policy if exists referrals_update_phn on public.referrals;

create policy referrals_select on public.referrals
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('mho', 'phn', 'health_supervisor', 'rhu_personnel')
      and (
        (
          public.profile_role() in ('mho', 'phn', 'rhu_personnel')
          and municipality_id = public.profile_municipality_id()
        )
        or (
          public.profile_role() = 'health_supervisor'
          and barangay_id = public.profile_barangay_id()
        )
      )
    )
    or exists (
      select 1 from public.residents r
      where r.id = referrals.resident_id
        and r.auth_user_id = auth.uid()
    )
  );

create policy referrals_insert on public.referrals
  for insert to authenticated
  with check (
    public.is_staff_active()
    and public.profile_role() in ('phn', 'health_supervisor', 'rhu_personnel')
    and public.profile_covers_barangay(barangay_id)
  );

create policy referrals_update on public.referrals
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('phn', 'mho')
      and municipality_id = public.profile_municipality_id()
    )
    or (
      public.is_staff_active()
      and public.profile_role() = 'health_supervisor'
      and barangay_id = public.profile_barangay_id()
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and (
        (
          public.profile_role() in ('phn', 'mho')
          and municipality_id = public.profile_municipality_id()
        )
        or (
          public.profile_role() = 'health_supervisor'
          and barangay_id = public.profile_barangay_id()
        )
      )
    )
  );

commit;
