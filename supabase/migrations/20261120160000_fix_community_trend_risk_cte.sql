-- supabase/migrations/20261120160000_fix_community_trend_risk_cte.sql
-- The risk-reporting migration inserted the community-map-only CTE into both
-- map branches. Community-map-trends has no barangay_id/risk columns in its
-- visits CTE, so remove that unused accidental insertion from this branch.
begin;

do $migration$
declare
  definition text;
  updated text;
  trend_start integer;
  branch text;
  cte_start integer;
  cte_end integer;
  marker text := '    ), ranked as (';
begin
  definition := pg_get_functiondef(
    'public.scoped_aggregate_analytics(uuid,text,text,text,text,text,date,date,integer,boolean)'::regprocedure
  );

  trend_start := position('elsif p_kind = ''community-map-trends'' then' in definition);
  if trend_start = 0 then
    raise exception 'Community trend migration: could not locate the community-map-trends branch';
  end if;

  branch := substring(definition from trend_start);
  cte_start := position('    ), reporting_latest as materialized (' in branch);
  if cte_start = 0 then
    -- Already fixed (or the reporting CTE was never present).
    return;
  end if;
  cte_end := position(marker in substring(branch from cte_start));
  if cte_end = 0 then
    raise exception 'Community trend migration: could not locate the end of the accidental risk CTE';
  end if;

  -- Preserve the beginning and end of the trend query, replacing the two
  -- invalid CTEs with the original transition directly into ranked.
  updated := overlay(definition placing
    left(branch, cte_start - 1) || marker ||
      substring(branch from cte_start + cte_end - 1 + length(marker))
    from trend_start for length(branch));

  execute updated;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
