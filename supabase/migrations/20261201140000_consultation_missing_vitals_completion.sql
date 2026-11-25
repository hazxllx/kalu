-- Allow consultation staff to add only vital signs absent from the original
-- triage snapshot. The immutable snapshot remains the record of what triage
-- actually collected; the sparse supplement identifies later measurements.
begin;

create or replace function public.guard_triage_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  snapshot_vitals jsonb;
  consultation_vitals jsonb;
  item record;
  expected text;
begin
  if tg_op <> 'UPDATE' or old.triage_snapshot is null then
    return new;
  end if;

  if new.triage_snapshot is distinct from old.triage_snapshot
    or new.resident_id is distinct from old.resident_id
    or new.recorded_by_id is distinct from old.recorded_by_id
    or new.recorded_by_name is distinct from old.recorded_by_name
    or new.submitted_at is distinct from old.submitted_at
    or new.chief_complaint is distinct from old.chief_complaint
    or new.clinical_history is distinct from old.clinical_history
    or new.visit_date is distinct from old.visit_date
    or new.client_submission_id is distinct from old.client_submission_id
    or new.client_submission_fingerprint is distinct from old.client_submission_fingerprint then
    raise exception 'Triage observations are immutable after hand-off' using errcode = '23514';
  end if;

  snapshot_vitals := old.triage_snapshot->'vitals';
  consultation_vitals := new.consultation_details->'consultationVitals';
  if consultation_vitals is distinct from old.consultation_details->'consultationVitals'
    and (new.status::text is distinct from 'completed'
      or new.consultation_details->>'clinicalIntegrityVersion' is distinct from 'consultation-clinical-v1') then
    raise exception 'Missing triage measurements may only be recorded with a completed consultation' using errcode = '23514';
  end if;
  if consultation_vitals is not null then
    if jsonb_typeof(consultation_vitals) is distinct from 'object'
      or exists (
        select 1 from jsonb_object_keys(consultation_vitals) as fields(key)
        where key not in ('bloodPressure','temperature','pulseRate','respiratoryRate','height','weight','oxygenSaturation')
      ) then
      raise exception 'Consultation vital supplement contains unsupported fields' using errcode = '23514';
    end if;
    if old.consultation_details->'consultationVitals' is not null and exists (
      select 1 from jsonb_object_keys(old.consultation_details->'consultationVitals') as fields(key)
      where not (consultation_vitals ? key)
    ) then
      raise exception 'Saved consultation vital supplements cannot be removed' using errcode = '23514';
    end if;

    for item in select key, value from jsonb_each(consultation_vitals) loop
      case item.key
        when 'bloodPressure' then
          expected := item.value #>> '{}';
          if jsonb_typeof(item.value) is distinct from 'string'
            or nullif(btrim(coalesce(snapshot_vitals->>'bp','')), '') is not null
            or nullif(btrim(coalesce(new.bp,'')), '') is null
            or btrim(new.bp) is distinct from btrim(expected) then
            raise exception 'Consultation may only add blood pressure missing from triage' using errcode = '23514';
          end if;
        when 'temperature' then
          expected := item.value #>> '{}';
          if jsonb_typeof(item.value) is distinct from 'number'
            or nullif(btrim(coalesce(snapshot_vitals->>'temperature','')), '') is not null
            or new.temperature is null or new.temperature is distinct from expected::numeric then
            raise exception 'Consultation may only add temperature missing from triage' using errcode = '23514';
          end if;
        when 'pulseRate' then
          expected := item.value #>> '{}';
          if jsonb_typeof(item.value) is distinct from 'number'
            or nullif(btrim(coalesce(snapshot_vitals->>'hr','')), '') is not null
            or new.hr is null or new.hr is distinct from expected::numeric then
            raise exception 'Consultation may only add pulse rate missing from triage' using errcode = '23514';
          end if;
        when 'respiratoryRate' then
          expected := item.value #>> '{}';
          if jsonb_typeof(item.value) is distinct from 'number'
            or nullif(btrim(coalesce(snapshot_vitals->>'rr','')), '') is not null
            or new.rr is null or new.rr is distinct from expected::numeric then
            raise exception 'Consultation may only add respiratory rate missing from triage' using errcode = '23514';
          end if;
        when 'height' then
          expected := item.value #>> '{}';
          if jsonb_typeof(item.value) is distinct from 'number'
            or nullif(btrim(coalesce(snapshot_vitals->>'heightCm','')), '') is not null
            or new.height_cm is null or new.height_cm is distinct from expected::numeric then
            raise exception 'Consultation may only add height missing from triage' using errcode = '23514';
          end if;
        when 'weight' then
          expected := item.value #>> '{}';
          if jsonb_typeof(item.value) is distinct from 'number'
            or nullif(btrim(coalesce(snapshot_vitals->>'weightKg','')), '') is not null
            or new.weight_kg is null or new.weight_kg is distinct from expected::numeric then
            raise exception 'Consultation may only add weight missing from triage' using errcode = '23514';
          end if;
        when 'oxygenSaturation' then
          expected := item.value #>> '{}';
          if jsonb_typeof(item.value) is distinct from 'number'
            or nullif(btrim(coalesce(snapshot_vitals->>'o2sat','')), '') is not null
            or new.o2sat is null or new.o2sat is distinct from expected::numeric then
            raise exception 'Consultation may only add oxygen saturation missing from triage' using errcode = '23514';
          end if;
      end case;
    end loop;
  end if;

  if new.bp is distinct from old.bp and not (
    nullif(btrim(coalesce(snapshot_vitals->>'bp','')), '') is null
    and coalesce(consultation_vitals ? 'bloodPressure', false)
    and btrim(new.bp) is not distinct from btrim(consultation_vitals->>'bloodPressure')
  ) then raise exception 'Triage blood pressure is immutable after hand-off' using errcode = '23514'; end if;
  if new.temperature is distinct from old.temperature and not (
    nullif(btrim(coalesce(snapshot_vitals->>'temperature','')), '') is null
    and coalesce(consultation_vitals ? 'temperature', false)
    and new.temperature is not distinct from (consultation_vitals->>'temperature')::numeric
  ) then raise exception 'Triage temperature is immutable after hand-off' using errcode = '23514'; end if;
  if new.hr is distinct from old.hr and not (
    nullif(btrim(coalesce(snapshot_vitals->>'hr','')), '') is null
    and coalesce(consultation_vitals ? 'pulseRate', false)
    and new.hr is not distinct from (consultation_vitals->>'pulseRate')::numeric
  ) then raise exception 'Triage pulse rate is immutable after hand-off' using errcode = '23514'; end if;
  if new.rr is distinct from old.rr and not (
    nullif(btrim(coalesce(snapshot_vitals->>'rr','')), '') is null
    and coalesce(consultation_vitals ? 'respiratoryRate', false)
    and new.rr is not distinct from (consultation_vitals->>'respiratoryRate')::numeric
  ) then raise exception 'Triage respiratory rate is immutable after hand-off' using errcode = '23514'; end if;
  if new.o2sat is distinct from old.o2sat and not (
    nullif(btrim(coalesce(snapshot_vitals->>'o2sat','')), '') is null
    and coalesce(consultation_vitals ? 'oxygenSaturation', false)
    and new.o2sat is not distinct from (consultation_vitals->>'oxygenSaturation')::numeric
  ) then raise exception 'Triage oxygen saturation is immutable after hand-off' using errcode = '23514'; end if;
  if new.height_cm is distinct from old.height_cm and not (
    nullif(btrim(coalesce(snapshot_vitals->>'heightCm','')), '') is null
    and coalesce(consultation_vitals ? 'height', false)
    and new.height_cm is not distinct from (consultation_vitals->>'height')::numeric
  ) then raise exception 'Triage height is immutable after hand-off' using errcode = '23514'; end if;
  if new.weight_kg is distinct from old.weight_kg and not (
    nullif(btrim(coalesce(snapshot_vitals->>'weightKg','')), '') is null
    and coalesce(consultation_vitals ? 'weight', false)
    and new.weight_kg is not distinct from (consultation_vitals->>'weight')::numeric
  ) then raise exception 'Triage weight is immutable after hand-off' using errcode = '23514'; end if;
  if new.blood_sugar is distinct from old.blood_sugar then
    raise exception 'Triage blood sugar is immutable after hand-off' using errcode = '23514';
  end if;

  if new.bmi is distinct from old.bmi and not (
    new.height_cm is not null and new.weight_kg is not null
    and new.bmi is not distinct from round(new.weight_kg / power(new.height_cm / 100.0, 2), 1)
  ) then raise exception 'BMI must be calculated from the stored consultation height and weight' using errcode = '23514'; end if;
  if new.bmi_category is distinct from old.bmi_category and not (
    new.bmi is not null
    and new.bmi_category is not distinct from case
      when new.bmi < 18.5 then 'Underweight'
      when new.bmi < 25 then 'Normal'
      when new.bmi < 30 then 'Overweight'
      else 'Obese'
    end
  ) then raise exception 'BMI category must match the stored BMI' using errcode = '23514'; end if;

  return new;
end;
$$;

revoke all on function public.guard_triage_snapshot() from public, anon, authenticated;

commit;
