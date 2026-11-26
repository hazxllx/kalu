-- supabase/migrations/20261120210000_bp_classification_integrity.sql
-- Persist the server-computed shared BP snapshot through the atomic triage RPC.
-- No backfill: historical measurements and classification snapshots are retained.
do $$
declare
  definition text;
  updated text;
begin
  definition := pg_get_functiondef('public.create_submitted_triage(uuid,text,uuid,jsonb,jsonb)'::regprocedure);
  if position('bp_classification = excluded.bp_classification' in definition) > 0
    and position('blood_sugar, bp_classification,' in definition) > 0
    and position('''bloodPressureClassification''' in definition) > 0 then return; end if;
  updated := replace(definition,
    'bp, hr, rr, o2sat, temperature, height_cm, weight_kg, bmi, bmi_category, blood_sugar,',
    'bp, hr, rr, o2sat, temperature, height_cm, weight_kg, bmi, bmi_category, blood_sugar, bp_classification,');
  updated := replace(updated,
    'nullif(p_visit->>''blood_sugar'', '''')::numeric, handoff_at,',
    'nullif(p_visit->>''blood_sugar'', '''')::numeric, nullif(p_visit->''bp_classification'', ''null''::jsonb), handoff_at,');
  updated := replace(updated,
    '''chiefComplaint'', coalesce(p_visit->>''chief_complaint'', ''''),',
    '''bloodPressureClassification'', nullif(p_visit->''bp_classification'', ''null''::jsonb), ''chiefComplaint'', coalesce(p_visit->>''chief_complaint'', ''''),');
  updated := replace(updated,
    'bp = excluded.bp, hr = excluded.hr,',
    'bp_classification = excluded.bp_classification, bp = excluded.bp, hr = excluded.hr,');
  if updated = definition or position('bp_classification = excluded.bp_classification' in updated) = 0
    or position('blood_sugar, bp_classification,' in updated) = 0
    or position('''bloodPressureClassification''' in updated) = 0 then
    raise exception 'Could not extend atomic triage with the BP snapshot';
  end if;
  execute updated;
end;
$$;

-- Validate only new/changed measurements, so old rows remain readable/editable.
create or replace function public.validate_visit_bp_measurement()
returns trigger language plpgsql set search_path = public as $$
declare
  parts text[];
begin
  if tg_op = 'UPDATE' and new.bp is not distinct from old.bp then return new; end if;
  if new.bp is null or btrim(new.bp) = '' then
    new.bp_classification := null;
    return new;
  end if;
  parts := regexp_match(new.bp, '^\s*([0-9]{2,3})\s*/\s*([0-9]{2,3})\s*$');
  if parts is null or parts[1]::integer not between 40 and 300
    or parts[2]::integer not between 20 and 200 or parts[1]::integer <= parts[2]::integer then
    raise exception using errcode = '23514', message = 'Invalid systolic/diastolic blood pressure measurement';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_visit_bp_measurement on public.visits;
create trigger validate_visit_bp_measurement before insert or update of bp on public.visits
for each row execute function public.validate_visit_bp_measurement();
