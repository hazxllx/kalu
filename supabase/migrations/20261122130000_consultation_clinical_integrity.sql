-- Complete consultation validation and immutable, attributed clinical history.
-- Legacy/imported visits are retained; the authenticated API stamps v2 writes.
begin;

alter table public.clinical_assessment_protocols add column if not exists rules jsonb not null default '{}'::jsonb;

alter table public.clinical_assessment_protocol_history add column if not exists rules jsonb not null default '{}'::jsonb;

create or replace function public.record_clinical_protocol_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.active then
    insert into public.clinical_assessment_protocol_history
      (municipality_id, version, thresholds, rules, approved_by, approved_at, review_reference)
    values (new.municipality_id, new.version, new.thresholds, new.rules, new.approved_by, new.approved_at, new.review_reference);
  end if;
  return new;
end;
$$;

revoke all on function public.record_clinical_protocol_history() from public, anon, authenticated;

drop trigger if exists clinical_protocol_history_update on public.clinical_assessment_protocols;

create trigger clinical_protocol_history_update after update on public.clinical_assessment_protocols for each row
  when (new.active and (new.version,new.thresholds,new.rules,new.approved_by,new.approved_at,new.review_reference)
    is distinct from (old.version,old.thresholds,old.rules,old.approved_by,old.approved_at,old.review_reference))
  execute function public.record_clinical_protocol_history();

create or replace function public.bp_classification_json(p_systolic numeric, p_diastolic numeric, p_emergency boolean default false)
returns jsonb language plpgsql immutable as $$
declare v_code text; v_label text; v_message text; v_severity integer;
begin
  if p_systolic is null or p_diastolic is null or p_systolic < 40 or p_systolic > 300
    or p_diastolic < 20 or p_diastolic > 200 or p_systolic <= p_diastolic
    or p_systolic <> trunc(p_systolic) or p_diastolic <> trunc(p_diastolic) then return null; end if;
  if p_systolic >= 180 or p_diastolic >= 120 then
    v_code := case when p_emergency then 'emergency' else 'crisis' end;
    v_label := case when p_emergency then 'Severely Elevated BP With Danger Signs' else 'Severely Elevated Blood Pressure' end;
    v_message := 'Prompt reassessment and clinical evaluation are required. Assess for danger signs; this warning is not an automated diagnosis.';
    v_severity := case when p_emergency then 5 else 4 end;
  elsif p_systolic >= 140 or p_diastolic >= 90 then
    v_code := 'stage2'; v_label := 'Stage 2 Hypertension'; v_severity := 3;
    v_message := 'Hypertension-range reading. Arrange appropriate reassessment and clinical follow-up; one reading does not establish a diagnosis.';
  elsif p_systolic >= 130 or p_diastolic >= 80 then
    v_code := 'stage1'; v_label := 'Stage 1 Hypertension'; v_severity := 2;
    v_message := 'Repeat measurement and assess in clinical context. This classification is not a diagnosis.';
  elsif p_systolic < 90 or p_diastolic < 60 then
    v_code := 'low'; v_label := 'Low Blood Pressure / Hypotension'; v_severity := 1;
    v_message := 'Low reading. Recheck and evaluate symptoms, baseline and clinical context; this is not a definitive diagnosis.';
  elsif p_systolic >= 120 then
    v_code := 'elevated'; v_label := 'Elevated'; v_severity := 1;
    v_message := 'Consider repeat measurement and routine monitoring according to the clinical protocol.';
  else
    v_code := 'normal'; v_label := 'Normal'; v_severity := 0; v_message := 'Blood pressure is within the adult reference range.';
  end if;
  return jsonb_build_object('code',v_code,'label',v_label,'category',v_label,'severity',v_severity,
    'systolic',p_systolic,'diastolic',p_diastolic,'message',v_message,'classificationVersion','bp-v1',
    'emergency',v_code='emergency','emergencySymptomsPresent',p_emergency,
    'hypotensionPresent',p_systolic<90 or p_diastolic<60,'interpretationStandard','adult_screening_reference',
    'referralEvaluationRequired',v_code in ('crisis','emergency'));
end;
$$;

create or replace function public.validate_consultation_clinical_integrity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_details jsonb := coalesce(new.consultation_details,'{}'::jsonb);
  v_v2 boolean := v_details->>'clinicalValidationVersion' = 'consultation-v2';
  v_actor uuid; v_profile public.profiles%rowtype; v_resident public.residents%rowtype;
  v_measure record; v_prescription jsonb; v_field text; v_quantity text;
  v_medicine public.medicines%rowtype; v_date date; v_time text; v_age integer;
  v_snapshot jsonb; v_old_history jsonb; v_new_history jsonb; v_length integer;
  v_parts text[]; v_systolic integer; v_diastolic integer; v_emergency boolean;
begin
  if tg_op = 'UPDATE' and old.consultation_details->>'clinicalValidationVersion' = 'consultation-v2' and not coalesce(v_v2,false) then
    raise exception 'The clinical validation version cannot be removed' using errcode='23514';
  end if;
  if not coalesce(v_v2,false) then return new; end if;
  if tg_op='UPDATE' and (to_jsonb(new)-array['updated_at','consultation_effects_completed_at','consultation_date'])
    = (to_jsonb(old)-array['updated_at','consultation_effects_completed_at','consultation_date']) then return new; end if;
  select * into strict v_resident from public.residents where id=new.resident_id;
  if coalesce(v_details->>'lastModifiedBy','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'An authenticated clinical amendment actor is required' using errcode='23514';
  end if;
  v_actor := (v_details->>'lastModifiedBy')::uuid;
  if auth.uid() is not null and auth.uid()<>v_actor then
    raise exception 'The clinical amendment actor must match the authenticated user' using errcode='42501';
  end if;
  select * into v_profile from public.profiles where id=v_actor;
  if not found or v_profile.status<>'active' or v_profile.role not in ('health_supervisor','phn','rhu_personnel','mho')
    or v_profile.municipality_id is null or v_profile.municipality_id is distinct from v_resident.municipality_id
    or (v_profile.role='health_supervisor' and (v_profile.barangay_id is null or v_profile.barangay_id is distinct from v_resident.barangay_id)) then
    raise exception 'The clinical amendment actor is outside the resident scope' using errcode='42501';
  end if;
  if not public.personnel_actor_has_permission(v_actor,case when tg_op='INSERT' then 'consultation.conduct' else 'consultation.records.update' end) then
    raise exception 'The clinical amendment actor lacks permission' using errcode='42501';
  end if;
  if v_details#>>'{clinicalAssessment,status}'='reviewed' and v_details#>>'{clinicalAssessment,reviewStatus}'='reviewed'
    and (tg_op='INSERT' or v_details#>>'{clinicalAssessment,review,at}' is distinct from old.consultation_details#>>'{clinicalAssessment,review,at}') then
    if v_details#>>'{clinicalAssessment,review,by}' is distinct from v_actor::text
      or v_details#>>'{clinicalAssessment,assessedBy}' is distinct from v_actor::text
      or length(trim(coalesce(v_details#>>'{clinicalAssessment,review,reason}','')))<12 then
      raise exception 'An attributed clinical review and meaningful reason are required' using errcode='23514';
    end if;
    begin
      if coalesce(v_details#>>'{clinicalAssessment,assessedAt}','')::timestamptz
        is distinct from coalesce(v_details#>>'{clinicalAssessment,review,at}','')::timestamptz then
        raise exception 'Clinical assessment and review timestamps must agree' using errcode='23514';
      end if;
      if coalesce(v_details#>>'{clinicalAssessment,review,at}','')::timestamptz>clock_timestamp()+interval '5 minutes' then
        raise exception 'Clinical review time cannot be in the future' using errcode='23514';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Clinical review time is invalid' using errcode='23514';
    end;
  end if;
  for v_measure in select * from (values
    ('temperature',new.temperature,25::numeric,46::numeric,false),
    ('pulseRate',new.hr,20::numeric,250::numeric,true),
    ('respiratoryRate',new.rr,5::numeric,80::numeric,true),
    ('height',new.height_cm,30::numeric,250::numeric,false),
    ('weight',new.weight_kg,1::numeric,400::numeric,false),
    ('oxygenSaturation',new.o2sat,50::numeric,100::numeric,false)
  ) as measured(field,value,minimum,maximum,whole_number) loop
    if v_measure.value is null or v_measure.value::text in ('NaN','Infinity','-Infinity')
      or v_measure.value<v_measure.minimum or v_measure.value>v_measure.maximum
      or (v_measure.whole_number and v_measure.value<>trunc(v_measure.value)) then
      raise exception 'Invalid or missing required vital: %',v_measure.field using errcode='23514';
    end if;
  end loop;
  v_parts:=regexp_match(coalesce(new.bp,''),'^\s*([0-9]{2,3})\s*/\s*([0-9]{2,3})\s*$');
  if v_parts is null then
    raise exception 'Valid systolic and diastolic blood pressure are required' using errcode='23514';
  end if;
  v_systolic:=v_parts[1]::integer; v_diastolic:=v_parts[2]::integer;
  if v_systolic not between 40 and 300 or v_diastolic not between 20 and 200 or v_systolic<=v_diastolic then
    raise exception 'Invalid systolic and diastolic blood pressure' using errcode='23514';
  end if;
  if coalesce(v_details->>'consultationDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(v_details->>'consultationTime','') !~ '^([01]\d|2[0-3]):[0-5]\d$'
    or v_details->>'consultationTimezone' is distinct from 'Asia/Manila' then
    raise exception 'A valid Manila clinical date, time and timezone are required' using errcode='23514';
  end if;
  begin v_date := (v_details->>'consultationDate')::date;
  exception when others then raise exception 'Consultation date is invalid' using errcode='23514'; end;
  v_time := v_details->>'consultationTime';
  if date_trunc('minute',new.visit_date at time zone 'Asia/Manila') is distinct from (v_date::text || ' ' || v_time)::timestamp
    or (tg_op='INSERT' and new.visit_date is distinct from ((v_date::text || ' ' || v_time)::timestamp at time zone 'Asia/Manila'))
    or (tg_op='UPDATE' and new.visit_date is distinct from old.visit_date
      and new.visit_date is distinct from ((v_date::text || ' ' || v_time)::timestamp at time zone 'Asia/Manila')) then
    raise exception 'The stored timestamp must match the selected Manila clinical date and time' using errcode='23514';
  end if;
  new.bmi := round(new.weight_kg / power(new.height_cm / 100.0,2),1);
  v_age := case when v_resident.birth_date is not null then extract(year from age(v_date,v_resident.birth_date))::integer else v_resident.age end;
  new.bmi_category := case when v_details#>>'{clinicalAssessment,inputs,pregnancy,isPregnant}'='true' then 'Pregnancy assessment'
    when v_age is null or v_age<18 then 'Age-specific assessment required'
    when new.bmi<18.5 then 'Underweight' when new.bmi<25 then 'Normal range' when new.bmi<30 then 'Overweight' else 'Obesity range' end;
  select exists(select 1 from jsonb_each(coalesce(v_details->'clinicalIndicators','{}'::jsonb)) signs
    where signs.value='true'::jsonb and signs.key=any(array['chestPain','shortnessOfBreath','backPain','numbnessOrWeakness',
      'visionChanges','difficultySpeaking','acuteNeurologicalSymptoms','severeBreathingDifficulty','suspectedStroke',
      'alteredConsciousness','convulsions','visualDisturbance','acuteCardiovascularSymptoms'])
    union all select 1 from jsonb_each(coalesce(v_details#>'{clinicalAssessment,inputs,indicators}','{}'::jsonb)) signs
    where signs.value='true'::jsonb and signs.key=any(array['chestPain','shortnessOfBreath','backPain','numbnessOrWeakness',
      'visionChanges','difficultySpeaking','acuteNeurologicalSymptoms','severeBreathingDifficulty','suspectedStroke',
      'alteredConsciousness','convulsions','visualDisturbance','acuteCardiovascularSymptoms'])) into v_emergency;
  v_snapshot := public.bp_classification_json(v_systolic,v_diastolic,v_emergency);
  if v_age is not null and v_age<18 and coalesce(v_details#>>'{clinicalAssessment,inputs,pregnancy,isPregnant}','false')<>'true' then
    v_snapshot:=v_snapshot || jsonb_build_object('interpretationStandard','pediatric_assessment_required','hypotensionPresent',null);
    if v_systolic<180 and v_diastolic<120 then
      v_snapshot := v_snapshot || jsonb_build_object('code','pediatric_reference','label','Age-specific BP Assessment',
        'category','Age-specific BP Assessment','severity',1,
        'message','Use pediatric blood pressure percentiles for age, sex and height. Adult categories do not apply.');
    end if;
  end if;
  new.bp_classification := v_snapshot;
  if jsonb_typeof(coalesce(new.medications,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(new.medications,'[]'::jsonb))>50 then
    raise exception 'Prescriptions must be a structured list of at most 50 entries' using errcode='23514';
  end if;
  for v_prescription in select value from jsonb_array_elements(coalesce(new.medications,'[]'::jsonb)) loop
    -- An untouched historical prescription is not a new prescribing act.
    if tg_op='UPDATE' and exists(select 1 from jsonb_array_elements(coalesce(old.medications,'[]'::jsonb)) item where item=v_prescription) then continue; end if;
    for v_field in select unnest(array['genericName','route','frequency','duration','quantity']) loop
      if jsonb_typeof(v_prescription->v_field) is distinct from 'string' or length(trim(v_prescription->>v_field))=0 then
        raise exception 'Required prescription field: %',v_field using errcode='23514';
      end if;
    end loop;
    if v_prescription->>'route' not in ('Oral','Intravenous (IV)','Intramuscular (IM)','Subcutaneous (SC)','Intradermal (ID)',
      'Topical','Sublingual','Buccal','Rectal','Vaginal','Inhalation','Nasal','Ophthalmic','Otic','Transdermal') then
      raise exception 'Unsupported prescription route' using errcode='23514';
    end if;
    if v_prescription->>'frequency' not in ('Once daily','Twice daily','Three times daily','Four times daily','Every 4 hours',
      'Every 6 hours','Every 8 hours','Every 12 hours','Every 24 hours','As prescribed','As needed (PRN)') then
      raise exception 'Unsupported prescription frequency' using errcode='23514';
    end if;
    v_quantity := trim(v_prescription->>'quantity');
    if v_quantity !~ '^\d+(\.\d+)?(\s+[A-Za-z][A-Za-z\s./()-]*)?$' or split_part(v_quantity,' ',1)::numeric<=0 then
      raise exception 'Prescription quantity must be positive with valid units' using errcode='23514';
    end if;
    if v_prescription->>'frequency'='As needed (PRN)' and length(trim(coalesce(v_prescription->>'prnIndication','')))=0 then
      raise exception 'PRN indication or instructions are required' using errcode='23514';
    end if;
    if coalesce(v_prescription->>'medicineId','')='' then
      if v_prescription->>'source' is distinct from 'custom' or v_prescription->'custom' is distinct from 'true'::jsonb then
        raise exception 'A custom medicine must be explicitly documented as custom' using errcode='23514';
      end if;
    else
      if v_prescription->'custom' is distinct from 'false'::jsonb then
        raise exception 'Registered catalog medicines cannot be marked custom' using errcode='23514';
      end if;
      if v_prescription->>'medicineId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Select a registered medicine' using errcode='23514';
      end if;
      select * into v_medicine from public.medicines where id=(v_prescription->>'medicineId')::uuid;
      if not found or not v_medicine.active or v_medicine.generic_name is distinct from v_prescription->>'genericName'
        or coalesce(v_medicine.brand_name,'') is distinct from coalesce(v_prescription->>'brandName','')
        or coalesce(v_medicine.strength,'') is distinct from coalesce(v_prescription->>'strength','')
        or coalesce(v_medicine.dosage_form,'') is distinct from coalesce(v_prescription->>'dosageForm','')
        or v_medicine.source is distinct from v_prescription->>'source' then
        raise exception 'The prescription medicine does not match the registered catalog' using errcode='23514';
      end if;
    end if;
  end loop;
  if tg_op='UPDATE' then
    v_old_history := coalesce(old.consultation_details->'clinicalAssessmentHistory','[]'::jsonb);
    v_new_history := coalesce(new.consultation_details->'clinicalAssessmentHistory','[]'::jsonb);
    if jsonb_typeof(v_old_history)='array' then
      v_length := jsonb_array_length(v_old_history);
      if jsonb_typeof(v_new_history)<>'array' or jsonb_array_length(v_new_history)<v_length
        or exists(select 1 from jsonb_array_elements(v_old_history) with ordinality history(item,n)
          where item is distinct from v_new_history->(n::integer-1)) then
        raise exception 'Saved clinical assessment history is append-only' using errcode='23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists visits_consultation_clinical_integrity on public.visits;

create trigger visits_consultation_clinical_integrity before insert or update on public.visits
  for each row execute function public.validate_consultation_clinical_integrity();

revoke all on function public.validate_consultation_clinical_integrity() from public, anon, authenticated;

create or replace function public.audit_consultation_clinical_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_before jsonb; v_after jsonb; v_actor uuid; v_resident public.residents%rowtype;
begin
  if tg_op='INSERT' and new.consultation_details->>'clinicalValidationVersion' is distinct from 'consultation-v2' then return new; end if;
  v_after := to_jsonb(new)-array['updated_at','consultation_effects_completed_at','consultation_date'];
  if tg_op='UPDATE' then
    v_before := to_jsonb(old)-array['updated_at','consultation_effects_completed_at','consultation_date'];
    if v_before=v_after then return new; end if;
  end if;
  if coalesce(new.consultation_details->>'lastModifiedBy',new.recorded_by_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_actor := coalesce(new.consultation_details->>'lastModifiedBy',new.recorded_by_id)::uuid;
  end if;
  select * into strict v_resident from public.residents where id=new.resident_id;
  insert into public.health_audit_logs(actor_id,action,entity_type,entity_id,municipality_id,barangay_id,metadata)
  values(v_actor,case when tg_op='INSERT' then 'CONSULTATION_CLINICAL_CREATED'
    when new.consultation_details#>>'{clinicalAssessment,review,at}' is distinct from old.consultation_details#>>'{clinicalAssessment,review,at}'
      then 'CONSULTATION_RISK_REVIEWED' else 'CONSULTATION_CLINICAL_AMENDED' end,
    'visits',new.id,v_resident.municipality_id,v_resident.barangay_id,jsonb_build_object('before',v_before,'after',v_after));
  return new;
end;
$$;

drop trigger if exists visits_consultation_clinical_audit on public.visits;

create trigger visits_consultation_clinical_audit after insert or update on public.visits
  for each row execute function public.audit_consultation_clinical_change();

revoke all on function public.audit_consultation_clinical_change() from public, anon, authenticated;

create or replace function public.sync_consultation_followup_amendment()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_date date; v_followup public.follow_ups%rowtype; v_resident public.residents%rowtype;
  v_actor uuid; v_count integer; v_changed boolean; v_created boolean:=false;
begin
  if new.consultation_details->>'clinicalValidationVersion' is distinct from 'consultation-v2'
    or (new.consultation_details->>'nextVisitDate' is not distinct from old.consultation_details->>'nextVisitDate'
      and new.consultation_details->>'adviceGiven' is not distinct from old.consultation_details->>'adviceGiven') then return new; end if;
  v_date:=nullif(new.consultation_details->>'nextVisitDate','')::date;
  v_actor:=(new.consultation_details->>'lastModifiedBy')::uuid;
  select * into strict v_resident from public.residents where id=new.resident_id;
  select count(*) into v_count from public.follow_ups where consultation_id=new.id
    and client_operation_key like 'consultation-followup:' || new.id || ':%'
    and status not in ('Completed','Missed','Cancelled','Rejected');
  if v_count>1 then raise exception 'Review the multiple active consultation follow-ups before changing the plan' using errcode='23514'; end if;
  select * into v_followup from public.follow_ups where consultation_id=new.id
    and client_operation_key like 'consultation-followup:' || new.id || ':%'
    and status not in ('Completed','Missed','Cancelled','Rejected') for update;
  if found then
    v_changed:=v_followup.scheduled_date is distinct from v_date;
    if v_changed and v_followup.schedule_response_status in ('Reschedule Requested','Cancellation Requested') then
      raise exception 'Review the pending resident schedule request before changing the follow-up date' using errcode='23514';
    end if;
    update public.follow_ups set scheduled_date=coalesce(v_date,scheduled_date),
      status=case when v_date is null then 'Cancelled' else status end,
      notes=coalesce(new.consultation_details->>'adviceGiven','') where id=v_followup.id;
  elsif v_date is not null then
    insert into public.follow_ups(resident_id,consultation_id,created_by,client_operation_key,purpose,scheduled_date,
      notes,assigned_provider,status,requires_resident_response,schedule_response_status)
    values(new.resident_id,new.id,v_actor,'consultation-followup:' || new.id || ':' || v_date::text,
      coalesce(nullif(new.chief_complaint,''),'Consultation') || ' follow-up',v_date,
      coalesce(new.consultation_details->>'adviceGiven',''),new.recorded_by_name,'Scheduled',false,'Default Confirmed')
    on conflict(client_operation_key) where client_operation_key is not null do nothing returning * into v_followup;
    v_created:=found;
    if v_created and v_resident.auth_user_id is not null then
      insert into public.notifications(recipient_id,category,title,message,related_type,related_id)
      values(v_resident.auth_user_id,'reminder','Follow-up scheduled',
        'A follow-up has been scheduled. Review the appointment and request a change if needed.','follow_ups',v_followup.id::text);
    end if;
  end if;
  if v_followup.id is not null then
    insert into public.health_audit_logs(actor_id,action,entity_type,entity_id,municipality_id,barangay_id,metadata)
    values(v_actor,case when v_created then 'FOLLOWUPS_CREATED' else 'FOLLOWUPS_UPDATED' end,'follow_ups',v_followup.id::text,
      v_resident.municipality_id,v_resident.barangay_id,jsonb_build_object('sourceConsultationId',new.id,'scheduledDate',v_date));
  end if;
  return new;
end;
$$;

drop trigger if exists visits_consultation_followup_amendment on public.visits;

create trigger visits_consultation_followup_amendment after update on public.visits
  for each row execute function public.sync_consultation_followup_amendment();

revoke all on function public.sync_consultation_followup_amendment() from public,anon,authenticated;

-- Extend the shipped idempotent completion transaction instead of creating a
-- second completion/counter mechanism. The internal implementation is private.
do $$ begin
  if to_regprocedure('public.complete_consultation_operation_v1(text,uuid)') is null then
    alter function public.complete_consultation_operation(text,uuid) rename to complete_consultation_operation_v1;
  end if;
end $$;

revoke all on function public.complete_consultation_operation_v1(text,uuid) from public,anon,authenticated,service_role;

create or replace function public.complete_consultation_operation(p_visit_id text,p_creator_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_visit public.visits%rowtype; v_followup public.follow_ups%rowtype; v_result jsonb; v_id uuid;
begin
  select * into v_visit from public.visits where id=p_visit_id for update;
  if not found or v_visit.recorded_by_id is distinct from p_creator_id::text then raise exception 'Consultation author mismatch' using errcode='42501'; end if;
  v_result := public.complete_consultation_operation_v1(p_visit_id,p_creator_id);
  if v_visit.consultation_effects_completed_at is null and v_result->>'followUpId' is not null then
    v_id := (v_result->>'followUpId')::uuid;
    update public.follow_ups set status=case when status='Pending' then 'Scheduled' else status end,
      requires_resident_response=false,resident_decision=null,resident_decision_at=null,resident_decision_reason='',
      schedule_response_status='Default Confirmed' where id=v_id and resident_decision='pending';
    update public.notifications set title='Follow-up scheduled',
      message='A follow-up has been scheduled. Review the appointment and request a change if needed.'
    where related_type='follow_ups' and related_id=v_id::text and title='New follow-up requires your response';
  end if;
  if nullif(v_visit.consultation_details->>'followUpId','') is not null then
    begin v_id := (v_visit.consultation_details->>'followUpId')::uuid;
    exception when others then raise exception 'Invalid follow-up identifier' using errcode='23514'; end;
    select * into v_followup from public.follow_ups where id=v_id for update;
    if not found or v_followup.resident_id is distinct from v_visit.resident_id
      or (nullif(v_followup.linked_service_id,'') is not null and v_followup.linked_service_id<>v_visit.id)
      or (v_followup.consultation_id is not null and v_followup.consultation_id<>v_visit.id)
      or (v_followup.status in ('Completed','Cancelled','Missed','Rejected') and v_followup.linked_service_id is distinct from v_visit.id) then
      raise exception 'The selected follow-up is closed, owned by another resident or already linked' using errcode='23514';
    end if;
    if v_followup.linked_service_id is distinct from v_visit.id then
      update public.follow_ups set consultation_id=v_visit.id,linked_service_type='consultation',linked_service_id=v_visit.id,
        status='Completed',completed_at=v_visit.visit_date where id=v_id;
      insert into public.health_audit_logs(actor_id,action,entity_type,entity_id,metadata)
      values(p_creator_id,'FOLLOWUP_COMPLETED_BY_CONSULTATION','follow_ups',v_id::text,jsonb_build_object('consultationId',v_visit.id));
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.complete_consultation_operation(text,uuid) from public,anon,authenticated;

grant execute on function public.complete_consultation_operation(text,uuid) to service_role;

create or replace function public.consultation_clinical_schema_ready()
returns boolean language sql stable security definer set search_path=public as $$
  select to_regprocedure('public.resident_clinical_risk_context(text)') is not null
    and to_regprocedure('public.persist_resident_risk(text,jsonb)') is not null
    and (select count(*)=5 from pg_trigger where tgrelid='public.visits'::regclass and tgenabled<>'D'
      and tgname in ('visits_consultation_clinical_integrity','visits_consultation_clinical_audit',
        'visits_consultation_followup_amendment','zz_visits_resident_clinical_risk_guard','visits_resident_risk_after_insert'));
$$;

revoke all on function public.consultation_clinical_schema_ready() from public,anon,authenticated;

grant execute on function public.consultation_clinical_schema_ready() to service_role;

notify pgrst,'reload schema';

commit;
