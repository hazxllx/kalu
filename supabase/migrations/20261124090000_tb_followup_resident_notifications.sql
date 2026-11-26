-- supabase/migrations/20261124090000_tb_followup_resident_notifications.sql
begin;

create or replace function public.deliver_tb_followup_reminders(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reminder record;
  today_manila date;
  inserted integer := 0;
  affected integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'The notification worker requires service authorization.';
  end if;
  if p_now is null or not isfinite(p_now) then
    raise exception using errcode = '22023', message = 'Invalid reminder time.';
  end if;

  today_manila := (p_now at time zone 'Asia/Manila')::date;
  for reminder in
    select t.id, t.resident_id, t.next_visit, r.auth_user_id
    from public.tcl_entries t
    join public.residents r on r.id = t.resident_id
    where t.next_visit is not null
      and t.next_visit <= today_manila
      and t.program ~* '(^|[^[:alnum:]])(tb|tuberculosis)([^[:alnum:]]|$)'
      and r.auth_user_id is not null
      and public.notification_account_can_receive(r.auth_user_id, r.municipality_id)
    order by t.next_visit, t.id
  loop
    insert into public.notifications(
      recipient_id, event_key, category, title, message, related_type, related_id
    ) values (
      reminder.auth_user_id,
      'tb:followup:' || reminder.id::text || ':' || reminder.next_visit::text,
      'reminder',
      'TB Follow-up Reminder',
      'Your next TB follow-up is scheduled for '
        || to_char(reminder.next_visit, 'FMMonth DD, YYYY')
        || '. Please visit your assigned healthcare provider for your scheduled check-up.',
      'tcl_entries',
      reminder.id::text
    )
    on conflict (recipient_id, event_key) do nothing;
    get diagnostics affected = row_count;
    inserted := inserted + affected;
  end loop;

  return jsonb_build_object('inserted', inserted);
end;
$$;

create or replace function public.deliver_health_supervisor_reminders_at(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  general_result jsonb;
  calendar_result jsonb;
  tb_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'The notification worker requires service authorization.';
  end if;
  if p_now is null or not isfinite(p_now) then
    raise exception using errcode = '22023', message = 'Invalid reminder time.';
  end if;

  general_result := public.deliver_health_supervisor_general_notifications(p_now);
  calendar_result := public.deliver_calendar_activity_reminders(p_now);
  tb_result := public.deliver_tb_followup_reminders(p_now);
  return jsonb_build_object(
    'inserted', coalesce((general_result->>'inserted')::integer, 0)
      + coalesce((calendar_result->>'inserted')::integer, 0)
      + coalesce((tb_result->>'inserted')::integer, 0),
    'failed', coalesce((calendar_result->>'failed')::integer, 0),
    'failures', coalesce(calendar_result->'failures', '[]'::jsonb)
  );
end;
$$;

revoke all on function public.deliver_tb_followup_reminders(timestamptz)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
