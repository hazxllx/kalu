begin;

alter table public.health_services
  add column if not exists registration_capacity integer;

alter table public.health_services
  drop constraint if exists health_services_registration_capacity_check;

alter table public.health_services
  add constraint health_services_registration_capacity_check
  check (registration_capacity is null or registration_capacity between 1 and 1000000);

comment on column public.health_services.registration_capacity is
  'Optional maximum number of active resident registrations (visit_plans with Planned status). Cancelled registrations release capacity.';

create or replace function public.enforce_health_service_registration_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_capacity integer;
  v_count bigint;
begin
  if new.status <> 'Planned' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'Planned'
     and old.service_id = new.service_id then
    return new;
  end if;

  -- Serialize registrations for this service so concurrent sign-ups cannot
  -- both observe the last available place and overbook it.
  select registration_capacity
    into v_capacity
    from public.health_services
   where id = new.service_id
   for update;

  if v_capacity is null then
    return new;
  end if;

  select count(*)
    into v_count
    from public.visit_plans p
   where p.service_id = new.service_id
     and p.status = 'Planned'
     and (tg_op = 'INSERT' or p.id <> new.id);

  if v_count >= v_capacity then
    raise exception using
      errcode = 'P0001',
      message = 'HEALTH_SERVICE_REGISTRATION_CAPACITY_REACHED';
  end if;

  return new;
end;
$function$;

drop trigger if exists visit_plans_capacity_guard on public.visit_plans;
create trigger visit_plans_capacity_guard
  before insert or update of service_id, status on public.visit_plans
  for each row execute function public.enforce_health_service_registration_capacity();

commit;
