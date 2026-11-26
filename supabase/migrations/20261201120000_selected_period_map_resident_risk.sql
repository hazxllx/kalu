-- supabase/migrations/20261201120000_selected_period_map_resident_risk.sql
-- Community-map reporting risk uses the same period-scoped resident assessment
-- as Early Warning, instead of carrying an earlier high risk through an
-- incomplete measurement recorded inside the selected period.
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
    $old$select distinct on (v.resident_id) v.resident_id, v.barangay_id,
        case when exists (select 1 from public.visits c where c.resident_id = v.resident_id and c.status not in ('draft', 'submitted')
          and c.consultation_details ?| array['clinicalAssessment','clinical_assessment','riskAssessment','risk_assessment','clinicalAssessmentHistory'])
        then coalesce(public.analytics_resident_risk(v.resident_id, v_config, false, v_from, v_until) ->> 'riskLevel', 'Unassessed') else v.risk end as risk
      from visits v$old$,
    $new$select distinct on (v.resident_id) v.resident_id, v.barangay_id,
        case when exists (select 1 from public.visits c where c.resident_id = v.resident_id
          and c.status not in ('draft', 'submitted')
          and c.consultation_details ?| array['clinicalAssessment','clinical_assessment','riskAssessment','risk_assessment','clinicalAssessmentHistory']
          and (v_from is null or coalesce(c.visit_date, c.created_at) >= v_from)
          and (v_until is null or coalesce(c.visit_date, c.created_at) < v_until))
        then coalesce(public.analytics_resident_risk(v.resident_id, v_config, false, v_from, v_until) ->> 'riskLevel', 'Unassessed')
        else public.analytics_visit_risk(v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg, v_config) end as risk
      from (select v.id, v.resident_id, r.barangay_id, coalesce(v.visit_date, v.created_at) as occurred_at,
          v.updated_at, v.created_at, v.status, v.consultation_details, v.bp, v.o2sat, v.temperature, v.hr, v.rr,
          v.height_cm, v.weight_kg
        from public.visits v join residents r on r.id = v.resident_id) v$new$);

  if updated = definition and position(
    'else public.analytics_visit_risk(v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg, v_config) end as risk'
    in definition
  ) = 0 then
    raise exception 'Selected-period map risk migration: expected reporting risk marker not found';
  end if;

  if updated is distinct from definition then execute updated; end if;
end;
$migration$;

commit;
notify pgrst, 'reload schema';
