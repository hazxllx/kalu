-- supabase/migrations/20261120100000_follow_up_revision_concurrency.sql
-- Give staff follow-up actions a server-owned revision for optimistic updates.
-- Existing rows receive revision 1; each accepted update advances it once.
begin;

alter table public.follow_ups
  add column if not exists revision integer not null default 1;

alter table public.follow_ups
  drop constraint if exists follow_ups_revision_positive;
alter table public.follow_ups
  add constraint follow_ups_revision_positive check (revision >= 1);

create or replace function public.maintain_follow_up_revision()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    new.revision := coalesce(old.revision, 1) + 1;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists follow_ups_maintain_revision on public.follow_ups;
create trigger follow_ups_maintain_revision
  before insert or update on public.follow_ups
  for each row execute function public.maintain_follow_up_revision();

revoke all on function public.maintain_follow_up_revision() from public, anon, authenticated;
grant execute on function public.maintain_follow_up_revision() to service_role;

comment on column public.follow_ups.revision is
  'Server-owned follow-up version. Staff updates must include the revision last read; stale writes are rejected.';

commit;
notify pgrst, 'reload schema';
