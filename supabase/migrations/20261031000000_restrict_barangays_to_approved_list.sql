begin;

create table if not exists public.approved_barangay_names (
  name text primary key,
  created_at timestamptz not null default now()
);

alter table public.approved_barangay_names enable row level security;
revoke all on table public.approved_barangay_names from public, anon, authenticated;
grant select on table public.approved_barangay_names to service_role;

insert into public.approved_barangay_names (name)
values ('San Antonio'), ('San Isidro'), ('Old San Roque')
on conflict (name) do nothing;

delete from public.approved_barangay_names
where name not in ('San Antonio', 'San Isidro', 'Old San Roque');

create or replace function public.is_approved_barangay_name(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.approved_barangay_names approved
    where approved.name = p_name
  );
$$;

revoke all on function public.is_approved_barangay_name(text) from public, anon, authenticated;
grant execute on function public.is_approved_barangay_name(text) to service_role;

-- Keep all historic registry rows and dependent records; only approved
-- existing registry rows remain active/selectable. Do not create registry rows
-- for approved names that are not registered in this municipality.
update public.barangays
set status = 'Inactive', updated_at = now()
where not public.is_approved_barangay_name(name)
  and status <> 'Inactive';

create or replace function public.guard_barangay_registry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Barangay registry rows are retained for historical integrity; deactivate instead.';
  end if;

  if not public.is_approved_barangay_name(new.name) then
    if tg_op = 'INSERT' or new.name is distinct from old.name or new.status = 'Active' then
      raise exception 'Only approved barangay names may be added or activated.';
    end if;
  elsif new.status <> 'Active' then
    raise exception 'Official barangays cannot be deactivated.';
  end if;

  return new;
end;
$$;

drop trigger if exists barangays_approved_registry_guard on public.barangays;
create trigger barangays_approved_registry_guard
before insert or update or delete on public.barangays
for each row execute function public.guard_barangay_registry();

create or replace function public.guard_approved_barangay_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_json jsonb := to_jsonb(new);
  previous_json jsonb;
  assignment_id text;
  previous_assignment_id text;
  barangay_name text;
  previous_barangay_name text;
  registry_name text;
  registry_status text;
begin
  if tg_op = 'UPDATE' then
    previous_json := to_jsonb(old);
    previous_assignment_id := previous_json ->> 'barangay_id';
    previous_barangay_name := previous_json ->> 'barangay';
  end if;

  assignment_id := row_json ->> 'barangay_id';
  barangay_name := row_json ->> 'barangay';

  if tg_op = 'UPDATE'
     and assignment_id is not distinct from previous_assignment_id
     and barangay_name is not distinct from previous_barangay_name then
    return new;
  end if;

  if assignment_id is not null then
    select b.name, b.status
      into registry_name, registry_status
    from public.barangays b
    where b.id::text = assignment_id;

    if not found
       or registry_status <> 'Active'
       or not public.is_approved_barangay_name(registry_name)
       or (
         nullif(btrim(barangay_name), '') is not null
         and barangay_name is distinct from registry_name
       ) then
      raise exception 'New barangay assignments must target an approved active barangay.';
    end if;
  elsif nullif(btrim(barangay_name), '') is not null then
    if not public.is_approved_barangay_name(barangay_name)
       or not exists (
         select 1 from public.barangays b
         where lower(b.name) = lower(btrim(barangay_name))
           and b.status = 'Active'
       ) then
      raise exception 'New barangay assignments must target an approved active barangay.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_approved_barangay_assignment() from public, anon, authenticated;

do $$
declare
  target record;
begin
  for target in
    select distinct c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
     and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.column_name = 'barangay_id'
      and c.table_name <> 'barangays'
  loop
    execute format(
      'drop trigger if exists approved_barangay_assignment_guard on public.%I',
      target.table_name
    );
    execute format(
      'create trigger approved_barangay_assignment_guard
       before insert or update on public.%I
       for each row execute function public.guard_approved_barangay_assignment()',
      target.table_name
    );
  end loop;
end;
$$;

create or replace function public.guard_transfer_destination_barangay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.to_barangay_id is distinct from old.to_barangay_id then
    if not exists (
      select 1 from public.barangays b
      where b.id = new.to_barangay_id
        and b.status = 'Active'
        and public.is_approved_barangay_name(b.name)
    ) then
      raise exception 'Residency transfers must target an approved active barangay.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_transfer_destination_barangay() from public, anon, authenticated;
drop trigger if exists transfer_requests_approved_destination_guard on public.transfer_requests;
create trigger transfer_requests_approved_destination_guard
before insert or update on public.transfer_requests
for each row execute function public.guard_transfer_destination_barangay();

create or replace function public.profile_covers_barangay(target_barangay uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_admin() then true
    when not public.is_staff_active() then false
    when target_barangay is null then false
    when not exists (
      select 1 from public.barangays b
      where b.id = target_barangay
        and b.status = 'Active'
        and public.is_approved_barangay_name(b.name)
    ) then false
    when public.profile_role() in ('mho', 'phn', 'rhu_personnel') then
      exists (
        select 1 from public.barangays b
        where b.id = target_barangay
          and b.municipality_id = public.profile_municipality_id()
      )
    when public.profile_role() in ('health_supervisor', 'bhw') then
      target_barangay = public.profile_barangay_id()
    else false
  end;
$$;

comment on table public.approved_barangay_names is
  'Approved selectable barangay names; legacy barangay registry rows remain inactive for history.';
comment on function public.guard_approved_barangay_assignment() is
  'Rejects new or changed barangay assignments to unapproved or inactive rows while preserving unchanged legacy assignments.';

commit;
