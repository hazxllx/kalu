begin;

create or replace function public.save_maternal_encounter(
  p_maternal_record_id uuid,
  p_resident_id text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_record_patch jsonb,
  p_encounter jsonb
)
returns public.maternal_visits
language plpgsql
security definer
set search_path = public
as $$
declare
  maternal_record public.maternal_records%rowtype;
  resident public.residents%rowtype;
  saved_visit public.maternal_visits%rowtype;
  patch jsonb := coalesce(p_record_patch, '{}'::jsonb);
  encounter jsonb := coalesce(p_encounter, '{}'::jsonb);
begin
  if jsonb_typeof(patch) <> 'object' or jsonb_typeof(encounter) <> 'object' then
    raise exception 'Maternal encounter data must be an object' using errcode = '22023';
  end if;

  if patch - array[
    'tt_td_doses', 'prenatal_micronutrients', 'fim_status', 'iodine_given_date',
    'deworming_date', 'syphilis_screen_date', 'syphilis_result', 'hepb_screen_date',
    'hepb_result', 'hiv_screen_date', 'gdm_screen_date', 'gdm_result',
    'cbc_screen_date', 'cbc_result', 'cbc_iron_given', 'bmi', 'delivery_date',
    'delivery_time', 'delivery_outcome', 'type_of_delivery', 'birth_weight',
    'birth_weight_class', 'place_of_delivery', 'birth_attendant',
    'pregnancy_outcome', 'pregnancy_outcome_date', 'newborn_sex', 'status',
    'pp_checkup_24h', 'pp_checkup_day3', 'pp_checkup_7_14d', 'pp_checkup_6wk',
    'iron_folic_completed_date', 'vitamin_a_given_date'
  ] <> '{}'::jsonb then
    raise exception 'Unsupported maternal record fields' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.status = 'active'
      and p.role in ('health_supervisor', 'phn', 'mho')
  ) then
    raise exception 'An active authorized health worker is required' using errcode = '42501';
  end if;

  if p_idempotency_key is not null then
    select * into saved_visit
    from public.maternal_visits v
    where v.client_operation_key = p_idempotency_key
    for update;
    if found then
      if saved_visit.created_by is distinct from p_actor_id
         or saved_visit.resident_id is distinct from p_resident_id
         or saved_visit.maternal_case_id is distinct from p_maternal_record_id then
        raise exception 'Idempotency key belongs to a different maternal encounter' using errcode = '23505';
      end if;
      return saved_visit;
    end if;
  end if;

  select * into resident from public.residents r where r.id = p_resident_id;
  if not found then
    raise exception 'Resident record not found' using errcode = '23503';
  end if;

  select * into maternal_record
  from public.maternal_records m
  where m.id = p_maternal_record_id and m.resident_id = p_resident_id
  for update;
  if not found then
    raise exception 'Maternal record does not belong to this resident' using errcode = '23503';
  end if;

  if nullif(encounter->>'visit_date', '') is null
     or coalesce(encounter->>'visit_type', '') not in ('prenatal', 'intrapartum', 'postpartum')
     or (encounter ? 'clinical_data' and jsonb_typeof(encounter->'clinical_data') <> 'object') then
    raise exception 'Maternal encounter details are invalid' using errcode = '22023';
  end if;

  update public.maternal_records m set
    prenatal_visits = case when encounter->>'visit_type' = 'prenatal' then m.prenatal_visits + 1 else m.prenatal_visits end,
    tt_td_doses = case when patch ? 'tt_td_doses' then patch->'tt_td_doses' else m.tt_td_doses end,
    prenatal_micronutrients = case when patch ? 'prenatal_micronutrients' then patch->'prenatal_micronutrients' else m.prenatal_micronutrients end,
    fim_status = case when patch ? 'fim_status' then (patch->>'fim_status')::boolean else m.fim_status end,
    iodine_given_date = case when patch ? 'iodine_given_date' then nullif(patch->>'iodine_given_date', '')::date else m.iodine_given_date end,
    deworming_date = case when patch ? 'deworming_date' then nullif(patch->>'deworming_date', '')::date else m.deworming_date end,
    syphilis_screen_date = case when patch ? 'syphilis_screen_date' then nullif(patch->>'syphilis_screen_date', '')::date else m.syphilis_screen_date end,
    syphilis_result = case when patch ? 'syphilis_result' then patch->>'syphilis_result' else m.syphilis_result end,
    hepb_screen_date = case when patch ? 'hepb_screen_date' then nullif(patch->>'hepb_screen_date', '')::date else m.hepb_screen_date end,
    hepb_result = case when patch ? 'hepb_result' then patch->>'hepb_result' else m.hepb_result end,
    hiv_screen_date = case when patch ? 'hiv_screen_date' then nullif(patch->>'hiv_screen_date', '')::date else m.hiv_screen_date end,
    gdm_screen_date = case when patch ? 'gdm_screen_date' then nullif(patch->>'gdm_screen_date', '')::date else m.gdm_screen_date end,
    gdm_result = case when patch ? 'gdm_result' then patch->>'gdm_result' else m.gdm_result end,
    cbc_screen_date = case when patch ? 'cbc_screen_date' then nullif(patch->>'cbc_screen_date', '')::date else m.cbc_screen_date end,
    cbc_result = case when patch ? 'cbc_result' then patch->>'cbc_result' else m.cbc_result end,
    cbc_iron_given = case when patch ? 'cbc_iron_given' then (patch->>'cbc_iron_given')::boolean else m.cbc_iron_given end,
    bmi = case when patch ? 'bmi' then nullif(patch->>'bmi', '')::numeric else m.bmi end,
    delivery_date = case when patch ? 'delivery_date' then nullif(patch->>'delivery_date', '')::date else m.delivery_date end,
    delivery_time = case when patch ? 'delivery_time' then patch->>'delivery_time' else m.delivery_time end,
    delivery_outcome = case when patch ? 'delivery_outcome' then patch->>'delivery_outcome' else m.delivery_outcome end,
    type_of_delivery = case when patch ? 'type_of_delivery' then patch->>'type_of_delivery' else m.type_of_delivery end,
    birth_weight = case when patch ? 'birth_weight' then patch->>'birth_weight' else m.birth_weight end,
    birth_weight_class = case when patch ? 'birth_weight_class' then patch->>'birth_weight_class' else m.birth_weight_class end,
    place_of_delivery = case when patch ? 'place_of_delivery' then patch->>'place_of_delivery' else m.place_of_delivery end,
    birth_attendant = case when patch ? 'birth_attendant' then patch->>'birth_attendant' else m.birth_attendant end,
    pregnancy_outcome = case when patch ? 'pregnancy_outcome' then patch->>'pregnancy_outcome' else m.pregnancy_outcome end,
    pregnancy_outcome_date = case when patch ? 'pregnancy_outcome_date' then nullif(patch->>'pregnancy_outcome_date', '')::date else m.pregnancy_outcome_date end,
    newborn_sex = case when patch ? 'newborn_sex' then patch->>'newborn_sex' else m.newborn_sex end,
    status = case when patch ? 'status' then patch->>'status' else m.status end,
    pp_checkup_24h = case when patch ? 'pp_checkup_24h' then nullif(patch->>'pp_checkup_24h', '')::date else m.pp_checkup_24h end,
    pp_checkup_day3 = case when patch ? 'pp_checkup_day3' then nullif(patch->>'pp_checkup_day3', '')::date else m.pp_checkup_day3 end,
    pp_checkup_7_14d = case when patch ? 'pp_checkup_7_14d' then nullif(patch->>'pp_checkup_7_14d', '')::date else m.pp_checkup_7_14d end,
    pp_checkup_6wk = case when patch ? 'pp_checkup_6wk' then nullif(patch->>'pp_checkup_6wk', '')::date else m.pp_checkup_6wk end,
    iron_folic_completed_date = case when patch ? 'iron_folic_completed_date' then nullif(patch->>'iron_folic_completed_date', '')::date else m.iron_folic_completed_date end,
    vitamin_a_given_date = case when patch ? 'vitamin_a_given_date' then nullif(patch->>'vitamin_a_given_date', '')::date else m.vitamin_a_given_date end
  where m.id = p_maternal_record_id and m.resident_id = p_resident_id;

  insert into public.maternal_visits (
    resident_id, maternal_case_id, visit_date, visit_type, blood_pressure,
    weight, height_cm, provider, notes, clinical_data, created_by, client_operation_key
  ) values (
    p_resident_id, p_maternal_record_id, (encounter->>'visit_date')::date,
    encounter->>'visit_type', coalesce(encounter->>'blood_pressure', ''),
    nullif(encounter->>'weight', '')::numeric,
    nullif(encounter->>'height_cm', '')::numeric,
    coalesce(encounter->>'provider', ''), coalesce(encounter->>'notes', ''),
    coalesce(encounter->'clinical_data', '{}'::jsonb), p_actor_id, p_idempotency_key
  ) returning * into saved_visit;

  insert into public.health_audit_logs (
    actor_id, action, entity_type, entity_id, municipality_id, barangay_id
  ) values (
    p_actor_id, 'MATERNALVISITS_CREATED', 'maternal_visits', saved_visit.id::text,
    resident.municipality_id, resident.barangay_id
  );

  return saved_visit;
end;
$$;

revoke all on function public.save_maternal_encounter(uuid, text, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_maternal_encounter(uuid, text, uuid, text, jsonb, jsonb) to service_role;

commit;
