-- =============================================================================
-- KALUSAGAP — BUG-010: MHO municipal submission review persistence
--
-- MHO review decisions on barangay TCL/M1 submissions were held only in
-- sessionStorage (`kalusagap.municipal-submissions.v2`). This table persists the
-- REVIEW DECISION (status, reviewer, timestamps, notes, audit trail) so it
-- survives refresh, logout/login and another authorized session.
--
-- Scope: reviews belong to the MHO's municipality. municipality_id is bound
-- server-side from the reviewer's profile (never a client value) and RLS
-- restricts reads/writes to that municipality; only the MHO (or admin) may
-- write a review decision.
--
-- This does not duplicate the reports/M1 tables: it records the municipal
-- monitoring review outcome keyed by the submission reference the MHO monitor
-- screen already uses.
--
-- Idempotent-friendly.
-- =============================================================================

begin;

create table if not exists public.municipal_submission_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_ref text not null,
  submission_type text not null default '',
  period text not null default '',
  municipality_id uuid not null references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete set null,
  status text not null default 'Pending Review',
  review_status text not null default 'Pending Review',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text not null default '',
  audit jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint municipal_submission_reviews_ref_unique unique (municipality_id, submission_ref)
);

create index if not exists municipal_submission_reviews_muni_idx
  on public.municipal_submission_reviews(municipality_id, period);

drop trigger if exists municipal_submission_reviews_set_updated_at on public.municipal_submission_reviews;
create trigger municipal_submission_reviews_set_updated_at
  before update on public.municipal_submission_reviews
  for each row execute function public.set_updated_at();

alter table public.municipal_submission_reviews enable row level security;

-- Reads: admin, or staff within the same municipality (drives the monitor UI).
drop policy if exists municipal_submission_reviews_select on public.municipal_submission_reviews;
create policy municipal_submission_reviews_select on public.municipal_submission_reviews
  for select to authenticated
  using (
    public.is_admin()
    or (public.is_staff_active() and municipality_id = public.profile_municipality_id())
  );

-- Writes: only the MHO of that municipality (municipality_id bound to the
-- reviewer's own profile). Admins may also write.
drop policy if exists municipal_submission_reviews_insert on public.municipal_submission_reviews;
create policy municipal_submission_reviews_insert on public.municipal_submission_reviews
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() = 'mho'
      and municipality_id = public.profile_municipality_id()
    )
  );

drop policy if exists municipal_submission_reviews_update on public.municipal_submission_reviews;
create policy municipal_submission_reviews_update on public.municipal_submission_reviews
  for update to authenticated
  using (
    public.is_admin()
    or (public.is_staff_active() and public.profile_role() = 'mho' and municipality_id = public.profile_municipality_id())
  )
  with check (
    public.is_admin()
    or (public.is_staff_active() and public.profile_role() = 'mho' and municipality_id = public.profile_municipality_id())
  );

commit;
