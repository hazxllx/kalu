-- =============================================================================
-- KALUSAGAP — minor / parent-or-guardian linking
--
-- Adds a normalized relationship table between a MINOR resident record and a
-- parent / legal guardian. This is the Phase 2.2 groundwork:
--
--   * a minor's registration application records the guardian's declared
--     details (relationship type, contact, optional linked resident record);
--   * the link is verified by authorized staff — it is never auto-verified;
--   * a link NEVER grants the guardian access to the minor's medical records.
--     Guardian record access is a separate, unapproved policy decision
--     (see docs/development clarification items) and no access is implied.
--
-- Design notes
--   * Guardian may or may not already be a KALUSAGAP resident:
--       guardian_resident_id -> existing resident record when linked
--       guardian_* fields    -> declared details when they have no account yet
--     Either form is valid; the reviewer records which one it is.
--   * Self-reference is impossible (check constraint).
--   * At most one ACTIVE link per minor (partial unique index); a rejected
--     link does not block a corrected replacement.
--   * residents.guardian_status is a denormalized convenience mirror of the
--     minor's latest active link status so list views can show it without a
--     join. It is maintained exclusively by the backend service.
--
-- Additive and idempotent: guarded with IF NOT EXISTS / DROP POLICY IF EXISTS.
-- No existing column, row or policy is modified or removed.
-- =============================================================================

begin;

create table if not exists public.resident_guardian_links (
  id uuid primary key default gen_random_uuid(),
  minor_resident_id text not null references public.residents(id) on delete cascade,
  guardian_resident_id text references public.residents(id) on delete set null,
  guardian_last_name text not null,
  guardian_first_name text not null default '',
  guardian_middle_name text not null default '',
  relationship_type text not null check (relationship_type in ('father', 'mother', 'legal_guardian', 'grandparent', 'other_family_member', 'other')),
  guardian_cellphone_no text not null default '',
  guardian_identity_no text not null default '',
  consent_recorded boolean not null default false,
  consent_note text not null default '',
  verification_status text not null default 'pending_verification'
    check (verification_status in ('pending_verification', 'verified', 'rejected')),
  verification_note text not null default '',
  verified_by_id uuid references public.profiles(id) on delete set null,
  verified_by_role text not null default '',
  verified_by_name text not null default '',
  verified_at timestamptz,
  created_by_id text not null default '',
  created_by_role text not null default '',
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resident_guardian_links_no_self_reference
    check (minor_resident_id is distinct from guardian_resident_id)
);

-- A minor may have at most one non-rejected (active) guardian link at a time.
create unique index if not exists resident_guardian_links_one_active_per_minor
  on public.resident_guardian_links(minor_resident_id)
  where verification_status <> 'rejected';

create index if not exists resident_guardian_links_minor_idx
  on public.resident_guardian_links(minor_resident_id);
create index if not exists resident_guardian_links_guardian_idx
  on public.resident_guardian_links(guardian_resident_id);
create index if not exists resident_guardian_links_status_idx
  on public.resident_guardian_links(verification_status);

drop trigger if exists resident_guardian_links_set_updated_at on public.resident_guardian_links;
create trigger resident_guardian_links_set_updated_at
  before update on public.resident_guardian_links
  for each row execute function public.set_updated_at();

-- Denormalized mirror on the minor's record (service-maintained, never a
-- source of truth: the link table is).
alter table public.residents
  add column if not exists guardian_status text
    check (guardian_status is null or guardian_status in ('pending_verification', 'verified', 'rejected'));

-- ---------------------------------------------------------------------------
-- Row Level Security
--   read:    admin; any active staff member whose coverage includes the
--            minor's barangay; the minor's own authenticated account
--            (their application/guardian status, never the guardian's records)
--   insert:  active BHW / Health Supervisor / PHN within their coverage
--   update:  admin, or active Health Supervisor / PHN within their coverage
--            (verification workflow + corrections)
--   delete:  admin only
-- No policy grants a guardian any access to the minor's records.
-- ---------------------------------------------------------------------------
alter table public.resident_guardian_links enable row level security;

drop policy if exists resident_guardian_links_select on public.resident_guardian_links;
create policy resident_guardian_links_select on public.resident_guardian_links
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and exists (
        select 1 from public.residents r
        where r.id = resident_guardian_links.minor_resident_id
          and public.profile_covers_barangay(r.barangay_id)
      )
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('resident', 'resident-limited')
        and exists (
          select 1 from public.residents r
          where r.id = resident_guardian_links.minor_resident_id
            and r.auth_user_id = p.id
        )
    )
  );

drop policy if exists resident_guardian_links_insert on public.resident_guardian_links;
create policy resident_guardian_links_insert on public.resident_guardian_links
  for insert to authenticated
  with check (
    public.is_staff_active()
    and public.profile_role() in ('bhw', 'health_supervisor', 'phn')
    and exists (
      select 1 from public.residents r
      where r.id = minor_resident_id
        and public.profile_covers_barangay(r.barangay_id)
    )
  );

drop policy if exists resident_guardian_links_update on public.resident_guardian_links;
create policy resident_guardian_links_update on public.resident_guardian_links
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('health_supervisor', 'phn')
      and exists (
        select 1 from public.residents r
        where r.id = resident_guardian_links.minor_resident_id
          and public.profile_covers_barangay(r.barangay_id)
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('health_supervisor', 'phn')
      and exists (
        select 1 from public.residents r
        where r.id = resident_guardian_links.minor_resident_id
          and public.profile_covers_barangay(r.barangay_id)
      )
    )
  );

drop policy if exists resident_guardian_links_delete on public.resident_guardian_links;
create policy resident_guardian_links_delete on public.resident_guardian_links
  for delete to authenticated
  using (public.is_admin());

commit;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- begin;
--   drop policy if exists resident_guardian_links_delete on public.resident_guardian_links;
--   drop policy if exists resident_guardian_links_update on public.resident_guardian_links;
--   drop policy if exists resident_guardian_links_insert on public.resident_guardian_links;
--   drop policy if exists resident_guardian_links_select on public.resident_guardian_links;
--   alter table public.resident_guardian_links drop trigger if exists resident_guardian_links_set_updated_at;
--   drop index if exists resident_guardian_links_status_idx;
--   drop index if exists resident_guardian_links_guardian_idx;
--   drop index if exists resident_guardian_links_minor_idx;
--   drop index if exists resident_guardian_links_one_active_per_minor;
--   drop table if exists public.resident_guardian_links;
--   alter table public.residents drop column if exists guardian_status;
-- commit;
