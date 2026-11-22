begin;

alter table public.notifications
  add column if not exists event_key text;

update public.notifications
set event_key = 'legacy:' || id::text
where event_key is null;

alter table public.notifications
  alter column event_key set default gen_random_uuid()::text,
  alter column event_key set not null;

create unique index if not exists notifications_recipient_event_key_uidx
  on public.notifications(recipient_id, event_key);

create or replace function public.enforce_resident_birth_date_range()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  manila_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if new.birth_date is null then
    return new;
  end if;

  if not isfinite(new.birth_date) or new.birth_date > manila_today then
    raise exception 'Resident date of birth must be a finite date that is not in the future.'
      using errcode = '23514';
  end if;

  if new.birth_date < (manila_today - interval '120 years')::date then
    raise exception 'Resident date of birth cannot be more than 120 years ago.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists residents_birth_date_range on public.residents;
create trigger residents_birth_date_range
  before insert or update of birth_date on public.residents
  for each row execute function public.enforce_resident_birth_date_range();

commit;
