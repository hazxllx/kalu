-- supabase/migrations/20261120130000_health_trends_visit_date_source_fix.sql
-- Fix the selected-period predicate added to the early-warning visits CTE.
-- `occurred_at` is an alias in that CTE's SELECT list; the source table uses
-- `visit_date` (falling back to `created_at`) and cannot reference the alias
-- in the same SELECT's WHERE clause.
begin;

do $migration$
declare
  definition text;
  updated text;
begin
  definition := pg_get_functiondef(
    'public.scoped_aggregate_analytics(uuid,text,text,text,text,text,date,date,integer,boolean)'::regprocedure
  );

  updated := replace(definition,
    $old$from public.visits v join residents r on r.id = v.resident_id
      where v.occurred_at >= v_activity_from::timestamp at time zone 'Asia/Manila'
        and v.occurred_at < (v_activity_to + 1)::timestamp at time zone 'Asia/Manila'$old$,
    $new$from public.visits v join residents r on r.id = v.resident_id
      where coalesce(v.visit_date, v.created_at) >= v_activity_from::timestamp at time zone 'Asia/Manila'
        and coalesce(v.visit_date, v.created_at) < (v_activity_to + 1)::timestamp at time zone 'Asia/Manila'$new$);

  if updated = definition then
    if position('where coalesce(v.visit_date, v.created_at) >= v_activity_from::timestamp' in definition) = 0 then
      raise exception 'Health trends migration: could not find the early-warning visit date predicate';
    end if;
    return;
  end if;

  execute updated;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
