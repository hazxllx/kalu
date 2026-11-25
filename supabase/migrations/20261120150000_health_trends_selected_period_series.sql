-- Keep the Early Warning chart's month buckets and displayed period aligned
-- with the same selected dates used by its summary and risk/disease figures.
begin;

do $migration$
declare
  definition text;
  updated text;
begin
  definition := replace(pg_get_functiondef(
    'public.scoped_aggregate_analytics(uuid,text,text,text,text,text,date,date,integer,boolean)'::regprocedure
  ), E'\r\n', E'\n');

  updated := regexp_replace(definition,
    'from[[:space:]]+visits[[:space:]]+v[[:space:]]+where[[:space:]]+v\.occurred_at[[:space:]]+>=[[:space:]]+\(v_month[[:space:]]+-[[:space:]]+interval[[:space:]]+''11 months''\)(::timestamp)?[[:space:]]+at[[:space:]]+time[[:space:]]+zone[[:space:]]+''Asia/Manila''[[:space:]]+and[[:space:]]+v\.occurred_at[[:space:]]+<[[:space:]]+\(v_month[[:space:]]+\+[[:space:]]+interval[[:space:]]+''1 month''\)(::timestamp)?[[:space:]]+at[[:space:]]+time[[:space:]]+zone[[:space:]]+''Asia/Manila''[[:space:]]+group[[:space:]]+by[[:space:]]+1',
    'from visits v where v.occurred_at >= v_activity_from::timestamp at time zone ''Asia/Manila'' and v.occurred_at < (v_activity_to + 1)::timestamp at time zone ''Asia/Manila'' group by 1',
    'g');
  if updated = definition and position('from visits v where v.occurred_at >= v_activity_from::timestamp' in definition) = 0 then
    raise exception 'Health trends migration: could not find the consultation month range';
  end if;
  definition := updated;

  updated := regexp_replace(definition,
    'where[[:space:]]+h\.created_at[[:space:]]+>=[[:space:]]+\(v_month[[:space:]]+-[[:space:]]+interval[[:space:]]+''11 months''\)(::timestamp)?[[:space:]]+at[[:space:]]+time[[:space:]]+zone[[:space:]]+''Asia/Manila''[[:space:]]+and[[:space:]]+h\.created_at[[:space:]]+<[[:space:]]+\(v_month[[:space:]]+\+[[:space:]]+interval[[:space:]]+''1 month''\)(::timestamp)?[[:space:]]+at[[:space:]]+time[[:space:]]+zone[[:space:]]+''Asia/Manila''[[:space:]]+group[[:space:]]+by[[:space:]]+1',
    'where h.created_at >= v_activity_from::timestamp at time zone ''Asia/Manila'' and h.created_at < (v_activity_to + 1)::timestamp at time zone ''Asia/Manila'' group by 1',
    'g');
  if updated = definition and position('where h.created_at >= v_activity_from::timestamp' in definition) = 0 then
    raise exception 'Health trends migration: could not find the referral month range';
  end if;
  definition := updated;

  updated := regexp_replace(definition,
    'generate_series\([[:space:]]*v_month[[:space:]]*-[[:space:]]*interval[[:space:]]+''11 months'',[[:space:]]*v_month::timestamp,[[:space:]]*interval[[:space:]]+''1 month''[[:space:]]*\)',
    'generate_series(date_trunc(''month'', v_activity_from::timestamp), date_trunc(''month'', v_activity_to::timestamp), interval ''1 month'')',
    'g');
  if updated = definition and position('generate_series(date_trunc(''month'', v_activity_from::timestamp)' in definition) = 0 then
    raise exception 'Health trends migration: could not find the reporting month series';
  end if;
  definition := updated;

  updated := replace(definition,
    $old$jsonb_build_object('month', to_char(month, 'Mon'),$old$,
    $new$jsonb_build_object('month', to_char(month, 'YYYY-MM'),$new$);
  if updated = definition and position('to_char(month, ''YYYY-MM'')' in definition) = 0 then
    raise exception 'Health trends migration: could not find the consultation trend month labels';
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
