-- Integer resident versions cover every writer, including verification,
-- household linking and transfers. Existing timestamp If-Match requests remain
-- supported by the API so encrypted drafts from older clients are not lost.
-- Additive: no resident data or existing RLS policies are removed.
begin;

alter table public.residents
  add column if not exists revision integer not null default 1;

create or replace function public.increment_resident_revision()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    new.revision := old.revision + 1;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists residents_increment_revision on public.residents;
create trigger residents_increment_revision
  before insert or update on public.residents
  for each row execute function public.increment_resident_revision();

revoke all on function public.increment_resident_revision() from public, anon, authenticated;
grant execute on function public.increment_resident_revision() to service_role;

comment on column public.residents.revision is
  'Server-owned version incremented on every write. PUT /residents/:id requires If-Match; stale versions return 409.';

commit;
notify pgrst, 'reload schema';

-- Rollback (only after reverting integer-version API clients):
-- DROP TRIGGER IF EXISTS residents_increment_revision ON public.residents;
-- DROP FUNCTION IF EXISTS public.increment_resident_revision();
-- Keep the existing revision column and all resident rows.
