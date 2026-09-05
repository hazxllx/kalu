begin;

alter table public.municipality_onboarding_requests
  drop constraint if exists municipality_onboarding_requests_status_check;
alter table public.municipality_onboarding_requests
  add constraint municipality_onboarding_requests_status_check
  check (status in ('pending_mho_verification', 'under_mho_review', 'under_phn_verification', 'returned_for_correction', 'approved', 'rejected'));

alter table public.municipality_onboarding_requests
  add column if not exists municipality_address text not null default '',
  add column if not exists mho_name text not null default '',
  add column if not exists mho_email text not null default '',
  add column if not exists phn_name text not null default '',
  add column if not exists phn_email text not null default '',
  add column if not exists registered_barangays jsonb not null default '[]'::jsonb,
  add column if not exists mho_token_hash text,
  add column if not exists mho_token_expires_at timestamptz,
  add column if not exists mho_token_used_at timestamptz,
  add column if not exists phn_token_hash text,
  add column if not exists phn_token_expires_at timestamptz,
  add column if not exists phn_token_used_at timestamptz;

create unique index if not exists onboarding_mho_token_hash_idx
  on public.municipality_onboarding_requests(mho_token_hash)
  where mho_token_hash is not null;
create unique index if not exists onboarding_phn_token_hash_idx
  on public.municipality_onboarding_requests(phn_token_hash)
  where phn_token_hash is not null;

create table if not exists public.municipality_onboarding_audit (
  id bigint generated always as identity primary key,
  onboarding_id text not null references public.municipality_onboarding_requests(id) on delete cascade,
  actor_type text not null check (actor_type in ('applicant', 'mho', 'phn', 'system')),
  action text not null check (action in ('submitted', 'resubmitted', 'approved', 'correction_requested', 'rejected', 'activated')),
  reason text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists onboarding_audit_request_idx
  on public.municipality_onboarding_audit(onboarding_id, created_at desc);

alter table public.municipality_onboarding_audit enable row level security;
create policy onboarding_audit_reviewers_read on public.municipality_onboarding_audit
  for select to authenticated using (public.jwt_role() in ('mho', 'phn', 'admin'));

commit;
