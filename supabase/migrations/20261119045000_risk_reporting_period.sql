-- supabase/migrations/20261119045000_risk_reporting_period.sql
-- KFT-015: expose selected-period resident risk without changing legacy EW metrics.
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
    $old$    ), conditions as ($old$,
    $new$    ), reporting_latest as materialized (
      select distinct on (v.resident_id) v.resident_id,
        public.analytics_visit_risk(v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg, v_config) as risk
      from visits v
      where (coalesce(p_from, case when p_year is not null then make_date(p_year, 1, 1) end) is null
          or v.occurred_at >= coalesce(p_from, make_date(p_year, 1, 1))::timestamp at time zone 'Asia/Manila')
        and (coalesce(p_to, case when p_year is not null then make_date(p_year, 12, 31) end) is null
          or v.occurred_at < (coalesce(p_to, make_date(p_year, 12, 31)) + 1)::timestamp at time zone 'Asia/Manila')
      order by v.resident_id, v.occurred_at desc, v.updated_at desc, v.created_at desc, v.id desc
    ), reporting_risk as (
      select count(*) filter (where coalesce(l.risk, 'Unassessed') = 'Low') as low,
        count(*) filter (where l.risk = 'Moderate') as moderate,
        count(*) filter (where l.risk = 'High') as high,
        count(*) filter (where coalesce(l.risk, 'Unassessed') = 'Unassessed') as unassessed
      from residents r left join reporting_latest l on l.resident_id = r.id
    ), conditions as ($new$);
  if updated = definition then
    raise exception 'KFT-015: expected early-warning condition CTE marker not found';
  end if;
  definition := updated;

  updated := replace(definition,
    $old$      'barangayOverview', jsonb_build_object($old$,
    $new$      'reportingRiskDistribution', case
        when p_from is null and p_to is null and p_year is null then jsonb_build_array(
          jsonb_build_object('name', 'Low Risk', 'value', s.low),
          jsonb_build_object('name', 'Moderate Risk', 'value', s.moderate),
          jsonb_build_object('name', 'High Risk', 'value', s.high),
          jsonb_build_object('name', 'Unassessed', 'value', s.unassessed))
        else (select jsonb_build_array(
          jsonb_build_object('name', 'Low Risk', 'value', rr.low),
          jsonb_build_object('name', 'Moderate Risk', 'value', rr.moderate),
          jsonb_build_object('name', 'High Risk', 'value', rr.high),
          jsonb_build_object('name', 'Unassessed', 'value', rr.unassessed)) from reporting_risk rr)
      end,
      'reportingPeriod', jsonb_build_object(
        'from', coalesce(p_from, case when p_year is not null then make_date(p_year, 1, 1) end),
        'to', coalesce(p_to, case when p_year is not null then make_date(p_year, 12, 31) end),
        'year', p_year),
      'barangayOverview', jsonb_build_object($new$);
  if updated = definition then
    raise exception 'KFT-015: expected early-warning result marker not found';
  end if;
  definition := updated;

  updated := replace(definition,
    $old$    ), ranked as ($old$,
    $new$    ), reporting_latest as materialized (
      select distinct on (v.resident_id) v.resident_id, v.barangay_id, v.risk
      from visits v
      where (v_from is null or v.occurred_at >= v_from)
        and (v_until is null or v.occurred_at < v_until)
      order by v.resident_id, v.occurred_at desc, v.updated_at desc, v.created_at desc, v.id desc
    ), reporting_high_risk as (
      select barangay_id, count(*) filter (where risk = 'High') as high_risk
      from reporting_latest group by barangay_id
    ), ranked as ($new$);
  if updated = definition then
    raise exception 'KFT-015: expected community-map ranked CTE marker not found';
  end if;
  definition := updated;

  updated := replace(definition,
    $old$(select count(*) from latest l where l.barangay_id = b.id and l.risk = 'High') as high_risk,$old$,
    $new$(select count(*) from latest l where l.barangay_id = b.id and l.risk = 'High') as high_risk,
        coalesce((select high_risk from reporting_high_risk where barangay_id = b.id), 0) as reporting_high_risk,$new$);
  if updated = definition then
    raise exception 'KFT-015: expected community-map risk stats marker not found';
  end if;
  definition := updated;

  updated := replace(definition,
    $old$'highRiskResidents', s.high_risk,$old$,
    $new$'highRiskResidents', s.high_risk,
         'reportingHighRiskResidents', s.reporting_high_risk,$new$);
  if updated = definition then
    raise exception 'KFT-015: expected community-map row risk marker not found';
  end if;

  execute updated;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
