-- supabase/migrations/20261122180000_deliver_health_supervisor_reminders_no_args.sql
begin;

create or replace function public.deliver_health_supervisor_reminders_at(p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare general_result jsonb; calendar_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'The notification worker requires service authorization.';
  end if;
  if p_now is null or not isfinite(p_now) then
    raise exception using errcode = '22023', message = 'Invalid reminder time.';
  end if;

  general_result := public.deliver_health_supervisor_general_notifications(p_now);
  calendar_result := public.deliver_calendar_activity_reminders(p_now);
  return jsonb_build_object(
    'inserted', coalesce((general_result->>'inserted')::integer, 0)
      + coalesce((calendar_result->>'inserted')::integer, 0),
    'failed', coalesce((calendar_result->>'failed')::integer, 0),
    'failures', coalesce(calendar_result->'failures', '[]'::jsonb)
  );
end;
$$;

create or replace function public.deliver_health_supervisor_reminders()
returns jsonb language sql security definer set search_path = public as $$
  select public.deliver_health_supervisor_reminders_at(now());
$$;

revoke all on function public.deliver_health_supervisor_reminders_at(timestamptz)
  from public, anon, authenticated, service_role;

revoke all on function public.deliver_health_supervisor_reminders() from public, anon, authenticated;

grant execute on function public.deliver_health_supervisor_reminders() to service_role;

notify pgrst, 'reload schema';

commit;
