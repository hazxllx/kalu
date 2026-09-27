-- KALUSAGAP - reviewed transfer of residency workflow

begin;

create table public.transfer_requests (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'under_review', 'approved', 'rejected', 'cancelled')),
  otp_hash text,
  otp_expires_at timestamptz,
  otp_attempts integer not null default 0 check (otp_attempts >= 0),
  otp_verified_at timestamptz,
  otp_locked_until timestamptz,
  target_resident_id text references public.residents(id) on delete restrict,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index transfer_requests_one_open_per_user
  on public.transfer_requests(auth_user_id)
  where status in ('pending', 'under_review');
create index transfer_requests_status_idx on public.transfer_requests(status, created_at desc);
create index transfer_requests_auth_user_idx on public.transfer_requests(auth_user_id, created_at desc);
create trigger transfer_requests_set_updated_at before update on public.transfer_requests
  for each row execute function public.set_updated_at();

alter table public.documents add column if not exists transfer_request_id uuid references public.transfer_requests(id) on delete cascade;
alter table public.documents drop constraint if exists documents_single_parent_check;
alter table public.documents add constraint documents_single_parent_check check (
  (application_id is not null)::int + (resident_id is not null)::int + (transfer_request_id is not null)::int = 1
);
alter table public.documents drop constraint if exists documents_document_type_check;
alter table public.documents add constraint documents_document_type_check check (document_type in (
  'proof_of_residency', 'barangay_certificate', 'barangay_clearance', 'government_id',
  'government_id_front', 'government_id_back', 'identity_photo', 'other',
  'transfer_previous_health_record', 'transfer_proof_of_address'
));
create index documents_transfer_request_id_idx on public.documents(transfer_request_id);

create table public.transfer_request_audit_logs (
  id uuid primary key default gen_random_uuid(),
  transfer_request_id uuid not null references public.transfer_requests(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index transfer_request_audit_request_idx on public.transfer_request_audit_logs(transfer_request_id, created_at desc);

alter table public.transfer_requests enable row level security;
alter table public.transfer_request_audit_logs enable row level security;

create policy transfer_requests_select on public.transfer_requests for select to authenticated using (
  auth_user_id = auth.uid() or public.is_admin()
  or (public.is_staff_active() and public.profile_role() in ('mho', 'phn', 'health_supervisor'))
);
create policy transfer_request_audit_select on public.transfer_request_audit_logs for select to authenticated using (
  public.is_admin()
  or exists (select 1 from public.transfer_requests tr where tr.id = transfer_request_audit_logs.transfer_request_id and tr.auth_user_id = auth.uid())
  or (public.is_staff_active() and public.profile_role() in ('mho', 'phn', 'health_supervisor'))
);
create policy documents_transfer_select on public.documents for select to authenticated using (
  exists (select 1 from public.transfer_requests tr where tr.id = documents.transfer_request_id and (
    tr.auth_user_id = auth.uid() or public.is_admin()
    or (public.is_staff_active() and public.profile_role() in ('mho', 'phn', 'health_supervisor'))
  ))
);

create or replace function public.approve_transfer_request(p_request_id uuid, p_reviewer_id uuid, p_resident_id text)
returns public.transfer_requests
language plpgsql security definer set search_path = public
as $$
declare request_row public.transfer_requests; linked_resident public.residents;
begin
  select * into request_row from public.transfer_requests where id = p_request_id for update;
  if not found or request_row.status not in ('pending', 'under_review') or request_row.otp_verified_at is null then return null; end if;
  if not exists (select 1 from public.documents where transfer_request_id = p_request_id and document_type = 'government_id_front' and verification_status = 'pending')
     or not exists (select 1 from public.documents where transfer_request_id = p_request_id and document_type = 'government_id_back' and verification_status = 'pending')
     or not exists (select 1 from public.documents where transfer_request_id = p_request_id and document_type = 'transfer_previous_health_record' and verification_status = 'pending')
     or not exists (select 1 from public.documents where transfer_request_id = p_request_id and document_type = 'transfer_proof_of_address' and verification_status = 'pending') then return null; end if;
  update public.residents set auth_user_id = request_row.auth_user_id, updated_at = now()
    where id = p_resident_id and auth_user_id is null returning * into linked_resident;
  if not found then return null; end if;
  update public.transfer_requests set status = 'approved', target_resident_id = linked_resident.id,
    reviewed_by = p_reviewer_id, reviewed_at = now(), updated_at = now() where id = p_request_id returning * into request_row;
  return request_row;
end; $$;

revoke execute on function public.approve_transfer_request(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_transfer_request(uuid, uuid, text) to service_role;

commit;