-- KALUSAGAP - Health Supervisor operational records
-- Additive only: no existing resident, household, visit, referral, or Auth row
-- is deleted or rewritten. Every resident-linked table copies scope from the
-- resident through a trigger so callers cannot select an arbitrary barangay.

begin;

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,
  purpose text not null default '',
  scheduled_date date not null,
  scheduled_time time,
  location text not null default '',
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High')),
  status text not null default 'Scheduled' check (status in ('Scheduled', 'Today', 'Upcoming', 'Ongoing', 'Completed', 'Missed', 'Cancelled')),
  assigned_provider text not null default '',
  notes text not null default '',
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tcl_entries (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,
  program text not null,
  assigned_bhw text not null default '',
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High')),
  status text not null default 'Active' check (status in ('Active', 'Inactive', 'Completed', 'Transferred')),
  last_visit date,
  next_visit date,
  next_visit_time time,
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.maternal_records (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,
  lmp date,
  edd date,
  prenatal_visits integer not null default 0 check (prenatal_visits >= 0),
  risk text not null default 'Low',
  status text not null default 'Active',
  notes text not null default '',
  provider text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.immunizations (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,
  vaccine text not null,
  administered_date date,
  provider text not null default '',
  dose text not null default '',
  status text not null default 'Due' check (status in ('Due', 'Completed', 'Missed')),
  next_dose date,
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'information',
  title text not null,
  message text not null default '',
  related_type text not null default '',
  related_id text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.health_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  municipality_id uuid,
  barangay_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.sync_operational_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.residents%rowtype;
begin
  select * into r from public.residents where id = new.resident_id;
  if not found then raise exception 'operational record: resident not found'; end if;
  new.municipality_id := r.municipality_id;
  new.barangay_id := r.barangay_id;
  return new;
end; $$;

create trigger follow_ups_scope before insert or update on public.follow_ups for each row execute function public.sync_operational_scope();
create trigger tcl_entries_scope before insert or update on public.tcl_entries for each row execute function public.sync_operational_scope();
create trigger maternal_records_scope before insert or update on public.maternal_records for each row execute function public.sync_operational_scope();
create trigger immunizations_scope before insert or update on public.immunizations for each row execute function public.sync_operational_scope();

create trigger follow_ups_updated before update on public.follow_ups for each row execute function public.set_updated_at();
create trigger tcl_entries_updated before update on public.tcl_entries for each row execute function public.set_updated_at();
create trigger maternal_records_updated before update on public.maternal_records for each row execute function public.set_updated_at();
create trigger immunizations_updated before update on public.immunizations for each row execute function public.set_updated_at();

create index follow_ups_scope_idx on public.follow_ups(barangay_id, scheduled_date);
create index tcl_entries_scope_idx on public.tcl_entries(barangay_id, program);
create index maternal_records_scope_idx on public.maternal_records(barangay_id);
create index immunizations_scope_idx on public.immunizations(barangay_id, administered_date);
create index notifications_recipient_idx on public.notifications(recipient_id, created_at desc);
create index health_audit_entity_idx on public.health_audit_logs(entity_type, entity_id, created_at desc);

do $$
declare table_name text;
begin
  foreach table_name in array array['follow_ups','tcl_entries','maternal_records','immunizations'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format($policy$
      create policy %I_select on public.%I for select to authenticated using (
        public.is_admin() or (
          public.is_staff_active() and (
            (public.profile_role() in ('mho','phn','rhu_personnel') and municipality_id = public.profile_municipality_id())
            or (public.profile_role() in ('health_supervisor','bhw') and barangay_id = public.profile_barangay_id())
          )
        ) or exists (select 1 from public.residents r where r.id = %I.resident_id and r.auth_user_id = auth.uid())
      )
    $policy$, table_name, table_name, table_name);
    execute format($policy$
      create policy %I_insert on public.%I for insert to authenticated with check (
        public.is_staff_active() and public.profile_covers_barangay(barangay_id)
      )
    $policy$, table_name, table_name);
    execute format($policy$
      create policy %I_update on public.%I for update to authenticated using (
        public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
      ) with check (
        public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
      )
    $policy$, table_name, table_name);
  end loop;
end $$;

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated using (recipient_id = auth.uid() or public.is_admin());
create policy notifications_update_own on public.notifications for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

alter table public.health_audit_logs enable row level security;
create policy health_audit_select_staff on public.health_audit_logs for select to authenticated using (public.is_admin() or public.is_staff_active());

commit;