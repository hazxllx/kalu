-- supabase/migrations/20261119010000_rhu_triage_integrity.sql
-- RHU triage integrity: preserve walk-in age and immutable hand-off observations.
begin;

alter table public.residents add column if not exists age integer;
alter table public.residents drop constraint if exists residents_age_valid;
alter table public.residents add constraint residents_age_valid check (age is null or age between 0 and 120) not valid;

alter table public.visits add column if not exists triage_snapshot jsonb;
alter table public.visits
  add column if not exists client_submission_id uuid,
  add column if not exists client_submission_fingerprint text;
create unique index if not exists visits_client_submission_id_unique
  on public.visits (client_submission_id) where client_submission_id is not null;
alter table public.visits drop constraint if exists visits_client_submission_fingerprint_valid;
alter table public.visits add constraint visits_client_submission_fingerprint_valid check (
  client_submission_id is null or (client_submission_fingerprint is not null and client_submission_fingerprint ~ '^[0-9a-f]{64}$')
);
comment on column public.visits.triage_snapshot is
  'Server-captured resident identity and triage observations at PHN hand-off; never rewritten by consultation edits.';
comment on column public.visits.client_submission_id is
  'Client-generated UUID for one atomic RHU triage patient-plus-visit submission; immutable and unique.';
comment on column public.visits.client_submission_fingerprint is
  'SHA-256 fingerprint of the normalized triage request excluding its clientSubmissionId.';


create or replace function public.guard_triage_snapshot()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.triage_snapshot is not null then
    if new.triage_snapshot is distinct from old.triage_snapshot
      or new.bp is distinct from old.bp or new.hr is distinct from old.hr
      or new.rr is distinct from old.rr or new.o2sat is distinct from old.o2sat
      or new.temperature is distinct from old.temperature
      or new.height_cm is distinct from old.height_cm or new.weight_kg is distinct from old.weight_kg
      or new.blood_sugar is distinct from old.blood_sugar or new.bmi is distinct from old.bmi
      or new.bmi_category is distinct from old.bmi_category
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
  end if;
  return new;
end;
$$;

drop trigger if exists visits_guard_triage_snapshot on public.visits;
create trigger visits_guard_triage_snapshot before update on public.visits
  for each row execute function public.guard_triage_snapshot();
revoke all on function public.guard_triage_snapshot() from public, anon, authenticated;

create or replace function public.create_submitted_triage(
  p_submission_id uuid,
  p_fingerprint text,
  p_actor_id uuid,
  p_resident jsonb,
  p_visit jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor public.profiles%rowtype;
  resident_row public.residents%rowtype;
  visit_row public.visits%rowtype;
  existing_visit public.visits%rowtype;
  resident_id text;
  new_resident boolean := p_resident is not null;
  requested_barangay uuid;
  handoff_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;
  if p_submission_id is null or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid triage operation identity';
  end if;

  select * into actor from public.profiles where id = p_actor_id for share;
  if not found or actor.status is distinct from 'active'
    or actor.role not in ('bhw', 'rhu_personnel', 'health_supervisor') then
    raise exception using errcode = '42501', message = 'Active intake assignment required';
  end if;
  if actor.municipality_id is null
    or (actor.role in ('bhw', 'health_supervisor') and actor.barangay_id is null)
    or (actor.role = 'rhu_personnel' and (actor.facility_id is null or not coalesce('triage' = any(actor.rhu_stations), false))) then
    raise exception using errcode = '42501', message = 'Current triage scope required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rhu-triage:' || p_submission_id::text, 0));
  select * into existing_visit from public.visits where client_submission_id = p_submission_id;
  if found then
    if existing_visit.recorded_by_id is distinct from p_actor_id::text
      or existing_visit.client_submission_fingerprint is distinct from p_fingerprint then
      raise exception using errcode = '23505', message = 'Triage operation key belongs to another request';
    end if;
    select * into strict resident_row from public.residents where id = existing_visit.resident_id;
    if resident_row.municipality_id is distinct from actor.municipality_id
      or (actor.role in ('bhw', 'health_supervisor') and resident_row.barangay_id is distinct from actor.barangay_id)
      or (actor.role = 'rhu_personnel' and existing_visit.facility_id is distinct from actor.facility_id) then
      raise exception using errcode = '42501', message = 'Existing triage operation is outside current assignment';
    end if;
    return jsonb_build_object('visit', to_jsonb(existing_visit), 'resident', to_jsonb(resident_row), 'deduplicated', true);
  end if;

  if new_resident then
    requested_barangay := nullif(p_resident->>'barangay_id', '')::uuid;
    if requested_barangay is null
      or not exists (select 1 from public.barangays b where b.id = requested_barangay
        and b.municipality_id = actor.municipality_id and b.status = 'Active'
        and public.is_approved_barangay_name(b.name))
      or (actor.role in ('bhw', 'health_supervisor') and requested_barangay <> actor.barangay_id) then
      raise exception using errcode = '42501', message = 'Resident barangay outside current assignment';
    end if;
    if nullif(btrim(p_resident->>'first_name'), '') is null
      or nullif(p_resident->>'age', '') is null
      or nullif(p_resident->>'age', '')::integer not between 0 and 120
      or coalesce(p_resident->>'sex', '') not in ('Female', 'Male', 'Other') then
      raise exception using errcode = '22023', message = 'Invalid resident demographics';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      'rhu-triage-identity:' || actor.municipality_id::text || ':' ||
      lower(btrim(coalesce(p_resident->>'last_name', ''))) || ':' || lower(btrim(p_resident->>'first_name')) || ':' ||
      lower(btrim(coalesce(p_resident->>'middle_name', ''))) || ':' || coalesce(p_resident->>'birth_date', ''), 0));
    if exists (select 1 from public.residents r where r.municipality_id = actor.municipality_id
      and lower(btrim(r.last_name)) = lower(btrim(coalesce(p_resident->>'last_name', '')))
      and lower(btrim(r.first_name)) = lower(btrim(p_resident->>'first_name'))
      and lower(btrim(r.middle_name)) = lower(btrim(coalesce(p_resident->>'middle_name', '')))
      and (nullif(p_resident->>'birth_date', '') is null
        or r.birth_date is not distinct from nullif(p_resident->>'birth_date', '')::date)) then
      raise exception using errcode = '23505', message = 'A matching resident already exists';
    end if;
    insert into public.residents (
      id, health_record_no, last_name, first_name, middle_name, suffix, birth_date, age,
      birth_place, sex, civil_status, religion, employment_status, father_name, mother_name,
      is_4ps_member, philhealth_no, current_address, permanent_address, cellphone_no, identity_no,
      barangay, barangay_id, municipality_id, created_by_id, created_by_role
    ) values (
      p_resident->>'id', p_resident->>'health_record_no', btrim(coalesce(p_resident->>'last_name', '')),
      btrim(p_resident->>'first_name'), coalesce(p_resident->>'middle_name', ''), coalesce(p_resident->>'suffix', ''),
      nullif(p_resident->>'birth_date', '')::date, (p_resident->>'age')::integer,
      coalesce(p_resident->>'birth_place', ''), p_resident->>'sex', coalesce(p_resident->>'civil_status', ''),
      coalesce(p_resident->>'religion', ''), coalesce(p_resident->>'employment_status', ''),
      coalesce(p_resident->>'father_name', ''), coalesce(p_resident->>'mother_name', ''),
      coalesce((p_resident->>'is_4ps_member')::boolean, false), coalesce(p_resident->>'philhealth_no', ''),
      coalesce(p_resident->>'current_address', ''), coalesce(p_resident->>'permanent_address', ''),
      coalesce(p_resident->>'cellphone_no', ''), coalesce(p_resident->>'identity_no', ''),
      (select name from public.barangays where id = requested_barangay), requested_barangay,
      actor.municipality_id, p_actor_id::text, actor.role::text
    ) returning * into resident_row;
    resident_id := resident_row.id;
  else
    resident_id := p_visit->>'resident_id';
    select * into resident_row from public.residents where id = resident_id for share;
    if not found or resident_row.municipality_id is distinct from actor.municipality_id
      or (actor.role in ('bhw', 'health_supervisor') and resident_row.barangay_id is distinct from actor.barangay_id)
      or not exists (select 1 from public.barangays b where b.id = resident_row.barangay_id
        and b.municipality_id = actor.municipality_id and b.status = 'Active') then
      raise exception using errcode = '42501', message = 'Resident outside current assignment';
    end if;
  end if;

  if actor.role = 'rhu_personnel' and p_visit->>'facility_id' is distinct from actor.facility_id::text then
    raise exception using errcode = '42501', message = 'Visit facility outside current assignment';
  end if;
  if actor.role <> 'rhu_personnel' and nullif(p_visit->>'facility_id', '') is not null then
    raise exception using errcode = '42501', message = 'Unexpected visit facility';
  end if;

  -- Referral-linked encounters are one durable receiving encounter. Lock the
  -- referral, reject an already-submitted encounter, and reuse an owned draft.
  if nullif(p_visit->>'referral_id', '') is not null then
    declare
      referral_row public.health_referrals%rowtype;
      draft_visit public.visits%rowtype;
    begin
      select * into referral_row from public.health_referrals
        where id = (p_visit->>'referral_id')::uuid for update;
      if not found or referral_row.resident_id is distinct from resident_id
        or referral_row.status not in ('Accepted', 'In Progress')
        or referral_row.recipient_personnel_id is distinct from p_actor_id
        or referral_row.recipient_facility_id is distinct from actor.facility_id
        or not coalesce(public.canonical_referral_is_recipient(p_actor_id, referral_row), false) then
        raise exception using errcode = '42501', message = 'Referral is outside the current receiving assignment';
      end if;
      select * into draft_visit from public.visits where referral_id = referral_row.id
        order by created_at asc limit 1 for update;
      if found and draft_visit.status <> 'draft' then
        raise exception using errcode = '23505', message = 'This referral already has a submitted encounter';
      end if;
      if found and (draft_visit.recorded_by_id is distinct from p_actor_id::text
        or draft_visit.resident_id is distinct from resident_id
        or draft_visit.facility_id is distinct from actor.facility_id) then
        raise exception using errcode = '42501', message = 'Only the draft owner may submit this referral';
      end if;
      if found then
        p_visit := jsonb_set(p_visit, '{id}', to_jsonb(draft_visit.id), true);
      end if;
    end;
  end if;

  handoff_at := clock_timestamp();
  insert into public.visits (
    id, resident_id, recorded_by_id, recorded_by_role, recorded_by_name,
    responsible_personnel_id, responsible_personnel_name, facility_id, status, visit_date,
    chief_complaint, clinical_history, findings, treatment_given, recommendation,
    bp, hr, rr, o2sat, temperature, height_cm, weight_kg, bmi, bmi_category, blood_sugar,
    submitted_at, received_at, referral_id, triage_snapshot, client_submission_id, client_submission_fingerprint
  ) values (
    p_visit->>'id', resident_id, p_actor_id::text, actor.role::text, actor.full_name,
    p_actor_id, actor.full_name, actor.facility_id,
    'submitted', (p_visit->>'visit_date')::timestamptz, coalesce(p_visit->>'chief_complaint', ''),
    coalesce(p_visit->>'clinical_history', ''), '', '', '',
    coalesce(p_visit->>'bp', ''), nullif(p_visit->>'hr', '')::numeric, nullif(p_visit->>'rr', '')::numeric,
    nullif(p_visit->>'o2sat', '')::numeric, nullif(p_visit->>'temperature', '')::numeric,
    nullif(p_visit->>'height_cm', '')::numeric, nullif(p_visit->>'weight_kg', '')::numeric,
    nullif(p_visit->>'bmi', '')::numeric, coalesce(p_visit->>'bmi_category', ''),
    nullif(p_visit->>'blood_sugar', '')::numeric, handoff_at, nullif(p_visit->>'received_at', '')::timestamptz,
    nullif(p_visit->>'referral_id', '')::uuid,
    jsonb_build_object(
      'residentId', resident_row.id,
      'resident', jsonb_build_object('id', resident_row.id, 'firstName', resident_row.first_name,
        'lastName', resident_row.last_name, 'middleName', resident_row.middle_name,
        'age', case when resident_row.birth_date is not null
          then extract(year from age((p_visit->>'visit_date')::timestamptz, resident_row.birth_date))::integer
          else resident_row.age end, 'sex', resident_row.sex, 'barangay', resident_row.barangay),
      'vitals', jsonb_build_object('bp', coalesce(p_visit->>'bp', ''), 'hr', nullif(p_visit->>'hr', '')::numeric,
        'rr', nullif(p_visit->>'rr', '')::numeric, 'o2sat', nullif(p_visit->>'o2sat', '')::numeric,
        'temperature', nullif(p_visit->>'temperature', '')::numeric, 'heightCm', nullif(p_visit->>'height_cm', '')::numeric,
        'weightKg', nullif(p_visit->>'weight_kg', '')::numeric, 'bmi', nullif(p_visit->>'bmi', '')::numeric,
        'bmiCategory', coalesce(p_visit->>'bmi_category', ''), 'bloodSugar', nullif(p_visit->>'blood_sugar', '')::numeric),
      'chiefComplaint', coalesce(p_visit->>'chief_complaint', ''),
      'clinicalHistory', coalesce(p_visit->>'clinical_history', ''),
      'visitDate', (p_visit->>'visit_date')::timestamptz,
      'recordedBy', p_actor_id, 'recordedByName', actor.full_name,
      'submittedAt', handoff_at, 'triageWarnings', coalesce(p_visit->'triage_snapshot'->'triageWarnings', '[]'::jsonb)
    ), p_submission_id, p_fingerprint
  ) on conflict (id) do update set
    status = excluded.status, visit_date = excluded.visit_date,
    chief_complaint = excluded.chief_complaint, clinical_history = excluded.clinical_history,
    bp = excluded.bp, hr = excluded.hr, rr = excluded.rr, o2sat = excluded.o2sat,
    temperature = excluded.temperature, height_cm = excluded.height_cm, weight_kg = excluded.weight_kg,
    bmi = excluded.bmi, bmi_category = excluded.bmi_category, blood_sugar = excluded.blood_sugar,
    recorded_by_name = excluded.recorded_by_name, submitted_at = excluded.submitted_at,
    received_at = coalesce(public.visits.received_at, excluded.received_at),
    triage_snapshot = excluded.triage_snapshot, client_submission_id = excluded.client_submission_id,
    client_submission_fingerprint = excluded.client_submission_fingerprint
  where public.visits.status = 'draft' and public.visits.triage_snapshot is null
    and public.visits.recorded_by_id = p_actor_id::text
    and public.visits.resident_id = excluded.resident_id
    and public.visits.facility_id is not distinct from excluded.facility_id
    and public.visits.referral_id is not null and public.visits.referral_id = excluded.referral_id
  returning * into visit_row;
  if not found then
    raise exception using errcode = '23505', message = 'The encounter changed during triage handoff';
  end if;

  return jsonb_build_object('visit', to_jsonb(visit_row), 'resident', to_jsonb(resident_row), 'deduplicated', false);
end;
$$;

revoke all on function public.create_submitted_triage(uuid, text, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_submitted_triage(uuid, text, uuid, jsonb, jsonb) to service_role;

commit;
notify pgrst, 'reload schema';
