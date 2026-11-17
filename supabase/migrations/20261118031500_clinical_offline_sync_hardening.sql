-- KALUSAGAP — Stage 2A: Backend Clinical Offline Sync Hardening
--
-- Prepares the nine approved clinical/program tables for replay-safe offline
-- creation and optimistic-concurrency updates:
--   1. public.tcl_entries
--   2. public.maternal_records
--   3. public.maternal_visits
--   4. public.immunizations
--   5. public.ncd_risk_assessments
--   6. public.ncd_cervical_breast
--   7. public.ncd_visual_ppv
--   8. public.oral_health_records
--   9. public.environmental_masterlist
--
-- Protections added (strictly additive & replay-safe on existing databases):
--   - `client_operation_key text`: optional client-supplied Idempotency-Key
--     bound once at creation, constrained non-blank (<= 200 chars), and backed
--     by a partial unique index (`WHERE client_operation_key IS NOT NULL`) so
--     concurrent or retried inserts can never create duplicate clinical rows.
--   - `revision integer not null default 1`: server-owned monotonic version
--     initialized to 1 on INSERT (preserving existing rows at >= 1 during DDL)
--     and incremented by 1 on every UPDATE via trigger, ignoring client-forged
--     revision values.
--
-- Excluded by design: M1 official reporting tables and referral transitions.

begin;

create or replace function public.maintain_clinical_sync_metadata()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    if new.client_operation_key is not null then
      new.client_operation_key := btrim(new.client_operation_key);
      if new.client_operation_key = '' or char_length(new.client_operation_key) > 200 then
        raise exception 'client_operation_key must be 1..200 non-blank characters'
          using errcode = '23514';
      end if;
    end if;
  else
    if old.client_operation_key is not null
       and new.client_operation_key is distinct from old.client_operation_key then
      raise exception 'client_operation_key is immutable once recorded'
        using errcode = '23514';
    end if;
    if old.client_operation_key is null and new.client_operation_key is not null then
      raise exception 'client_operation_key can only be set on insert'
        using errcode = '23514';
    end if;
    new.revision := coalesce(old.revision, 1) + 1;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

revoke all on function public.maintain_clinical_sync_metadata() from public, anon, authenticated;
grant execute on function public.maintain_clinical_sync_metadata() to service_role;

do $$
declare
  tbl text;
  key_constraint text;
  rev_constraint text;
  idx_name text;
  trg_name text;
  target_tables constant text[] := array[
    'tcl_entries',
    'maternal_records',
    'maternal_visits',
    'immunizations',
    'ncd_risk_assessments',
    'ncd_cervical_breast',
    'ncd_visual_ppv',
    'oral_health_records',
    'environmental_masterlist'
  ];
begin
  foreach tbl in array target_tables loop
    key_constraint := tbl || '_client_operation_key_valid';
    rev_constraint := tbl || '_revision_positive';
    idx_name := tbl || '_client_operation_key_unique';
    trg_name := 'zz_' || tbl || '_sync_metadata';

    execute format(
      'alter table public.%I add column if not exists client_operation_key text',
      tbl
    );

    if not exists (
      select 1
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join pg_namespace n on n.oid = r.relnamespace
      where n.nspname = 'public'
        and r.relname = tbl
        and c.conname = key_constraint
    ) then
      execute format(
        $sql$
          alter table public.%I
            add constraint %I
            check (
              client_operation_key is null
              or (
                btrim(client_operation_key) <> ''
                and char_length(client_operation_key) <= 200
              )
            )
        $sql$,
        tbl,
        key_constraint
      );
    end if;

    execute format(
      $sql$
        create unique index if not exists %I
          on public.%I (client_operation_key)
          where client_operation_key is not null
      $sql$,
      idx_name,
      tbl
    );

    execute format(
      'alter table public.%I add column if not exists revision integer not null default 1',
      tbl
    );

    if not exists (
      select 1
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join pg_namespace n on n.oid = r.relnamespace
      where n.nspname = 'public'
        and r.relname = tbl
        and c.conname = rev_constraint
    ) then
      execute format(
        'alter table public.%I add constraint %I check (revision >= 1)',
        tbl,
        rev_constraint
      );
    end if;

    execute format(
      'drop trigger if exists %I on public.%I',
      trg_name,
      tbl
    );
    execute format(
      $sql$
        create trigger %I
          before insert or update on public.%I
          for each row execute function public.maintain_clinical_sync_metadata()
      $sql$,
      trg_name,
      tbl
    );

    execute format(
      $sql$
        comment on column public.%I.client_operation_key is
          'Idempotency-Key of an offline clinical creation; unique when non-null and immutable after insert.'
      $sql$,
      tbl
    );
    execute format(
      $sql$
        comment on column public.%I.revision is
          'Server-owned optimistic-concurrency version initialized to 1 on insert and incremented on every update.'
      $sql$,
      tbl
    );
  end loop;
end
$$;

commit;

notify pgrst, 'reload schema';
