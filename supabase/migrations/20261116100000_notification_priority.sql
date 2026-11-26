-- supabase/migrations/20261116100000_notification_priority.sql
begin;

alter table public.notifications
  add column if not exists priority text
  check (priority is null or priority in ('emergency', 'critical'));

comment on column public.notifications.priority is
  'Optional explicit priority for emergency or critical notifications. Null means no elevated priority.';

create or replace function public.guard_notification_recipient_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.recipient_id is distinct from old.recipient_id
     or new.category is distinct from old.category
     or new.title is distinct from old.title
     or new.message is distinct from old.message
     or new.related_type is distinct from old.related_type
     or new.related_id is distinct from old.related_id
     or new.priority is distinct from old.priority
     or new.created_at is distinct from old.created_at then
    raise exception
      'notifications: a recipient may only update the read/seen state of their own notification'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_notification_recipient_update() is
  'Restricts notification recipients to updating read_at only; priority and content fields remain service-managed.';

commit;
