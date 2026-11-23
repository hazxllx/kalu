begin;

alter table public.immunizations
  add column if not exists vaccine_selection text,
  add column if not exists custom_vaccine_name text;

update public.immunizations
  set vaccine_selection = vaccine
  where vaccine_selection is null or btrim(vaccine_selection) = '';

alter table public.immunizations
  alter column vaccine_selection set not null,
  alter column vaccine_selection set default '';

alter table public.immunizations
  drop constraint if exists immunizations_status_check;
alter table public.immunizations
  add constraint immunizations_status_check
  check (status in ('Due', 'Completed', 'Missed', 'Cancelled'));

create or replace function public.normalize_immunization_vaccine()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.vaccine_selection is null or btrim(new.vaccine_selection) = '' then
    new.vaccine_selection := new.vaccine;
  end if;

  if new.vaccine_selection = 'Other' then
    new.custom_vaccine_name := nullif(btrim(new.custom_vaccine_name), '');
    if new.custom_vaccine_name is null then
      raise exception using errcode = '23514', message = 'A custom vaccine name is required when Other is selected.';
    end if;
    new.vaccine := new.custom_vaccine_name;
  else
    new.vaccine := new.vaccine_selection;
    new.custom_vaccine_name := null;
  end if;
  return new;
end;
$$;

drop trigger if exists immunizations_normalize_vaccine on public.immunizations;
create trigger immunizations_normalize_vaccine
  before insert or update of vaccine, vaccine_selection, custom_vaccine_name
  on public.immunizations
  for each row execute function public.normalize_immunization_vaccine();

create table if not exists public.immunization_reminders (
  id uuid primary key default gen_random_uuid(),
  immunization_id uuid not null,
  recipient_id uuid not null,
  reminder_type text not null check (reminder_type in ('three_days', 'one_day', 'due_today')),
  scheduled_dose date not null,
  scheduled_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'delivered', 'cancelled', 'expired')),
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (immunization_id, reminder_type, scheduled_dose)
);

create index if not exists immunization_reminders_due_idx
  on public.immunization_reminders (scheduled_at, id)
  where status = 'pending';

alter table public.immunization_reminders enable row level security;
revoke all on public.immunization_reminders from public, anon, authenticated;
grant select, insert, update on public.immunization_reminders to service_role;

create or replace function public.sync_immunization_reminders()
returns trigger language plpgsql security definer set search_path = public as $$
declare resident public.residents%rowtype;
  recipient_status text;
  dose_start timestamptz;
  v_reminder_type text;
  reminder_at timestamptz;
  initial_message text;
begin
  if tg_op = 'UPDATE' and (
    (new.resident_id, new.vaccine, new.dose, new.next_dose, new.provider, new.notes, new.status)
      is not distinct from
    (old.resident_id, old.vaccine, old.dose, old.next_dose, old.provider, old.notes, old.status)
  ) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    update public.immunization_reminders
      set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where immunization_id = old.id and status = 'pending';
  end if;

  if new.status = 'Cancelled' or new.next_dose is null
    or new.next_dose < (now() at time zone 'Asia/Manila')::date then
    return new;
  end if;

  select * into resident from public.residents where id = new.resident_id;
  if not found or resident.auth_user_id is null then
    return new;
  end if;

  select p.status into recipient_status
    from public.profiles p
    where p.id = resident.auth_user_id
      and p.role in ('resident', 'resident-limited')
      and p.status = 'active'
      and public.notification_account_can_receive(p.id, resident.municipality_id);
  if recipient_status is distinct from 'active' then
    return new;
  end if;

  initial_message := format(
    'Your next %s vaccination dose%s is scheduled for %s. Please visit your Barangay Health Center on your scheduled date.',
    new.vaccine,
    case when nullif(btrim(new.dose), '') is null then '' else ' (' || btrim(new.dose) || ')' end,
    to_char(new.next_dose, 'FMMonth DD, YYYY')
  );
  if nullif(btrim(new.provider), '') is not null then
    initial_message := initial_message || ' Provider: ' || btrim(new.provider) || '.';
  end if;
  if nullif(btrim(new.notes), '') is not null then
    initial_message := initial_message || ' Instructions: ' || btrim(new.notes);
  end if;

  insert into public.notifications(
    recipient_id, event_key, category, title, message, related_type, related_id
  ) values (
    resident.auth_user_id,
    'immunization:' || new.id::text || ':scheduled:' || new.next_dose::text,
    'reminder',
    'Upcoming Immunization',
    initial_message,
    'immunizations',
    new.id::text
  )
  on conflict (recipient_id, event_key) do nothing;

  dose_start := (new.next_dose::timestamp + interval '9 hours') at time zone 'Asia/Manila';
  foreach v_reminder_type in array array['three_days', 'one_day', 'due_today'] loop
    reminder_at := dose_start - case v_reminder_type
      when 'three_days' then interval '3 days'
      when 'one_day' then interval '1 day'
      else interval '0 days'
    end;
    if v_reminder_type = 'due_today'
      and new.next_dose = (now() at time zone 'Asia/Manila')::date
      and reminder_at <= now() then
      reminder_at := now() + interval '1 minute';
    end if;
    if reminder_at > now() then
      insert into public.immunization_reminders(
        immunization_id, recipient_id, reminder_type, scheduled_dose, scheduled_at, status
      ) values (
        new.id, resident.auth_user_id, v_reminder_type, new.next_dose, reminder_at, 'pending'
      )
      on conflict (immunization_id, reminder_type, scheduled_dose) do update
        set scheduled_at = excluded.scheduled_at,
          status = 'pending', delivered_at = null, cancelled_at = null, updated_at = now()
        where public.immunization_reminders.status in ('cancelled', 'expired');
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists immunizations_schedule_notifications on public.immunizations;
create trigger immunizations_schedule_notifications
  after insert or update of resident_id, vaccine, dose, next_dose, provider, notes, status
  on public.immunizations
  for each row execute function public.sync_immunization_reminders();

create or replace function public.cancel_immunization_reminders()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.immunization_reminders
    set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where immunization_id = old.id and status = 'pending';
  return old;
end;
$$;

drop trigger if exists immunizations_cancel_notifications on public.immunizations;
create trigger immunizations_cancel_notifications
  after delete on public.immunizations
  for each row execute function public.cancel_immunization_reminders();

create or replace function public.deliver_immunization_reminders(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare reminder public.immunization_reminders%rowtype;
  immunization public.immunizations%rowtype;
  recipient_status text;
  v_title text;
  message_text text;
  date_text text;
  inserted integer := 0;
  v_notification_id uuid;
begin
  if p_now is null or not isfinite(p_now) then
    raise exception using errcode = '22023', message = 'Invalid reminder time.';
  end if;

  for reminder in
    select * from public.immunization_reminders
    where status = 'pending' and scheduled_at <= p_now
    order by scheduled_at, id
    for update skip locked
  loop
    select * into immunization
      from public.immunizations where id = reminder.immunization_id for share;
    if not found or immunization.status = 'Cancelled'
      or immunization.next_dose is distinct from reminder.scheduled_dose then
      update public.immunization_reminders
        set status = 'cancelled', cancelled_at = p_now, updated_at = now()
        where id = reminder.id;
      continue;
    end if;

    select p.status into recipient_status
      from public.profiles p
      join public.residents r on r.auth_user_id = p.id
      where p.id = reminder.recipient_id and r.id = immunization.resident_id
        and p.role in ('resident', 'resident-limited')
        and p.status = 'active'
        and public.notification_account_can_receive(p.id, immunization.municipality_id);
    if recipient_status is distinct from 'active' then
      update public.immunization_reminders
        set status = 'expired', updated_at = now()
        where id = reminder.id;
      continue;
    end if;

    date_text := to_char(reminder.scheduled_dose, 'FMMonth DD, YYYY');
    v_title := case reminder.reminder_type
      when 'three_days' then 'Upcoming vaccination reminder'
      when 'one_day' then 'Vaccination scheduled for tomorrow'
      else 'Vaccination due today'
    end;
    message_text := case reminder.reminder_type
      when 'three_days' then format('Your next %s vaccination%s is scheduled in 3 days, on %s.',
        immunization.vaccine, case when nullif(btrim(immunization.dose), '') is null then '' else ' (' || btrim(immunization.dose) || ')' end, date_text)
      when 'one_day' then format('Your next %s vaccination%s is scheduled for tomorrow (%s).',
        immunization.vaccine, case when nullif(btrim(immunization.dose), '') is null then '' else ' (' || btrim(immunization.dose) || ')' end, date_text)
      else format('Your next %s vaccination%s is due today (%s).',
        immunization.vaccine, case when nullif(btrim(immunization.dose), '') is null then '' else ' (' || btrim(immunization.dose) || ')' end, date_text)
    end || ' Please visit your Barangay Health Center on your scheduled date.';
    if nullif(btrim(immunization.provider), '') is not null then
      message_text := message_text || ' Provider: ' || btrim(immunization.provider) || '.';
    end if;
    if nullif(btrim(immunization.notes), '') is not null then
      message_text := message_text || ' Instructions: ' || btrim(immunization.notes);
    end if;

    insert into public.notifications(
      recipient_id, event_key, category, title, message, related_type, related_id
    ) values (
      reminder.recipient_id,
      'immunization:' || reminder.immunization_id::text || ':reminder:' || reminder.reminder_type || ':' || reminder.scheduled_dose::text,
      'reminder',
      v_title,
      message_text,
      'immunizations',
      reminder.immunization_id::text
    )
    on conflict (recipient_id, event_key) do nothing
    returning id into v_notification_id;

    if v_notification_id is not null then inserted := inserted + 1; end if;
    update public.immunization_reminders
      set status = 'delivered', delivered_at = p_now, updated_at = now()
      where id = reminder.id;
  end loop;

  return jsonb_build_object('inserted', inserted);
end;
$$;

revoke all on function public.normalize_immunization_vaccine() from public, anon, authenticated, service_role;
revoke all on function public.sync_immunization_reminders() from public, anon, authenticated, service_role;
revoke all on function public.cancel_immunization_reminders() from public, anon, authenticated, service_role;
revoke all on function public.deliver_immunization_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.deliver_immunization_reminders(timestamptz) to service_role;

create extension if not exists pg_cron with schema pg_catalog;
do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'deliver-immunization-reminders';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'deliver-immunization-reminders',
    '* * * * *',
    'select public.deliver_immunization_reminders();'
  );
end;
$$;

notify pgrst, 'reload schema';
commit;
