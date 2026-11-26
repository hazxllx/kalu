-- supabase/migrations/20261123110000_consultation_bp_urgency_classification.sql
-- Align persisted consultation classifications with the displayed reference labels.
begin;

create or replace function public.bp_classification_json(
  p_systolic numeric,
  p_diastolic numeric,
  p_emergency boolean default false
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_code text;
  v_label text;
  v_message text;
  v_severity integer;
  v_hypotension boolean;
begin
  if p_systolic is null or p_diastolic is null
    or p_systolic < 40 or p_systolic > 300
    or p_diastolic < 20 or p_diastolic > 200
    or p_systolic <= p_diastolic
    or p_systolic <> trunc(p_systolic)
    or p_diastolic <> trunc(p_diastolic) then
    return null;
  end if;

  v_hypotension := p_systolic < 90 or p_diastolic < 60;
  if p_systolic >= 180 or p_diastolic >= 120 then
    v_code := 'crisis';
    v_label := 'Hypertensive Urgency or Emergency';
    v_message := 'Urgency-range blood pressure requires immediate clinical assessment. Follow the applicable emergency protocol; a single reading alone does not diagnose a hypertensive emergency.';
    v_severity := 4;
  elsif p_systolic >= 140 or p_diastolic >= 90 then
    v_code := 'stage2';
    v_label := 'Stage 2 Hypertension';
    v_message := 'Very high blood pressure reading. Prompt clinical assessment is needed.';
    v_severity := 3;
  elsif p_systolic >= 130 or p_diastolic >= 80 then
    v_code := 'stage1';
    v_label := 'Stage 1 Hypertension';
    v_message := 'High blood pressure reading. Arrange appropriate clinical assessment.';
    v_severity := 2;
  elsif p_systolic >= 120 and p_systolic < 130 and p_diastolic < 80 then
    v_code := 'elevated';
    v_label := 'Elevated Blood Pressure';
    v_message := 'Elevated reading. Recheck and monitor according to the clinical protocol.';
    v_severity := 1;
  elsif p_systolic < 120 and p_diastolic < 80 then
    v_code := 'normal';
    v_label := 'Normal Blood Pressure';
    v_message := case when v_hypotension
      then 'Low reading. Recheck and assess symptoms, baseline and clinical context; this classification is not a diagnosis.'
      else 'Blood pressure is within the reference range.'
    end;
    v_severity := 0;
  else
    return null;
  end if;

  return jsonb_build_object(
    'code', v_code,
    'label', v_label,
    'category', v_label,
    'severity', v_severity,
    'systolic', p_systolic,
    'diastolic', p_diastolic,
    'message', v_message,
    'classificationVersion', 'bp-v3',
    'emergency', v_code = 'crisis' and p_emergency,
    'emergencySymptomsPresent', p_emergency,
    'hypotensionPresent', v_hypotension,
    'interpretationStandard', 'adult_screening_reference',
    'referralEvaluationRequired', v_code = 'crisis',
    'urgency', case when v_code = 'crisis' then 'immediate' else null end
  );
end;
$$;

revoke all on function public.bp_classification_json(numeric, numeric, boolean) from public, anon, authenticated;

commit;
