-- Separate current resident risk from period-scoped activity. The Early
-- Warning risk classification is the latest risk per resident (same as the
-- resident directory); periodRiskDistribution remains available for historical
-- date-window comparisons.
begin;

do $migration$
declare
  definition text;
  updated text;
begin
  definition := pg_get_functiondef(
    'public.scoped_aggregate_analytics(uuid,text,text,text,text,text,date,date,integer,boolean)'::regprocedure
  );

  updated := regexp_replace(definition,
    'from[[:space:]]+public\.visits[[:space:]]+v[[:space:]]+join[[:space:]]+residents[[:space:]]+r[[:space:]]+on[[:space:]]+r\.id[[:space:]]*=[[:space:]]*v\.resident_id[[:space:]]+where[[:space:]]+coalesce\(v\.visit_date,[[:space:]]*v\.created_at\)[[:space:]]+>=[[:space:]]+v_activity_from::timestamp[[:space:]]+at[[:space:]]+time[[:space:]]+zone[[:space:]]+''Asia/Manila''[[:space:]]+and[[:space:]]+coalesce\(v\.visit_date,[[:space:]]*v\.created_at\)[[:space:]]+<[[:space:]]*\(v_activity_to[[:space:]]*\+[[:space:]]*1\)::timestamp[[:space:]]+at[[:space:]]+time[[:space:]]+zone[[:space:]]+''Asia/Manila''',
    'from public.visits v join residents r on r.id = v.resident_id',
    'g');
  if updated = definition and position(
    'where coalesce(v.visit_date, v.created_at) >= v_activity_from::timestamp at time zone ''Asia/Manila''' in definition
  ) > 0 then
    raise exception 'Current risk migration: could not remove the period limit from current risk visits';
  end if;
  definition := updated;

  updated := regexp_replace(definition,
    '    \), risk as \([[:space:]]*select count\(\*\) filter \(where risk = ''Low''\) as low,[[:space:]]*count\(\*\) filter \(where risk = ''Moderate''\) as moderate,[[:space:]]*count\(\*\) filter \(where risk = ''High''\) as high,[[:space:]]*count\(\*\) filter \(where risk = ''Unassessed''\) as unassessed from latest',
    '    ), risk as (select count(*) filter (where coalesce(l.risk, ''Unassessed'') = ''Low'') as low, count(*) filter (where l.risk = ''Moderate'') as moderate, count(*) filter (where l.risk = ''High'') as high, count(*) filter (where coalesce(l.risk, ''Unassessed'') = ''Unassessed'') as unassessed from residents r left join latest l on l.resident_id = r.id',
    'g');
  if updated = definition and position(
    'from residents r left join latest l on l.resident_id = r.id' in definition
  ) = 0 then
    raise exception 'Current risk migration: could not locate the resident risk aggregation';
  end if;
  definition := updated;

  updated := regexp_replace(definition,
    $pattern$select[[:space:]]+condition[[:space:]]+as[[:space:]]+name,[[:space:]]*count\(\*\)[[:space:]]+as[[:space:]]+value[[:space:]]+from[[:space:]]+visits[[:space:]]+group[[:space:]]+by[[:space:]]+condition$pattern$,
    $replacement$select condition as name, count(*) as value from visits
      where occurred_at >= v_activity_from::timestamp at time zone 'Asia/Manila'
        and occurred_at < (v_activity_to + 1)::timestamp at time zone 'Asia/Manila'
      group by condition$replacement$);
  if updated = definition and definition !~
    $pattern$select[[:space:]]+condition[[:space:]]+as[[:space:]]+name,[[:space:]]*count\(\*\)[[:space:]]+as[[:space:]]+value[[:space:]]+from[[:space:]]+visits[[:space:]]+where[[:space:]]+occurred_at[[:space:]]*>=[[:space:]]*v_activity_from::timestamp[[:space:]]+at[[:space:]]+time[[:space:]]+zone[[:space:]]+'Asia/Manila'[[:space:]]+and[[:space:]]+occurred_at[[:space:]]*<[[:space:]]*\(v_activity_to[[:space:]]*\+[[:space:]]*1\)::timestamp[[:space:]]+at[[:space:]]+time[[:space:]]+zone[[:space:]]+'Asia/Manila'[[:space:]]+group[[:space:]]+by[[:space:]]+condition$pattern$ then
    raise exception 'Current risk migration: could not locate the period condition aggregation';
  end if;

  if updated is distinct from pg_get_functiondef(
    'public.scoped_aggregate_analytics(uuid,text,text,text,text,text,date,date,integer,boolean)'::regprocedure
  ) then
    execute updated;
  end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
