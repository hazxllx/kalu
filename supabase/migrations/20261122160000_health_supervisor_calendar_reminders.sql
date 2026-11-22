begin;

-- Retain source and recipient ids after deletion so cancellation failures remain diagnosable.
create table if not exists public.health_supervisor_reminders (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null,
  recipient_id uuid not null,
  scheduled_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'failed', 'cancelled', 'expired')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  last_failed_operation text,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id, recipient_id)
);

create index if not exists health_supervisor_reminders_due_idx
  on public.health_supervisor_reminders(next_attempt_at, scheduled_at, id)
  where status in ('pending', 'failed');

alter table public.health_supervisor_reminders enable row level security;

revoke all on public.health_supervisor_reminders from public, anon, authenticated;

grant select, insert, update on public.health_supervisor_reminders to service_role;

create or replace function public.schedule_calendar_activity_reminder()
returns trigger language plpgsql security definer set search_path = public as $$
declare starts_at timestamptz; reminder_at timestamptz;
begin
  if tg_op = 'UPDATE' then
    if (new.activity_date, new.activity_time, new.created_by)
      is not distinct from (old.activity_date, old.activity_time, old.created_by) then
      return new;
    end if;
    if new.created_by is distinct from old.created_by then
      update public.health_supervisor_reminders
        set status = 'cancelled', next_attempt_at = null, cancelled_at = now(), updated_at = now()
        where activity_id = old.id and recipient_id = old.created_by and status in ('pending', 'failed');
    end if;
  end if;

  starts_at := (new.activity_date + coalesce(new.activity_time, '09:00'::time))
    at time zone 'Asia/Manila';
  reminder_at := starts_at - interval '24 hours';

  insert into public.health_supervisor_reminders(activity_id, recipient_id, scheduled_at, status, next_attempt_at)
  values (new.id, new.created_by, reminder_at,
    case when starts_at > now() then 'pending' else 'expired' end,
    case when starts_at > now() then reminder_at else null end)
  on conflict (activity_id, recipient_id) do update
    set scheduled_at = excluded.scheduled_at,
      status = excluded.status,
      attempts = 0,
      next_attempt_at = excluded.next_attempt_at,
      last_attempt_at = null,
      delivered_at = null,
      cancelled_at = null,
      last_failed_operation = null,
      last_error_code = null,
      last_error_message = null,
      updated_at = now()
    where public.health_supervisor_reminders.status <> 'delivered';
  return new;
end;
$$;

create or replace function public.cancel_calendar_activity_reminder()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.health_supervisor_reminders
    set status = 'cancelled', next_attempt_at = null, cancelled_at = now(), updated_at = now()
    where activity_id = old.id and recipient_id = old.created_by and status in ('pending', 'failed');
  return old;
end;
$$;

drop trigger if exists calendar_activity_schedule_reminder on public.calendar_activities;

create trigger calendar_activity_schedule_reminder
  after insert or update of activity_date, activity_time, created_by on public.calendar_activities
  for each row execute function public.schedule_calendar_activity_reminder();

drop trigger if exists calendar_activity_cancel_reminder on public.calendar_activities;

create trigger calendar_activity_cancel_reminder
  after delete on public.calendar_activities
  for each row execute function public.cancel_calendar_activity_reminder();

insert into public.health_supervisor_reminders(activity_id, recipient_id, scheduled_at, next_attempt_at)
  select a.id, a.created_by,
    ((a.activity_date + coalesce(a.activity_time, '09:00'::time)) at time zone 'Asia/Manila') - interval '24 hours',
    ((a.activity_date + coalesce(a.activity_time, '09:00'::time)) at time zone 'Asia/Manila') - interval '24 hours'
  from public.calendar_activities a
  where (a.activity_date + coalesce(a.activity_time, '09:00'::time)) at time zone 'Asia/Manila' > now()
  on conflict (activity_id, recipient_id) do nothing;

create or replace function public.deliver_calendar_activity_reminders(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare reminder public.health_supervisor_reminders%rowtype;
  activity public.calendar_activities%rowtype;
  municipality_id uuid;
  starts_at timestamptz;
  notification_id uuid;
  attempt integer;
  v_sqlstate text;
  v_error_message text;
  failed_operation text;
  retryable boolean;
  inserted integer := 0;
  failed integer := 0;
  failures jsonb := '[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'The notification worker requires service authorization.';
  end if;
  if p_now is null or not isfinite(p_now) then
    raise exception using errcode = '22023', message = 'Invalid reminder time.';
  end if;

  for reminder in
    select * from public.health_supervisor_reminders
    where status in ('pending', 'failed') and next_attempt_at <= p_now and attempts < 8
    order by next_attempt_at, scheduled_at, id
    for update skip locked
  loop
    select * into activity from public.calendar_activities where id = reminder.activity_id for share;
    if not found then
      update public.health_supervisor_reminders
        set status = 'cancelled', next_attempt_at = null, cancelled_at = now(), updated_at = now()
        where id = reminder.id;
      continue;
    end if;
    starts_at := ((activity.activity_date + coalesce(activity.activity_time, '09:00'::time))
      at time zone 'Asia/Manila');
    if starts_at <= p_now then
      update public.health_supervisor_reminders
        set status = 'expired', next_attempt_at = null, updated_at = now()
        where id = reminder.id;
      continue;
    end if;

    attempt := reminder.attempts + 1;
    update public.health_supervisor_reminders
      set status = 'processing', attempts = attempt, last_attempt_at = p_now,
        next_attempt_at = null, updated_at = now()
      where id = reminder.id;
    failed_operation := 'validate_recipient';
    begin
      select p.municipality_id into municipality_id from public.profiles p
        where p.id = reminder.recipient_id and p.role = 'health_supervisor';
      if not found or not public.notification_account_can_receive(reminder.recipient_id, municipality_id) then
        raise exception using errcode = '22023', message = 'RECIPIENT_NOT_ELIGIBLE';
      end if;

      failed_operation := 'validate_activity';
      if activity.created_by <> reminder.recipient_id then
        raise exception using errcode = '22023', message = 'ACTIVITY_RECIPIENT_MISMATCH';
      end if;

      failed_operation := 'insert_notification';
      insert into public.notifications(recipient_id, event_key, category, title, message, related_type, related_id)
        values (reminder.recipient_id, 'hs:calendar_activity:' || reminder.activity_id || ':' || reminder.recipient_id,
          'reminder', 'Calendar activity tomorrow',
          'A calendar activity you scheduled is due tomorrow. Open your calendar for details.',
          'calendar_activity', reminder.activity_id::text)
        on conflict (recipient_id, event_key) where event_key is not null do nothing
        returning id into notification_id;

      if notification_id is null then
        select n.id into notification_id from public.notifications n
          where n.recipient_id = reminder.recipient_id
            and n.event_key = 'hs:calendar_activity:' || reminder.activity_id || ':' || reminder.recipient_id;
        if not found then
          raise exception using errcode = '23505', message = 'NOTIFICATION_DEDUPLICATION_FAILED';
        end if;
      else
        inserted := inserted + 1;
      end if;

      update public.health_supervisor_reminders
        set status = 'delivered', delivered_at = p_now, next_attempt_at = null,
          last_failed_operation = null, last_error_code = null, last_error_message = null, updated_at = now()
        where id = reminder.id;
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_error_message = message_text;
      retryable := v_sqlstate not in ('22023', '23503', '23514', 'P0002') and attempt < 8;
      update public.health_supervisor_reminders
        set status = case when retryable then 'pending' else 'failed' end,
          next_attempt_at = case when retryable
            then p_now + make_interval(mins => least(60, 5 * power(2, attempt - 1)::integer))
            else null end,
          last_failed_operation = failed_operation,
          last_error_code = v_sqlstate,
          last_error_message = left(v_error_message, 2000),
          updated_at = now()
        where id = reminder.id;

      failed := failed + 1;
      failures := failures || jsonb_build_array(jsonb_build_object(
        'reminder_id', reminder.id,
        'activity_id', reminder.activity_id,
        'recipient_id', reminder.recipient_id,
        'scheduled_at', reminder.scheduled_at,
        'attempted_at', p_now,
        'failed_operation', failed_operation,
        'original_error', v_error_message,
        'error_code', v_sqlstate,
        'retry_count', attempt
      ));
    end;
  end loop;

  return jsonb_build_object('inserted', inserted, 'failed', failed, 'failures', failures);
end;
$$;

revoke all on function public.schedule_calendar_activity_reminder() from public, anon, authenticated, service_role;

revoke all on function public.cancel_calendar_activity_reminder() from public, anon, authenticated, service_role;

revoke all on function public.deliver_calendar_activity_reminders(timestamptz) from public, anon, authenticated;

grant execute on function public.deliver_calendar_activity_reminders(timestamptz) to service_role;

do $$
begin
  if to_regprocedure('public.deliver_health_supervisor_general_notifications(timestamptz)') is null then
    alter function public.deliver_health_supervisor_reminders(timestamptz)
      rename to deliver_health_supervisor_general_notifications;
  end if;
end;
$$;

revoke all on function public.deliver_health_supervisor_general_notifications(timestamptz)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
