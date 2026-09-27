-- =============================================================================
-- KALUSAGAP — staff account verification (operational approval workflow)
--
-- Establishes the intended account-approval authority as DATABASE policy, not
-- only as a hidden button:
--
--   PHN              approves  health_supervisor, rhu_personnel
--   health_supervisor approves  bhw, resident
--   mho / admin      approve nobody (system administration / clinical
--                     supervision only)
--
-- Adds public.staff_account_requests: the personnel registration + verification
-- request that replaces the browser-only `staffRequestStore` /
-- `supervisorVerificationStore`. Every request is linked to a real Supabase
-- Auth user and a real `profiles` row, so an approved applicant can actually
-- sign in.
--
-- Additive only: no existing profile, resident, household or auth row is
-- deleted or rewritten. All statements are idempotent where practical.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Approval authority
-- ---------------------------------------------------------------------------
-- Single source of truth for "may this signed-in account approve that role?".
-- The Express API mirrors it in backend/src/config/staffApprovals.js, and both
-- are covered by public.can_approve_staff_role() so a direct PostgREST call
-- with a user token cannot bypass the workflow either.
create or replace function public.can_approve_staff_role(target_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- Only an ACTIVE staff account may approve anything.
    when not public.is_staff_active() then false
    when public.profile_role() = 'phn'
      then target_role in ('health_supervisor', 'rhu_personnel')
    when public.profile_role() = 'health_supervisor'
      then target_role in ('bhw', 'resident')
    -- mho and admin are deliberately NOT approval authorities.
    else false
  end;
$$;

comment on function public.can_approve_staff_role(public.app_role) is
  'Operational account-approval authority: PHN approves Health Supervisor + RHU Personnel; Health Supervisor approves BHW + Resident. Admin and MHO are never approvers.';

-- ---------------------------------------------------------------------------
-- Staff account requests
-- ---------------------------------------------------------------------------
-- A personnel registration (BHW / RHU Personnel / Health Supervisor / PHN /
-- MHO) plus its verification decision. `auth_user_id` points at the Supabase
-- Auth identity the applicant will sign in with; `profiles.status` is the
-- single gate the API's `loadActiveProfile` already enforces:
--   pending_verification -> staff role is served 403 "pending activation"
--   active               -> the account works
create table if not exists public.staff_account_requests (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  phone text not null default '',
  position text not null default '',
  license_no text not null default '',
  license_expiry date,
  role public.app_role not null
    check (role in ('bhw', 'health_supervisor', 'rhu_personnel', 'phn', 'mho')),
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete set null,
  facility_id uuid references public.facilities(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text not null default '',
  documents jsonb not null default '[]'::jsonb,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.staff_account_requests is
  'Personnel registration + verification decision. PHN approves Health Supervisor / RHU Personnel; Health Supervisor approves BHW / Resident.';

create index if not exists staff_account_requests_status_idx
  on public.staff_account_requests (status, submitted_at desc);
create index if not exists staff_account_requests_role_idx
  on public.staff_account_requests (role, status);
create index if not exists staff_account_requests_auth_idx
  on public.staff_account_requests (auth_user_id);

-- One live request per email. Resubmission after a rejection is allowed, so
-- the uniqueness is scoped to non-rejected rows.
create unique index if not exists staff_account_requests_open_email_uniq
  on public.staff_account_requests (lower(email))
  where status in ('pending', 'approved');

create trigger staff_account_requests_updated
  before update on public.staff_account_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit: every decision lands in the same health_audit_logs table the Audit
-- Trail page already reads, so approvals/rejections are real system activity
-- rather than a browser-local event.
-- ---------------------------------------------------------------------------
create or replace function public.log_staff_account_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.health_audit_logs
      (actor_id, action, entity_type, entity_id, municipality_id, barangay_id, metadata)
    values (
      coalesce(new.decided_by, auth.uid()),
      upper(new.status) || '_STAFF_ACCOUNT',
      'staff_account_requests',
      new.id::text,
      new.municipality_id,
      new.barangay_id,
      jsonb_build_object(
        'role', new.role::text,
        'email', new.email,
        'full_name', new.full_name,
        'previous_status', old.status,
        'new_status', new.status,
        'rejection_reason', new.rejection_reason
      )
    );
  end if;
  return new;
end;
$$;

create trigger staff_account_requests_decision_audit
  after update on public.staff_account_requests
  for each row execute function public.log_staff_account_decision();

-- Record the registration itself (status stays 'pending' on insert, so the
-- update trigger above does not fire for it).
create or replace function public.log_staff_account_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.health_audit_logs
    (actor_id, action, entity_type, entity_id, municipality_id, barangay_id, metadata)
  values (
    coalesce(new.decided_by, auth.uid()),
    'STAFF_ACCOUNT_SUBMITTED',
    'staff_account_requests',
    new.id::text,
    new.municipality_id,
    new.barangay_id,
    jsonb_build_object(
      'role', new.role::text,
      'email', new.email,
      'full_name', new.full_name
    )
  );
  return new;
end;
$$;

create trigger staff_account_requests_submission_audit
  after insert on public.staff_account_requests
  for each row execute function public.log_staff_account_submission();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Reads: the approver responsible for that role, plus admins for system
-- administration visibility.
-- Writes: ONLY the responsible approver may update a request. Registration is
-- performed by the API with the service-role key, which bypasses RLS, so no
-- insert policy is granted to user tokens at all.
alter table public.staff_account_requests enable row level security;

create policy staff_account_requests_select
  on public.staff_account_requests
  for select to authenticated
  using (
    public.is_admin()
    or public.can_approve_staff_role(role)
  );

create policy staff_account_requests_update
  on public.staff_account_requests
  for update to authenticated
  using (public.can_approve_staff_role(role))
  with check (public.can_approve_staff_role(role));

-- No insert/update/delete policy for anon: an applicant cannot self-approve,
-- and an approver cannot create their own approval row.

commit;
