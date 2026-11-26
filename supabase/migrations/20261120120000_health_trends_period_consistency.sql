-- supabase/migrations/20261120120000_health_trends_period_consistency.sql
-- Align early-warning condition and headline counts with the reporting period.
-- Trend month buckets and labels are already period-scoped in the deployed
-- function, so this migration only changes the remaining unfiltered inputs.
begin;

do $migration$
declare
  definition text;
  updated text;
  summary_pattern text := $pattern$coalesce\(\(select consultations from months where month = v_month\), 0\) as consultations,[[:space:]]*coalesce\(\(select referrals from months where month = v_month\), 0\) as referrals,$pattern$;
  summary_period_pattern text := $pattern$coalesce\(\(select sum\(consultations\) from months\), 0\) as consultations,[[:space:]]*coalesce\(\(select sum\(referrals\) from months\), 0\) as referrals,$pattern$;
begin
  definition := pg_get_functiondef(
    'public.scoped_aggregate_analytics(uuid,text,text,text,text,text,date,date,integer,boolean)'::regprocedure
  );

  -- Restrict the source visit set so the condition chart, top condition and
  -- latest-in-period risk inputs all describe the selected reporting window.
  updated := regexp_replace(definition,
    $pattern$(from[[:space:]]+public\.visits[[:space:]]+v[[:space:]]+join[[:space:]]+residents[[:space:]]+r[[:space:]]+on[[:space:]]+r\.id[[:space:]]*=[[:space:]]*v\.resident_id)([[:space:]]*\))$pattern$,
    $replacement$\1
      where v.occurred_at >= v_activity_from::timestamp at time zone 'Asia/Manila'
        and v.occurred_at < (v_activity_to + 1)::timestamp at time zone 'Asia/Manila'\2$replacement$);
  if updated = definition then
    if position('v_activity_from' in definition) = 0 then
      raise exception 'Health trends migration: could not locate the early-warning visit source';
    end if;
  else
    definition := updated;
  end if;

  -- Aggregate headline consultation/referral totals over all selected months.
  updated := regexp_replace(definition, summary_pattern,
    $replacement$coalesce((select sum(consultations) from months), 0) as consultations,
        coalesce((select sum(referrals) from months), 0) as referrals,$replacement$);
  if updated = definition and definition !~ summary_period_pattern then
    raise exception 'Health trends migration: could not locate the early-warning summary totals';
  end if;

  execute updated;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
