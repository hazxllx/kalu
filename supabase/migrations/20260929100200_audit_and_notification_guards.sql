-- =============================================================================
-- KALUSAGAP — BUG-007 + BUG-016: audit-log scope + notification column guard
--
-- BUG-007: health_audit_logs SELECT was `is_admin() OR is_staff_active()`, so
--   ANY active staff (including a BHW) could read the ENTIRE audit trail across
--   every barangay and municipality. Restrict reads to the caller's scope:
--     admin                        -> all rows (global audit)
--     mho / phn / rhu_personnel    -> their own municipality
--     health_supervisor / bhw      -> their own assigned barangay
--     actor                        -> rows they generated
--   Audit WRITES are unchanged (service-role inserts); logging is preserved.
--
-- BUG-016: notifications_update_own let a recipient rewrite title / message /
--   category / related_type / related_id (not just read/seen state). RLS
--   WITH CHECK cannot compare OLD vs NEW, so a BEFORE UPDATE trigger enforces
--   that an end-user (auth.uid() not null, non-admin) may only change read_at.
--   The service-role backend (auth.uid() is null) is unaffected.
--
-- Idempotent: safe to re-run.
-- =============================================================================

begin;

-- --- BUG-007: scope the audit-log read policy -------------------------------
drop policy if exists health_audit_select_staff on public.health_audit_logs;
create policy health_audit_select_staff on public.health_audit_logs
  for select to authenticated
  using (
    public.is_admin()
    or actor_id = auth.uid()
    or (
      public.is_staff_active()
      and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel')
          and municipality_id = public.profile_municipality_id())
        or (public.profile_role() in ('health_supervisor', 'bhw')
          and barangay_id = public.profile_barangay_id())
      )
    )
  );

-- --- BUG-016: notification recipient may only change read/seen state ---------
create or replace function public.guard_notification_recipient_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-role backend (auth.uid() null) and admins are unrestricted.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.recipient_id is distinct from old.recipient_id
     or new.category is distinct from old.category
     or new.title is distinct from old.title
     or new.message is distinct from old.message
     or new.related_type is distinct from old.related_type
     or new.related_id is distinct from old.related_id
     or new.created_at is distinct from old.created_at then
    raise exception
      'notifications: a recipient may only update the read/seen state of their own notification'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_notification_recipient_update() is
  'BUG-016: restricts recipient notification UPDATEs to read_at only; blocks rewriting title/message/category/etc. Skips the service-role backend.';

drop trigger if exists notifications_guard_recipient_update on public.notifications;
create trigger notifications_guard_recipient_update
  before update on public.notifications
  for each row execute function public.guard_notification_recipient_update();

commit;
