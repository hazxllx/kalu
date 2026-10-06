-- KALUSAGAP — minor registration, student ID review, and guardian acceptance.
--
-- Student IDs remain in the existing private documents bucket and documents
-- table. Guardian requests are informational until the account holder accepts
-- and authorized staff verifies the declared relationship; no access to health
-- records is granted by this workflow.

begin;

alter table public.residents
  add column if not exists minor_verification_method text
    check (minor_verification_method is null or minor_verification_method in ('student_id', 'staff_alternative')),
  add column if not exists minor_alternative_status text
    check (minor_alternative_status is null or minor_alternative_status in ('pending_review', 'approved', 'rejected')),
  add column if not exists minor_alternative_reason text not null default '',
  add column if not exists minor_alternative_reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists minor_alternative_reviewed_at timestamptz;

do $$
declare
  rec record;
begin
  for rec in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where rel.relname = 'residents'
      and nsp.nspname = 'public'
      and con.contype = 'c'
      and exists (
        select 1
        from unnest(con.conkey) k(attnum)
        join pg_attribute a on a.attnum = k.attnum and a.attrelid = con.conrelid
        where a.attname = 'guardian_status'
      )
  loop
    execute format('alter table public.residents drop constraint %I', rec.conname);
  end loop;
end$$;

alter table public.residents
  add constraint residents_guardian_status_check
  check (guardian_status is null or guardian_status in (
    'skipped',
    'pending_guardian_acceptance',
    'pending_verification',
    'verified',
    'rejected',
    'cancelled'
  ));

comment on column public.residents.minor_verification_method is
  'Server-classified minor registration path: student_id or staff_alternative. Null for adults.';
comment on column public.residents.minor_alternative_status is
  'Staff decision for a minor who lacks a student ID; resident approval requires approved status.';

alter table public.documents drop constraint if exists documents_document_type_check;
alter table public.documents add constraint documents_document_type_check check (document_type in (
  'proof_of_residency',
  'barangay_certificate',
  'barangay_clearance',
  'government_id',
  'other',
  'government_id_front',
  'government_id_back',
  'identity_photo',
  'transfer_previous_health_record',
  'transfer_proof_of_address',
  'student_id'
));

comment on column public.documents.document_type is
  'Student ID is a distinct private document type and is not a government ID or identity photo.';

alter table public.resident_guardian_links
  add column if not exists guardian_auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists guardian_accepted_by_id uuid references auth.users(id) on delete set null,
  add column if not exists guardian_accepted_at timestamptz;

do $$
declare
  rec record;
begin
  for rec in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where rel.relname = 'resident_guardian_links'
      and nsp.nspname = 'public'
      and con.contype = 'c'
      and exists (
        select 1
        from unnest(con.conkey) k(attnum)
        join pg_attribute a on a.attnum = k.attnum and a.attrelid = con.conrelid
        where a.attname = 'verification_status'
      )
  loop
    execute format('alter table public.resident_guardian_links drop constraint %I', rec.conname);
  end loop;
end$$;

alter table public.resident_guardian_links
  add constraint resident_guardian_links_verification_status_check
  check (verification_status in (
    'pending_guardian_acceptance',
    'pending_verification',
    'verified',
    'rejected',
    'cancelled'
  ));

alter table public.resident_guardian_links
  add constraint resident_guardian_links_acceptance_state_check
  check (
    (guardian_accepted_by_id is null) = (guardian_accepted_at is null)
    and (
      verification_status <> 'pending_guardian_acceptance'
      or guardian_auth_user_id is not null
    )
    and (
      (verification_status = 'pending_guardian_acceptance'
        and guardian_auth_user_id is not null
        and guardian_accepted_by_id is null)
      or guardian_auth_user_id is null
      or verification_status in ('rejected', 'cancelled')
      or (
        verification_status in ('pending_verification', 'verified')
        and guardian_accepted_by_id = guardian_auth_user_id
        and guardian_accepted_at is not null
      )
    )
  );

drop index if exists public.resident_guardian_links_one_active_per_minor;
create unique index resident_guardian_links_one_active_per_minor
  on public.resident_guardian_links(minor_resident_id)
  where verification_status not in ('rejected', 'cancelled');

create index if not exists resident_guardian_links_guardian_auth_user_idx
  on public.resident_guardian_links(guardian_auth_user_id)
  where guardian_auth_user_id is not null;

-- A guardian can read only requests directed to their authenticated account.
-- No policy grants them access to residents, documents, or health records.
drop policy if exists resident_guardian_links_guardian_select on public.resident_guardian_links;
create policy resident_guardian_links_guardian_select on public.resident_guardian_links
  for select to authenticated
  using (guardian_auth_user_id = auth.uid());

drop policy if exists resident_guardian_links_update on public.resident_guardian_links;
create policy resident_guardian_links_update on public.resident_guardian_links
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('health_supervisor', 'phn')
      and verification_status = 'pending_verification'
      and exists (
        select 1 from public.residents r
        where r.id = resident_guardian_links.minor_resident_id
          and public.profile_covers_barangay(r.barangay_id)
      )
    )
    or (
      guardian_auth_user_id = auth.uid()
      and verification_status = 'pending_guardian_acceptance'
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('health_supervisor', 'phn')
      and verification_status in ('pending_verification', 'verified', 'rejected')
      and exists (
        select 1 from public.residents r
        where r.id = resident_guardian_links.minor_resident_id
          and public.profile_covers_barangay(r.barangay_id)
      )
    )
    or (
      guardian_auth_user_id = auth.uid()
      and verification_status in ('pending_verification', 'rejected')
      and (
        (verification_status = 'pending_verification'
          and guardian_accepted_by_id = auth.uid()
          and guardian_accepted_at is not null)
        or
        (verification_status = 'rejected'
          and guardian_accepted_by_id is null
          and guardian_accepted_at is null)
      )
    )
  );

create or replace function public.guard_resident_guardian_link_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- The API's service-role client has no end-user auth.uid(); its controller
  -- and service enforce the same transitions. Direct authenticated table
  -- writes are constrained here as defense in depth.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.verification_status not in ('pending_guardian_acceptance', 'pending_verification')
      or new.verified_by_id is not null
      or new.verified_at is not null then
      raise exception 'Guardian links must be created pending review';
    end if;
    if new.guardian_auth_user_id is not null
      and new.verification_status <> 'pending_guardian_acceptance' then
      raise exception 'An account link must await account-holder acceptance';
    end if;
    if new.guardian_accepted_by_id is not null or new.guardian_accepted_at is not null then
      raise exception 'Guardian acceptance cannot be recorded at creation';
    end if;
    return new;
  end if;

  if old.verification_status = 'pending_guardian_acceptance'
    and old.guardian_auth_user_id = auth.uid() then
    if new.verification_status not in ('pending_verification', 'rejected')
      or new.guardian_auth_user_id is distinct from old.guardian_auth_user_id
      or (
        to_jsonb(new) - array['verification_status', 'verification_note',
          'guardian_accepted_by_id', 'guardian_accepted_at', 'updated_at']
      ) is distinct from (
        to_jsonb(old) - array['verification_status', 'verification_note',
          'guardian_accepted_by_id', 'guardian_accepted_at', 'updated_at']
      ) then
      raise exception 'The account holder may only accept or decline this request';
    end if;
    if new.verification_status = 'pending_verification'
      and (new.guardian_accepted_by_id is distinct from auth.uid() or new.guardian_accepted_at is null) then
      raise exception 'Acceptance must be recorded by the linked account holder';
    end if;
    if new.verification_status = 'rejected'
      and (new.guardian_accepted_by_id is not null or new.guardian_accepted_at is not null) then
      raise exception 'A declined request cannot record acceptance';
    end if;
    return new;
  end if;

  if (public.is_admin() or (
      public.is_staff_active()
      and public.profile_role() in ('health_supervisor', 'phn')
    ))
    and old.verification_status = 'pending_verification'
    and new.verification_status in ('pending_verification', 'verified', 'rejected')
    and new.guardian_auth_user_id is not distinct from old.guardian_auth_user_id
    and new.guardian_accepted_by_id is not distinct from old.guardian_accepted_by_id
    and new.guardian_accepted_at is not distinct from old.guardian_accepted_at then
    return new;
  end if;

  raise exception 'Unauthorized guardian link transition';
end;
$$;

drop trigger if exists resident_guardian_links_mutation_guard on public.resident_guardian_links;
create trigger resident_guardian_links_mutation_guard
  before insert or update on public.resident_guardian_links
  for each row execute function public.guard_resident_guardian_link_mutation();

commit;

-- Reversal (only after any accepted workflow records have been exported or
-- intentionally discarded):
-- begin;
--   drop policy if exists resident_guardian_links_guardian_select on public.resident_guardian_links;
--   drop trigger if exists resident_guardian_links_mutation_guard on public.resident_guardian_links;
--   drop function if exists public.guard_resident_guardian_link_mutation();
--   drop policy if exists resident_guardian_links_update on public.resident_guardian_links;
--   create policy resident_guardian_links_update on public.resident_guardian_links
--     for update to authenticated
--     using (public.is_admin() or (public.is_staff_active()
--       and public.profile_role() in ('health_supervisor', 'phn')
--       and exists (select 1 from public.residents r where r.id = resident_guardian_links.minor_resident_id
--         and public.profile_covers_barangay(r.barangay_id))))
--     with check (public.is_admin() or (public.is_staff_active()
--       and public.profile_role() in ('health_supervisor', 'phn')
--       and exists (select 1 from public.residents r where r.id = resident_guardian_links.minor_resident_id
--         and public.profile_covers_barangay(r.barangay_id))));
--   drop index if exists public.resident_guardian_links_guardian_auth_user_idx;
--   drop index if exists public.resident_guardian_links_one_active_per_minor;
--   alter table public.resident_guardian_links
--     drop constraint if exists resident_guardian_links_verification_status_check,
--     drop constraint if exists resident_guardian_links_acceptance_state_check,
--     drop column if exists guardian_auth_user_id,
--     drop column if exists guardian_accepted_by_id,
--     drop column if exists guardian_accepted_at;
--   alter table public.residents
--     drop column if exists minor_verification_method,
--     drop column if exists minor_alternative_status,
--     drop column if exists minor_alternative_reason,
--     drop column if exists minor_alternative_reviewed_by,
--     drop column if exists minor_alternative_reviewed_at;
--   alter table public.residents drop constraint if exists residents_guardian_status_check;
--   alter table public.residents
--     add constraint residents_guardian_status_check
--     check (guardian_status is null or guardian_status in ('pending_verification', 'verified', 'rejected'));
--   alter table public.documents drop constraint if exists documents_document_type_check;
--   alter table public.documents add constraint documents_document_type_check check (document_type in (
--     'proof_of_residency', 'barangay_certificate', 'barangay_clearance', 'government_id', 'other',
--     'government_id_front', 'government_id_back', 'identity_photo',
--     'transfer_previous_health_record', 'transfer_proof_of_address'
--   ));
-- commit;
