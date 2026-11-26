-- supabase/migrations/20261127000000_reports_profile_relationships.sql
begin;

do $$
declare
  relationship record;
  existing_constraint text;
begin
  for relationship in
    select *
    from (values
      ('created_by', 'reports_created_by_fkey'),
      ('reviewed_by', 'reports_reviewed_by_fkey'),
      ('received_by', 'reports_received_by_fkey')
    ) as expected(column_name, constraint_name)
  loop
    select constraint_row.conname
      into existing_constraint
    from pg_constraint constraint_row
    join pg_attribute report_column
      on report_column.attrelid = constraint_row.conrelid
     and report_column.attname = relationship.column_name
    join pg_attribute profile_column
      on profile_column.attrelid = constraint_row.confrelid
     and profile_column.attname = 'id'
    where constraint_row.conrelid = 'public.reports'::regclass
      and constraint_row.confrelid = 'public.profiles'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.conkey = array[report_column.attnum]::smallint[]
      and constraint_row.confkey = array[profile_column.attnum]::smallint[]
    limit 1;

    if found then
      if existing_constraint <> relationship.constraint_name then
        if exists (
          select 1
          from pg_constraint
          where conrelid = 'public.reports'::regclass
            and conname = relationship.constraint_name
        ) then
          raise exception 'Constraint name % is already used by another reports relationship',
            relationship.constraint_name;
        end if;

        execute format(
          'alter table public.reports rename constraint %I to %I',
          existing_constraint,
          relationship.constraint_name
        );
      end if;
    else
      if exists (
        select 1
        from pg_constraint
        where conrelid = 'public.reports'::regclass
          and conname = relationship.constraint_name
      ) then
        raise exception 'Constraint name % exists but does not reference profiles(id) through reports column %',
          relationship.constraint_name,
          relationship.column_name;
      end if;

      execute format(
        'alter table public.reports add constraint %I foreign key (%I) references public.profiles(id) on delete set null',
        relationship.constraint_name,
        relationship.column_name
      );
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
