begin;

create or replace function public.resident_risk_clinical_details(p_actor_id uuid, p_resident_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor public.profiles%rowtype;
  resident public.residents%rowtype;
  risk jsonb;
  result jsonb;
begin
  select * into actor from public.profiles where id = p_actor_id;
  if not found or actor.status::text <> 'active' or actor.municipality_id is null
    or actor.role::text not in ('health_supervisor','phn','mho')
    or not public.personnel_actor_has_permission(actor.id,'reports.analytics.view') then
    raise exception using errcode='42501', message='Resident clinical details are not available to this account.';
  end if;

  select * into resident
  from public.residents r
  where r.id = p_resident_id
    and r.municipality_id = actor.municipality_id
    and (actor.role::text <> 'health_supervisor' or r.barangay_id = actor.barangay_id);
  if not found then
    raise exception using errcode='42501', message='Resident clinical details are outside the current account scope.';
  end if;

  risk := public.analytics_resident_risk(
    resident.id,
    public.analytics_risk_configuration(),
    true
  );

  select jsonb_build_object(
    'residentId', resident.id,
    'birthDate', resident.birth_date,
    'resident', jsonb_build_object(
      'id', resident.id,
      'name', trim(concat_ws(' ', resident.first_name, nullif(resident.middle_name, ''), resident.last_name, nullif(resident.suffix, ''))),
      'barangay', (select b.name from public.barangays b where b.id = resident.barangay_id),
      'age', case when resident.birth_date is not null then extract(year from age(current_date, resident.birth_date))::integer end,
      'sex', nullif(resident.sex, '')
    ),
    'riskLevel', nullif(risk->>'riskLevel', ''),
    'riskAssessmentStatus', nullif(risk->>'riskAssessmentStatus', ''),
    'riskAssessedAt', risk->>'riskAssessedAt',
    'riskScore', risk->'riskScore',
    'riskReason', nullif(risk->>'riskReason', ''),
    'riskFactors', coalesce((
      select jsonb_agg(
        factor.value || case when nullif(criteria.description, '') is not null
          then jsonb_build_object('description', criteria.description) else '{}'::jsonb end
        order by factor.ordinal
      )
      from jsonb_array_elements(
        case when jsonb_typeof(risk->'riskFactors') = 'array'
          then risk->'riskFactors' else '[]'::jsonb end
      ) with ordinality as factor(value, ordinal)
      left join public.risk_criteria criteria on criteria.code = factor.value->>'code'
    ), '[]'::jsonb),
    'assessments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'status', v.status,
        'assessmentAt', coalesce(v.visit_date, v.created_at),
        'recordedAt', coalesce(v.recorded_at, v.created_at),
        'recordedBy', nullif(v.recorded_by_name, ''),
        'performedBy', nullif(v.phn_personnel, ''),
        'assessmentType', coalesce(
          nullif(v.health_service_name, ''),
          nullif(v.consultation_details->>'healthServiceName', ''),
          nullif(v.consultation_details->>'consultationType', ''),
          nullif(hs.name, '')
        ),
        'assessmentCategory', coalesce(
          nullif(v.consultation_details->>'healthServiceCategory', ''),
          nullif(hs.category, '')
        ),
        'measurements', jsonb_build_object(
          'bp', nullif(btrim(v.bp), ''),
          'hr', v.hr,
          'rr', v.rr,
          'o2sat', v.o2sat,
          'temperature', v.temperature,
          'heightCm', v.height_cm,
          'weightKg', v.weight_kg,
          'bmi', v.bmi,
          'bmiCategory', nullif(v.bmi_category, ''),
          'bloodSugar', v.blood_sugar
        ),
        'assessmentDetails', jsonb_build_object(
          'chiefComplaint', nullif(v.chief_complaint, ''),
          'clinicalHistory', nullif(v.clinical_history, ''),
          'findings', nullif(v.findings, ''),
          'treatmentGiven', nullif(v.treatment_given, ''),
          'recommendation', nullif(v.recommendation, ''),
          'phnAssessment', nullif(v.phn_assessment, ''),
          'phnNotes', nullif(v.phn_notes, ''),
          'consultationDetails', v.consultation_details,
          'triageSnapshot', v.triage_snapshot
        )
      ) order by coalesce(v.visit_date, v.created_at) desc, v.updated_at desc, v.created_at desc, v.id desc)
      from public.visits v
      left join public.health_services hs on hs.id = v.health_service_id
      where v.resident_id = resident.id
        and v.status not in ('draft', 'submitted')
        and (
          nullif(btrim(v.bp), '') is not null or v.hr is not null or v.rr is not null
          or v.o2sat is not null or v.temperature is not null or v.height_cm is not null
          or v.weight_kg is not null or v.bmi is not null or v.blood_sugar is not null
          or nullif(btrim(v.chief_complaint), '') is not null
          or nullif(btrim(v.clinical_history), '') is not null
          or nullif(btrim(v.findings), '') is not null
          or nullif(btrim(v.treatment_given), '') is not null
          or nullif(btrim(v.recommendation), '') is not null
          or nullif(btrim(v.phn_assessment), '') is not null
          or nullif(btrim(v.phn_notes), '') is not null
          or v.consultation_details is not null
          or v.triage_snapshot is not null
        )
      ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

revoke all on function public.resident_risk_clinical_details(uuid,text) from public, anon, authenticated;
grant execute on function public.resident_risk_clinical_details(uuid,text) to service_role;

commit;
notify pgrst, 'reload schema';
