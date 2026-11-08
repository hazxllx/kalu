-- Stable worker relationships with preserved historical name snapshots.
-- Ambiguous name-only historical assignments are intentionally not guessed.
begin;

alter table public.tcl_entries
  add column if not exists assigned_bhw_id uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_bhw_name text not null default '';
alter table public.household_risk_workflow
  add column if not exists assigned_worker_id uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_worker_name text not null default '';

create index if not exists tcl_entries_assigned_bhw_id_idx on public.tcl_entries(assigned_bhw_id) where assigned_bhw_id is not null;
create index if not exists household_risk_assigned_worker_id_idx on public.household_risk_workflow(assigned_worker_id) where assigned_worker_id is not null;

-- Only exact already-recorded account UUIDs are linked; names are never used as
-- identity keys. Existing display text and unresolvable historical work survive.
update public.tcl_entries t
set assigned_bhw_id = p.id, assigned_bhw_name = coalesce(nullif(p.full_name, ''), t.assigned_bhw)
from public.profiles p, public.residents r
where t.resident_id = r.id and t.assigned_bhw_id is null
  and t.assigned_bhw = p.id::text and p.role::text = 'bhw'
  and p.municipality_id = r.municipality_id and p.barangay_id = r.barangay_id;

update public.household_risk_workflow w
set assigned_worker_id = p.id, assigned_worker_name = coalesce(nullif(p.full_name, ''), w.assigned_worker)
from public.profiles p, public.households h
where w.household_id = h.id and w.assigned_worker_id is null
  and w.assigned_worker = p.id::text and p.municipality_id = h.municipality_id
  and (p.role::text = 'phn' or (p.role::text in ('bhw', 'health_supervisor') and p.barangay_id = h.barangay_id));

create or replace function public.guard_authorized_worker_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  worker_id uuid;
  worker public.profiles%rowtype;
  municipality_id uuid;
  barangay_id uuid;
begin
  if tg_table_name = 'tcl_entries' then
    worker_id := new.assigned_bhw_id;
    if tg_op = 'UPDATE' and worker_id is not distinct from old.assigned_bhw_id then
      new.assigned_bhw_name := old.assigned_bhw_name;
      new.assigned_bhw := old.assigned_bhw;
      return new;
    end if;
    select r.municipality_id, r.barangay_id into municipality_id, barangay_id
      from public.residents r where r.id = new.resident_id;
  else
    worker_id := new.assigned_worker_id;
    if tg_op = 'UPDATE' and worker_id is not distinct from old.assigned_worker_id then
      new.assigned_worker_name := old.assigned_worker_name;
      new.assigned_worker := old.assigned_worker;
      new.assigned_worker_role := old.assigned_worker_role;
      return new;
    end if;
    select h.municipality_id, h.barangay_id into municipality_id, barangay_id
      from public.households h where h.id = new.household_id;
  end if;

  if worker_id is null then
    if tg_table_name = 'tcl_entries' then
      if tg_op = 'UPDATE' and new.assigned_bhw_name is not distinct from old.assigned_bhw_name then
        return new; -- ON DELETE SET NULL preserves the historical name snapshot.
      end if;
      if tg_op = 'INSERT' and coalesce(new.assigned_bhw, '') <> '' then
        raise exception using errcode = '23514', message = 'Select an authorized worker account, not a name.';
      end if;
      new.assigned_bhw_name := '';
      new.assigned_bhw := '';
    else
      if tg_op = 'UPDATE' and new.assigned_worker_name is not distinct from old.assigned_worker_name then
        return new;
      end if;
      if tg_op = 'INSERT' and coalesce(new.assigned_worker, '') <> '' then
        raise exception using errcode = '23514', message = 'Select an authorized worker account, not a name.';
      end if;
      new.assigned_worker_name := '';
      new.assigned_worker := '';
      new.assigned_worker_role := '';
    end if;
    return new;
  end if;

  select * into worker from public.profiles where id = worker_id;
  if not found or worker.status::text is distinct from 'active' or municipality_id is null
    or worker.municipality_id is distinct from municipality_id
    or (worker.role::text is distinct from 'phn' and barangay_id is null)
    or (tg_table_name = 'tcl_entries' and (worker.role::text is distinct from 'bhw' or worker.barangay_id is distinct from barangay_id))
    or (tg_table_name = 'household_risk_workflow' and not (
      coalesce(worker.role::text, '') = 'phn' or (coalesce(worker.role::text, '') in ('bhw', 'health_supervisor') and worker.barangay_id = barangay_id)
    )) then
    raise exception using errcode = '23514', message = 'The assigned worker is inactive or outside the authorized scope.';
  end if;

  if tg_table_name = 'tcl_entries' then
    new.assigned_bhw_name := worker.full_name;
    new.assigned_bhw := worker.full_name;
  else
    new.assigned_worker_name := worker.full_name;
    new.assigned_worker := worker.full_name;
    new.assigned_worker_role := worker.role::text;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_authorized_worker_assignment() from public, anon, authenticated;
grant execute on function public.guard_authorized_worker_assignment() to service_role;

drop trigger if exists tcl_entries_authorized_worker on public.tcl_entries;
create trigger tcl_entries_authorized_worker before insert or update on public.tcl_entries
  for each row execute function public.guard_authorized_worker_assignment();
drop trigger if exists household_risk_authorized_worker on public.household_risk_workflow;
create trigger household_risk_authorized_worker before insert or update on public.household_risk_workflow
  for each row execute function public.guard_authorized_worker_assignment();

commit;
notify pgrst, 'reload schema';

-- Non-destructive rollback after reverting application assignment writers:
-- DROP TRIGGER IF EXISTS tcl_entries_authorized_worker ON public.tcl_entries;
-- DROP TRIGGER IF EXISTS household_risk_authorized_worker ON public.household_risk_workflow;
-- DROP FUNCTION IF EXISTS public.guard_authorized_worker_assignment();
-- Retain relationship columns and snapshots so historical assignments are not lost.
