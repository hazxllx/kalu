-- supabase/migrations/20261123030000_bp_classification_five_categories.sql
-- Align newly validated consultation BP snapshots with the shared five-category
-- reference rules. Existing historical snapshots are deliberately unchanged.
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
    v_label := 'Hypertensive Crisis';
    v_message := case when p_emergency
      then 'Crisis-range blood pressure with emergency symptoms requires immediate emergency evaluation. Do not delay care to repeat measurements or complete this form.'
      else 'A reading in the hypertensive crisis range requires prompt clinical evaluation. A single reading is not a diagnosis.'
    end;
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
  elsif p_systolic >= 120 then
    v_code := 'elevated';
    v_label := 'Elevated';
    v_message := 'Elevated reading. Recheck and monitor according to the clinical protocol.';
    v_severity := 1;
  else
    v_code := 'normal';
    v_label := 'Normal';
    v_message := case when v_hypotension
      then 'Low reading. Recheck and assess symptoms, baseline and clinical context; this classification is not a diagnosis.'
      else 'Blood pressure is within the reference range.'
    end;
    v_severity := 0;
  end if;

  return jsonb_build_object(
    'code', v_code,
    'label', v_label,
    'category', v_label,
    'severity', v_severity,
    'systolic', p_systolic,
    'diastolic', p_diastolic,
    'message', v_message,
    'classificationVersion', 'bp-v2',
    'emergency', v_code = 'crisis' and p_emergency,
    'emergencySymptomsPresent', p_emergency,
    'hypotensionPresent', v_hypotension,
    'interpretationStandard', 'adult_screening_reference',
    'referralEvaluationRequired', v_code = 'crisis',
    'urgency', case when v_code <> 'crisis' then null when p_emergency then 'immediate' else 'prompt' end
  );
end;
$$;

revoke all on function public.bp_classification_json(numeric, numeric, boolean) from public, anon, authenticated;

commit;
