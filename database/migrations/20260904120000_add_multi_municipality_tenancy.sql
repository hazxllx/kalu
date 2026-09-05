begin;

-- Stable organization hierarchy. Display names are not authorization keys.
create table public.municipalities (
  id text primary key,
  name text not null unique,
  province text not null default 'Camarines Sur',
  status text not null default 'pending' check (status in ('pending', 'approved', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rhus (
  id text primary key,
  municipality_id text not null references public.municipalities(id) on delete restrict,
  name text not null,
  address text not null default '',
  contact_number text not null default '',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (municipality_id, name)
);

create table public.barangays (
  id text primary key,
  municipality_id text not null references public.municipalities(id) on delete restrict,
  rhu_id text references public.rhus(id) on delete restrict,
  name text not null,
  active boolean not null default true,
  unique (municipality_id, name)
);

create table public.organization_memberships (
  user_id uuid primary key,
  municipality_id text not null references public.municipalities(id) on delete restrict,
  rhu_id text references public.rhus(id) on delete restrict,
  barangay_id text references public.barangays(id) on delete restrict,
  role text not null,
  profession text not null default '',
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.municipality_onboarding_requests (
  id text primary key,
  reference_no text not null unique,
  municipality_name text not null,
  province text not null default 'Camarines Sur',
  municipal_health_office text not null,
  rhu_name text not null,
  rhu_address text not null,
  rhu_contact text not null,
  barangay_count integer not null check (barangay_count > 0),
  authorized_representative text not null,
  representative_position text not null,
  representative_contact text not null,
  representative_email text not null,
  official_municipal_email text not null,
  status text not null default 'pending_mho_verification' check (status in ('pending_mho_verification', 'under_mho_review', 'under_phn_verification', 'returned_for_correction', 'approved', 'rejected')),
  mho_reviewed_by uuid,
  mho_reviewed_at timestamptz,
  mho_reason text not null default '',
  phn_reviewed_by uuid,
  phn_reviewed_at timestamptz,
  phn_reason text not null default '',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index onboarding_status_idx on public.municipality_onboarding_requests(status);
create index rhus_municipality_idx on public.rhus(municipality_id);
create index barangays_municipality_idx on public.barangays(municipality_id);

insert into public.record_counters (name, value) values ('onboarding', 0)
on conflict (name) do nothing;

alter table public.residents add column if not exists municipality_id text references public.municipalities(id);
alter table public.residents add column if not exists rhu_id text references public.rhus(id);
alter table public.residents add column if not exists barangay_id text references public.barangays(id);
alter table public.visits add column if not exists municipality_id text references public.municipalities(id);
alter table public.visits add column if not exists rhu_id text references public.rhus(id);
alter table public.visits add column if not exists barangay_id text references public.barangays(id);
alter table public.referrals add column if not exists municipality_id text references public.municipalities(id);
alter table public.referrals add column if not exists rhu_id text references public.rhus(id);

insert into public.municipalities (id, name, province, status)
values ('mun-pili', 'Municipality of Pili', 'Camarines Sur', 'approved')
on conflict (id) do nothing;
insert into public.rhus (id, municipality_id, name, address)
values ('rhu-pili-main', 'mun-pili', 'Pili Rural Health Unit', 'Pili, Camarines Sur')
on conflict (id) do nothing;
insert into public.barangays (id, municipality_id, rhu_id, name)
values
  ('brgy-pili-san-isidro', 'mun-pili', 'rhu-pili-main', 'San Isidro'),
  ('brgy-pili-san-jose', 'mun-pili', 'rhu-pili-main', 'San Jose'),
  ('brgy-pili-cadlan', 'mun-pili', 'rhu-pili-main', 'Cadlan'),
  ('brgy-pili-talisay', 'mun-pili', 'rhu-pili-main', 'Talisay')
on conflict (id) do nothing;

update public.residents set municipality_id = 'mun-pili', rhu_id = 'rhu-pili-main'
where municipality_id is null;
update public.visits v set municipality_id = r.municipality_id, rhu_id = r.rhu_id, barangay_id = b.id
from public.residents r left join public.barangays b on b.municipality_id = r.municipality_id and b.name = r.barangay
where v.resident_id = r.id and v.municipality_id is null;
update public.referrals f set municipality_id = v.municipality_id, rhu_id = v.rhu_id
from public.visits v where f.visit_id = v.id and f.municipality_id is null;

create or replace function public.jwt_municipality_id()
returns text language sql stable as $$
  select nullif(coalesce(auth.jwt() -> 'app_metadata' ->> 'municipality_id', auth.jwt() ->> 'municipality_id'), '')
$$;
create or replace function public.jwt_rhu_id()
returns text language sql stable as $$
  select nullif(coalesce(auth.jwt() -> 'app_metadata' ->> 'rhu_id', auth.jwt() ->> 'rhu_id'), '')
$$;
create or replace function public.jwt_barangay_id()
returns text language sql stable as $$
  select nullif(coalesce(auth.jwt() -> 'app_metadata' ->> 'barangay_id', auth.jwt() ->> 'barangay_id'), '')
$$;

alter table public.municipalities enable row level security;
alter table public.rhus enable row level security;
alter table public.barangays enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.municipality_onboarding_requests enable row level security;

create policy municipality_members_read on public.municipalities for select to authenticated
using (id = public.jwt_municipality_id());
create policy organization_members_read on public.organization_memberships for select to authenticated
using (municipality_id = public.jwt_municipality_id());
create policy rhus_members_read on public.rhus for select to authenticated
using (municipality_id = public.jwt_municipality_id());
create policy barangays_members_read on public.barangays for select to authenticated
using (municipality_id = public.jwt_municipality_id());

-- Public submission is performed by the API service role; reviewers are scoped
-- to the organization claims in their verified token.
create policy onboarding_reviewers_read on public.municipality_onboarding_requests for select to authenticated
using (public.jwt_role() in ('mho', 'phn') and (status <> 'approved' or municipality_name = 'Municipality of Pili'));

drop policy if exists residents_select_staff on public.residents;
create policy residents_select_staff on public.residents for select to authenticated
using (public.jwt_role() in ('admin', 'mho', 'health_supervisor', 'phn', 'rhu_personnel', 'bhw') and municipality_id = public.jwt_municipality_id()
  and (public.jwt_barangay_id() is null or barangay_id = public.jwt_barangay_id()));
drop policy if exists residents_insert_staff on public.residents;
create policy residents_insert_staff on public.residents for insert to authenticated
with check (public.jwt_role() in ('health_supervisor', 'phn', 'rhu_personnel', 'bhw') and municipality_id = public.jwt_municipality_id()
  and (public.jwt_barangay_id() is null or barangay_id = public.jwt_barangay_id()));
drop policy if exists residents_update_staff on public.residents;
create policy residents_update_staff on public.residents for update to authenticated
using (public.jwt_role() in ('admin', 'phn', 'health_supervisor') and municipality_id = public.jwt_municipality_id()
  and (public.jwt_barangay_id() is null or barangay_id = public.jwt_barangay_id()));

commit;