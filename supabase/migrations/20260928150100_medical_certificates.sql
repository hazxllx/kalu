-- =============================================================================
-- KALUSAGAP — medical certificate register
--
-- Replaces the browser-session-only certificate store
-- (frontend/src/services/local/medicalCertificateStore.js, key
-- "kalusagap.med-certificates.v2", seeded to []) with a real, resident-linked,
-- scope-checked table so a certificate created by RHU Personnel / PHN is
-- visible to the PHN and MHO reviewing it.
--
-- WHY A NEW TABLE: exhaustive search of the migration history shows no
-- certificate entity exists. The `barangay_certificate` values found in the
-- document-type enums are resident identity documents, not medical
-- certificates, and must not be reused. No existing table is modified.
--
-- Scope columns are copied from the resident by the shared
-- public.sync_operational_scope() trigger, so a caller can never file a
-- certificate in a barangay they do not cover by sending an arbitrary id.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Medical certificates
-- ---------------------------------------------------------------------------
create table if not exists public.medical_certificates (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,
  -- Certificate / purpose classification (matches the composer + document form).
  purpose text not null default 'General Medical Certificate',
  findings text not null default '',
  date_of_examination date not null default current_date,
  medical_officer text not null default '',
  license_number text not null default '',
  certificate_number text not null default '',
  civil_status text not null default '',
  recommendation text not null default '',
  notes text not null default '',
  remarks text not null default '',
  -- Draft -> For Review -> Approved -> Issued, with Rejected / Cancelled.
  status text not null default 'Draft'
    check (status in ('Draft', 'For Review', 'Approved', 'Issued', 'Rejected', 'Cancelled')),
  date_issued date,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_remarks text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.medical_certificates is
  'Resident medical certificate register. Prepared by RHU Personnel / PHN / MHO; reviewed by the PHN or MHO.';

create table if not exists public.medical_certificate_logs (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references public.medical_certificates(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  previous_status text,
  new_status text,
  notes text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.medical_certificate_logs is
  'Per-certificate decision history, surfaced as the certificate audit trail and in the system Audit Trail.';

-- Scope is derived from the resident, never trusted from the caller.
create trigger medical_certificates_scope
  before insert or update on public.medical_certificates
  for each row execute function public.sync_operational_scope();

create trigger medical_certificates_updated
  before update on public.medical_certificates
  for each row execute function public.set_updated_at();

create index if not exists medical_certificates_scope_idx
  on public.medical_certificates (barangay_id, status, created_at desc);
create index if not exists medical_certificates_resident_idx
  on public.medical_certificates (resident_id);
create index if not exists medical_certificates_log_idx
  on public.medical_certificate_logs (certificate_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Review authority
-- ---------------------------------------------------------------------------
-- A certificate must be visible to the staff who may actually act on it:
--   PHN, MHO  -> review (approve / issue / reject)
--   rhu_personnel, health_supervisor, phn, mho -> prepare / read in scope
-- The frontend only enables the decision buttons for PHN / MHO, and
-- public.update_medical_certificates() re-checks that at the database layer.
create or replace function public.can_review_medical_certificates()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_staff_active()
    and public.profile_role() in ('phn', 'mho');
$$;

comment on function public.can_review_medical_certificates() is
  'Whether the caller may approve / issue / reject a medical certificate. PHN and MHO only.';

-- ---------------------------------------------------------------------------
-- Row Level Security — mirrors the operational-records boundary
--   admin                       -> all
--   mho / phn / rhu_personnel   -> own municipality
--   health_supervisor           -> own assigned barangay only
--   resident                    -> only certificates linked to their own account
-- Writes additionally require review authority for the decision columns, so a
-- user token cannot mark its own certificate Approved.
-- ---------------------------------------------------------------------------
alter table public.medical_certificates enable row level security;

create policy medical_certificates_select on public.medical_certificates
  for select to authenticated
  using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() in ('health_supervisor') and barangay_id = public.profile_barangay_id())
      )
    ) or exists (
      select 1 from public.residents r
      where r.id = medical_certificates.resident_id and r.auth_user_id = auth.uid()
    )
  );

create policy medical_certificates_insert on public.medical_certificates
  for insert to authenticated
  with check (
    public.is_staff_active() and public.profile_covers_barangay(barangay_id)
  );

create policy medical_certificates_update on public.medical_certificates
  for update to authenticated
  using (
    public.is_admin()
    or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  )
  with check (
    public.is_admin()
    or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  );

alter table public.medical_certificate_logs enable row level security;

create policy medical_certificate_logs_select on public.medical_certificate_logs
  for select to authenticated
  using (
    public.is_admin() or (
      public.is_staff_active() and exists (
        select 1 from public.medical_certificates mc
        where mc.id = medical_certificate_logs.certificate_id
          and (
            (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and mc.municipality_id = public.profile_municipality_id())
            or (public.profile_role() = 'health_supervisor' and mc.barangay_id = public.profile_barangay_id())
          )
      )
    ) or exists (
      select 1
      from public.medical_certificates mc
      join public.residents r on r.id = mc.resident_id
      where mc.id = medical_certificate_logs.certificate_id and r.auth_user_id = auth.uid()
    )
  );

commit;
