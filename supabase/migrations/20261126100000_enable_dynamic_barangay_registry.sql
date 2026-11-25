begin;

-- Barangays are database master data, not a hardcoded allowlist. Keep the
-- existing approved_barangay_names table for backward compatibility, but stop
-- using it to gate registry rows and assignments.
drop trigger if exists barangays_approved_registry_guard on public.barangays;

create or replace function public.guard_approved_barangay_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.barangays%rowtype;
begin
  if tg_op = 'UPDATE'
     and new.barangay_id is not distinct from old.barangay_id
     and new.barangay is not distinct from old.barangay then
    return new;
  end if;

  if new.barangay_id is not null then
    select * into target from public.barangays where id = new.barangay_id;
    if not found or target.status <> 'Active' then
      raise exception 'New barangay assignments must target an active barangay.';
    end if;
    new.barangay := target.name;
  elsif nullif(btrim(new.barangay), '') is not null then
    select * into target from public.barangays
    where lower(name) = lower(btrim(new.barangay)) and status = 'Active'
    limit 1;
    if not found then
      raise exception 'New barangay assignments must target an active barangay.';
    end if;
    new.barangay_id := target.id;
    new.barangay := target.name;
  end if;
  return new;
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
    if not exists (select 1 from public.barangays where id = new.to_barangay_id and status = 'Active') then
      raise exception 'Residency transfers must target an active barangay.';
    end if;
  end if;
  return new;
end;
$$;

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
    when not exists (select 1 from public.barangays b where b.id = target_barangay and b.status = 'Active') then false
    when public.profile_role() in ('mho', 'phn', 'rhu_personnel') then
      exists (select 1 from public.barangays b where b.id = target_barangay and b.municipality_id = public.profile_municipality_id())
    when public.profile_role() in ('health_supervisor', 'bhw') then target_barangay = public.profile_barangay_id()
    else false
  end;
$$;

commit;
