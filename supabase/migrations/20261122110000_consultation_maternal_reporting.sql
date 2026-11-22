-- Project explicitly classified consultations in the same transaction as visits.
-- No historical case/encounter is backfilled, deleted, or clinically reclassified.
begin;

create unique index if not exists visits_maternal_identity_idx on public.visits(id, resident_id);

create unique index if not exists maternal_records_identity_idx on public.maternal_records(id, resident_id);

create unique index if not exists maternal_records_pregnancy_identity_idx on public.maternal_records(id, pregnancy_id, resident_id);

create unique index if not exists maternal_pregnancies_identity_idx on public.maternal_pregnancies(id, resident_id);

create unique index if not exists delivery_records_maternal_identity_idx on public.delivery_records(id, pregnancy_id, resident_id);

-- A single pointer, not a counter: at most one current representation of a
-- consultation across the legacy, prenatal, and postpartum encounter tables.
create table if not exists public.consultation_maternal_links (
  source_consultation_id text primary key,
  resident_id text not null references public.residents(id) on delete restrict,
  maternal_record_id uuid references public.maternal_records(id) on delete restrict,
  pregnancy_id uuid references public.maternal_pregnancies(id) on delete restrict,
  health_service_id uuid references public.health_services(id) on delete restrict,
  stage text not null check (stage in ('prenatal', 'postpartum')),
  encounter_table text not null check (encounter_table in ('maternal_visits', 'pregnancy_encounters', 'postpartum_encounters')),
  encounter_id uuid not null,
  projection_status text not null check (projection_status in ('active', 'pending', 'reclassified')),
  source_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consultation_maternal_source_identity foreign key (source_consultation_id, resident_id)
    references public.visits(id, resident_id) on delete restrict,
  constraint consultation_maternal_encounter_pointer unique (encounter_table, encounter_id),
  check (maternal_record_id is not null or pregnancy_id is not null)
);

create unique index if not exists consultation_maternal_links_identity_idx
  on public.consultation_maternal_links(source_consultation_id, resident_id);

create table if not exists public.consultation_maternal_audit (
  id uuid primary key default gen_random_uuid(),
  source_consultation_id text not null references public.consultation_maternal_links(source_consultation_id) on delete restrict,
  resident_id text not null references public.residents(id) on delete restrict,
  municipality_id uuid,
  barangay_id uuid,
  actor_id uuid references public.profiles(id) on delete restrict,
  prior_maternal_record_id uuid,
  maternal_record_id uuid,
  prior_pregnancy_id uuid,
  pregnancy_id uuid,
  prior_delivery_record_id uuid references public.delivery_records(id) on delete restrict,
  delivery_record_id uuid references public.delivery_records(id) on delete restrict,
  action text not null check (action in ('created', 'amended', 'reclassified')),
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (prior_maternal_record_id, resident_id) references public.maternal_records(id, resident_id) on delete restrict,
  foreign key (maternal_record_id, resident_id) references public.maternal_records(id, resident_id) on delete restrict,
  foreign key (prior_pregnancy_id, resident_id) references public.maternal_pregnancies(id, resident_id) on delete restrict,
  foreign key (pregnancy_id, resident_id) references public.maternal_pregnancies(id, resident_id) on delete restrict,
  foreign key (prior_delivery_record_id, prior_pregnancy_id, resident_id) references public.delivery_records(id, pregnancy_id, resident_id) on delete restrict,
  foreign key (delivery_record_id, pregnancy_id, resident_id) references public.delivery_records(id, pregnancy_id, resident_id) on delete restrict
);

create index if not exists consultation_maternal_audit_source_idx
  on public.consultation_maternal_audit(source_consultation_id, created_at, id);

do $$
declare t text;
begin
  foreach t in array array['maternal_visits', 'pregnancy_encounters', 'postpartum_encounters'] loop
    execute format('alter table public.%I add column if not exists source_consultation_id text', t);
    execute format('alter table public.%I add column if not exists source_projection_status text', t);
    execute format('alter table public.%I add column if not exists source_consultation_time time', t);
    execute format('alter table public.%I add column if not exists source_snapshot jsonb not null default ''{}''::jsonb', t);
    execute format('create unique index if not exists %I on public.%I(source_consultation_id) where source_consultation_id is not null', t || '_source_consultation_unique', t);
    if not exists (select 1 from pg_constraint where conrelid = format('public.%I', t)::regclass and conname = t || '_source_identity') then
      execute format('alter table public.%I add constraint %I foreign key (source_consultation_id, resident_id) references public.consultation_maternal_links(source_consultation_id, resident_id) on delete restrict', t, t || '_source_identity');
    end if;
    if not exists (select 1 from pg_constraint where conrelid = format('public.%I', t)::regclass and conname = t || '_source_status') then
      execute format($sql$alter table public.%I add constraint %I check (
        (source_consultation_id is null and source_projection_status is null)
        or (source_consultation_id is not null and source_projection_status in ('active', 'pending', 'reclassified', 'superseded'))
      )$sql$, t, t || '_source_status');
    end if;
  end loop;
end;
$$;

alter table public.pregnancy_encounters
  add column if not exists maternal_record_id uuid references public.maternal_records(id) on delete restrict;

alter table public.postpartum_encounters
  add column if not exists maternal_record_id uuid references public.maternal_records(id) on delete restrict;

do $$
declare t text;
begin
  foreach t in array array['pregnancy_encounters', 'postpartum_encounters', 'consultation_maternal_links'] loop
    if not exists (select 1 from pg_constraint where conrelid = format('public.%I', t)::regclass and conname = t || '_case_resident_identity') then
      execute format('alter table public.%I add constraint %I foreign key (maternal_record_id, resident_id) references public.maternal_records(id, resident_id) on delete restrict not valid', t, t || '_case_resident_identity');
    end if;
    if t <> 'consultation_maternal_links' and not exists (select 1 from pg_constraint where conrelid = format('public.%I', t)::regclass and conname = t || '_case_pregnancy_identity') then
      execute format('alter table public.%I add constraint %I foreign key (maternal_record_id, pregnancy_id, resident_id) references public.maternal_records(id, pregnancy_id, resident_id) on delete restrict not valid', t, t || '_case_pregnancy_identity');
    end if;
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.consultation_maternal_links'::regclass and conname = 'consultation_maternal_links_pregnancy_resident_identity') then
    alter table public.consultation_maternal_links add constraint consultation_maternal_links_pregnancy_resident_identity
      foreign key (pregnancy_id, resident_id) references public.maternal_pregnancies(id, resident_id) on delete restrict not valid;
  end if;
end;
$$;

-- Keep historical invalid relationships intact for review, but enforce identity
-- on every new/amended link. None of these foreign keys cascade clinical history.
do $$
declare t text; parent_field text; parent_table text;
begin
  for t, parent_field, parent_table in values
    ('maternal_records', 'pregnancy_id', 'maternal_pregnancies'),
    ('maternal_visits', 'maternal_case_id', 'maternal_records'),
    ('pregnancy_encounters', 'pregnancy_id', 'maternal_pregnancies'),
    ('prenatal_services', 'pregnancy_id', 'maternal_pregnancies'),
    ('delivery_records', 'pregnancy_id', 'maternal_pregnancies'),
    ('postpartum_encounters', 'pregnancy_id', 'maternal_pregnancies'),
    ('postpartum_follow_ups', 'pregnancy_id', 'maternal_pregnancies')
  loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_' || parent_field || '_fkey');
    execute format('alter table public.%I add constraint %I foreign key (%I) references public.%I(id) on delete restrict not valid', t, t || '_' || parent_field || '_fkey', parent_field, parent_table);
    if not exists (select 1 from pg_constraint where conrelid = format('public.%I', t)::regclass and conname = t || '_parent_resident_identity') then
      execute format('alter table public.%I add constraint %I foreign key (%I, resident_id) references public.%I(id, resident_id) on delete restrict not valid', t, t || '_parent_resident_identity', parent_field, parent_table);
    end if;
  end loop;
  foreach t in array array['postpartum_encounters', 'postpartum_follow_ups'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_delivery_record_id_fkey');
    execute format('alter table public.%I add constraint %I foreign key (delivery_record_id) references public.delivery_records(id) on delete restrict not valid', t, t || '_delivery_record_id_fkey');
    if not exists (select 1 from pg_constraint where conrelid = format('public.%I', t)::regclass and conname = t || '_delivery_resident_identity') then
      execute format('alter table public.%I add constraint %I foreign key (delivery_record_id, pregnancy_id, resident_id) references public.delivery_records(id, pregnancy_id, resident_id) on delete restrict not valid', t, t || '_delivery_resident_identity');
    end if;
  end loop;
end;
$$;

create or replace function public.guard_maternal_relationship_identity()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb;
  parent_field text := case when tg_table_name = 'maternal_visits' then 'maternal_case_id' else 'pregnancy_id' end;
  parent_table text := case when tg_table_name = 'maternal_visits' then 'maternal_records' else 'maternal_pregnancies' end;
  parent_resident text;
  parent_barangay uuid;
  parent_municipality uuid;
  resident_row public.residents%rowtype;
  delivery_row public.delivery_records%rowtype;
  pregnancy_row public.maternal_pregnancies%rowtype;
  episode_end date;
begin
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    if n->parent_field is not distinct from o->parent_field
      and n->'resident_id' is not distinct from o->'resident_id'
      and n->'delivery_record_id' is not distinct from o->'delivery_record_id'
      and n->'maternal_record_id' is not distinct from o->'maternal_record_id' then return new; end if;
  end if;
  if nullif(n->>parent_field, '') is null then return new; end if;
  select * into strict resident_row from public.residents where id = new.resident_id for key share;
  execute format('select resident_id, barangay_id, municipality_id from public.%I where id = $1 for share', parent_table)
    into parent_resident, parent_barangay, parent_municipality using (n->>parent_field)::uuid;
  if parent_resident is distinct from new.resident_id
    or parent_barangay is distinct from resident_row.barangay_id
    or parent_municipality is distinct from resident_row.municipality_id then
    raise exception 'Maternal parent must match the encounter resident and current scope' using errcode = '23514';
  end if;
  if tg_table_name = 'maternal_records' and tg_op = 'UPDATE' and n->'pregnancy_id' is distinct from o->'pregnancy_id' then
    select * into strict pregnancy_row from public.maternal_pregnancies where id = (n->>'pregnancy_id')::uuid;
    select min(d.delivery_date) into episode_end from public.delivery_records d where d.pregnancy_id = pregnancy_row.id;
    episode_end := coalesce(episode_end, pregnancy_row.outcome_date);
    if exists (select 1 from public.maternal_visits v where v.maternal_case_id = new.id and v.source_consultation_id is not null
      and v.source_projection_status in ('active', 'pending') and (
        (coalesce(pregnancy_row.lmp_date, pregnancy_row.date_of_registration) is not null and v.visit_date < coalesce(pregnancy_row.lmp_date, pregnancy_row.date_of_registration))
        or (v.visit_type = 'prenatal' and episode_end is not null and v.visit_date > episode_end)
        or (v.visit_type = 'postpartum' and (episode_end is null or v.visit_date < episode_end
          or (select count(*) from public.delivery_records d where d.pregnancy_id = pregnancy_row.id) <> 1))
      )) then raise exception 'Maternal pregnancy link must preserve the dated episode of existing consultation history' using errcode = '23514'; end if;
  end if;
  if n->>'delivery_record_id' is not null then
    select * into delivery_row from public.delivery_records where id = (n->>'delivery_record_id')::uuid for share;
    if not found or delivery_row.pregnancy_id is distinct from (n->>'pregnancy_id')::uuid
      or delivery_row.resident_id is distinct from new.resident_id
      or delivery_row.barangay_id is distinct from resident_row.barangay_id
      or delivery_row.municipality_id is distinct from resident_row.municipality_id then
      raise exception 'Postpartum delivery must match the pregnancy, resident and current scope' using errcode = '23514';
    end if;
  end if;
  if n->>'maternal_record_id' is not null then
    perform 1 from public.maternal_records where id = (n->>'maternal_record_id')::uuid
      and resident_id = new.resident_id and pregnancy_id = (n->>'pregnancy_id')::uuid
      and barangay_id is not distinct from resident_row.barangay_id
      and municipality_id is not distinct from resident_row.municipality_id;
    if not found then raise exception 'Maternal case attribution must match the selected pregnancy and resident' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['maternal_records', 'maternal_visits', 'pregnancy_encounters', 'prenatal_services', 'delivery_records', 'postpartum_encounters', 'postpartum_follow_ups'] loop
    execute format('drop trigger if exists %I on public.%I', 'zy_' || t || '_parent_identity', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.guard_maternal_relationship_identity()', 'zy_' || t || '_parent_identity', t);
  end loop;
end;
$$;

create or replace function public.guard_consultation_maternal_source_row()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
declare link public.consultation_maternal_links%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.source_consultation_id is not null then
      raise exception 'Maternal source clinical history cannot be deleted; amend the consultation instead' using errcode = '23514';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.source_consultation_id is not null then
    if new.source_consultation_id is distinct from old.source_consultation_id or new.resident_id is distinct from old.resident_id then
      raise exception 'Maternal consultation source identity is immutable' using errcode = '23514';
    end if;
  elsif tg_op = 'UPDATE' and new.source_consultation_id is not null then
    raise exception 'A manual maternal encounter cannot be adopted as a consultation projection' using errcode = '23514';
  end if;
  if new.source_consultation_id is not null then
    if pg_trigger_depth() < 2 then raise exception 'Maternal source rows are written only by the clinical visit transaction' using errcode = '42501'; end if;
    select * into strict link from public.consultation_maternal_links where source_consultation_id = new.source_consultation_id;
    if link.resident_id is distinct from new.resident_id then raise exception 'Maternal source resident mismatch' using errcode = '23514'; end if;
    if new.source_projection_status in ('active', 'pending') and (
      link.encounter_table is distinct from tg_table_name or link.encounter_id is distinct from new.id
      or link.projection_status is distinct from new.source_projection_status
      or (tg_table_name = 'maternal_visits' and link.maternal_record_id is distinct from (to_jsonb(new)->>'maternal_case_id')::uuid)
      or (tg_table_name <> 'maternal_visits' and link.pregnancy_id is distinct from (to_jsonb(new)->>'pregnancy_id')::uuid)
    ) then raise exception 'A maternal consultation has only one current encounter representation' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_consultation_maternal_ledger()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' or pg_trigger_depth() < 2 then
    raise exception 'Maternal source linkage is maintained only by clinical visit transactions' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.source_consultation_id is distinct from old.source_consultation_id or new.resident_id is distinct from old.resident_id) then
    raise exception 'Maternal consultation linkage identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_consultation_maternal_audit()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  raise exception 'Maternal consultation audit is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists consultation_maternal_links_guard on public.consultation_maternal_links;

create trigger consultation_maternal_links_guard before insert or update or delete on public.consultation_maternal_links
  for each row execute function public.guard_consultation_maternal_ledger();

drop trigger if exists consultation_maternal_audit_guard on public.consultation_maternal_audit;

create trigger consultation_maternal_audit_guard before update or delete on public.consultation_maternal_audit
  for each row execute function public.guard_consultation_maternal_audit();

do $$
declare t text;
begin
  foreach t in array array['maternal_visits', 'pregnancy_encounters', 'postpartum_encounters'] loop
    execute format('drop trigger if exists %I on public.%I', 'zx_' || t || '_consultation_source', t);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.guard_consultation_maternal_source_row()', 'zx_' || t || '_consultation_source', t);
    execute format('drop policy if exists %I on public.%I', t || '_source_visit_visibility', t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (source_consultation_id is null or exists (select 1 from public.visits v where v.id = source_consultation_id))', t || '_source_visit_visibility', t);
    execute format('revoke truncate, trigger on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

-- Source clinical date/time are explicit Manila values, not upload time or an
-- invented LMP/delivery. Non-source historical consultations remain untouched.
create or replace function public.project_consultation_maternal()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  details jsonb := coalesce(new.consultation_details, '{}'::jsonb);
  context jsonb := details->'maternalContext';
  link public.consultation_maternal_links%rowtype;
  prior_link public.consultation_maternal_links%rowtype;
  resident_row public.residents%rowtype;
  maternal public.maternal_records%rowtype;
  pregnancy public.maternal_pregnancies%rowtype;
  delivery public.delivery_records%rowtype;
  actor public.profiles%rowtype;
  category text;
  source_table text;
  source_id uuid;
  record_id uuid;
  selected_pregnancy_id uuid;
  stage text;
  source_status text;
  clinical_date date;
  clinical_time time;
  start_date date;
  end_date date;
  next_start date;
  lmp date;
  gestation numeric;
  bp_values text[];
  systolic numeric;
  diastolic numeric;
  snapshot jsonb;
  prior_encounter jsonb;
  current_encounter jsonb;
  source_hash text;
  actor_id uuid;
  delivery_count integer;
  prior_exists boolean;
  same_relationship boolean := false;
  same_date boolean := false;
begin
  select * into link from public.consultation_maternal_links where source_consultation_id = new.id for update;
  prior_exists := found;
  prior_link := link;
  select hs.category into category from public.health_services hs where hs.id = new.health_service_id;
  if context = 'null'::jsonb then context := null; end if;
  if context is null and not prior_exists then
    if lower(coalesce(category, '')) = 'maternal' and new.status in ('completed', 'referred') and (
      tg_op = 'INSERT' or new.health_service_id is distinct from old.health_service_id
      or old.status not in ('completed', 'referred')
    ) then raise exception 'Maternal consultations require an explicit saved maternal episode and care stage' using errcode = '23514'; end if;
    return new;
  end if;
  if prior_exists then
    execute format('select to_jsonb(e) from public.%I e where id = $1', link.encounter_table) into prior_encounter using link.encounter_id;
    if prior_encounter is null then raise exception 'Maternal consultation source encounter is missing' using errcode = '23514'; end if;
  end if;
  if context is not null then
    if jsonb_typeof(context) <> 'object' or coalesce(context->>'stage', '') not in ('prenatal', 'postpartum') then
      raise exception 'Maternal context requires a prenatal or postpartum stage' using errcode = '23514';
    end if;
    begin
      record_id := nullif(context->>'maternalRecordId', '')::uuid;
      selected_pregnancy_id := nullif(context->>'pregnancyId', '')::uuid;
      clinical_date := (details->>'consultationDate')::date;
      clinical_time := nullif(details->>'consultationTime', '')::time;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'Maternal consultation requires valid episode IDs and an explicit Manila clinical date/time' using errcode = '23514';
    end;
    if clinical_date is null or coalesce(details->>'consultationDate', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (nullif(details->>'consultationTime', '') is not null and details->>'consultationTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
      raise exception 'Maternal consultation requires a valid explicit Manila clinical date/time' using errcode = '23514';
    end if;
    stage := context->>'stage';
    if record_id is null and selected_pregnancy_id is null then raise exception 'Maternal consultation requires a saved case or pregnancy' using errcode = '23514'; end if;
    same_relationship := prior_exists and link.maternal_record_id is not distinct from record_id
      and link.pregnancy_id is not distinct from selected_pregnancy_id and link.stage = stage
      and link.health_service_id is not distinct from new.health_service_id;
    same_date := prior_exists and prior_encounter->'source_snapshot'->>'clinicalDate' = clinical_date::text;
    if lower(coalesce(category, '')) <> 'maternal' and not same_relationship then
      raise exception 'Maternal context may only be attached to a real selected Maternal service' using errcode = '23514';
    end if;
    select * into strict resident_row from public.residents where id = new.resident_id for key share;
    if record_id is not null then
      select * into maternal from public.maternal_records where id = record_id for share;
      if not found or maternal.resident_id is distinct from new.resident_id
        or (not same_relationship and (maternal.barangay_id is distinct from resident_row.barangay_id or maternal.municipality_id is distinct from resident_row.municipality_id)) then
        raise exception 'Maternal case must belong to the consultation resident and scope' using errcode = '23514';
      end if;
      if maternal.pregnancy_id is distinct from selected_pregnancy_id then
        raise exception 'Maternal case and selected pregnancy must retain their explicit saved relationship' using errcode = '23514';
      end if;
      lmp := maternal.lmp;
      start_date := coalesce(maternal.lmp, maternal.date_of_registration);
      end_date := coalesce(maternal.delivery_date, maternal.pregnancy_outcome_date);
    end if;
    if selected_pregnancy_id is not null then
      select * into pregnancy from public.maternal_pregnancies p where p.id = selected_pregnancy_id for share;
      if not found or pregnancy.resident_id is distinct from new.resident_id
        or (not same_relationship and (pregnancy.barangay_id is distinct from resident_row.barangay_id or pregnancy.municipality_id is distinct from resident_row.municipality_id)) then
        raise exception 'Pregnancy must belong to the consultation resident and scope' using errcode = '23514';
      end if;
      lmp := coalesce(pregnancy.lmp_date, lmp);
      start_date := coalesce(pregnancy.lmp_date, start_date, pregnancy.date_of_registration);
      select min(d.delivery_date) into end_date from public.delivery_records d where d.pregnancy_id = selected_pregnancy_id and d.resident_id = new.resident_id;
      end_date := coalesce(end_date, pregnancy.outcome_date, maternal.delivery_date, maternal.pregnancy_outcome_date);
      select min(s.day) into end_date from (
        select end_date as day union all select pregnancy.outcome_date
        union all select m.delivery_date from public.maternal_records m where m.pregnancy_id = selected_pregnancy_id and m.resident_id = new.resident_id
        union all select m.pregnancy_outcome_date from public.maternal_records m where m.pregnancy_id = selected_pregnancy_id and m.resident_id = new.resident_id
      ) s;
    end if;
    if not (same_relationship and same_date) then
      select min(s.day) into next_start from (
        select coalesce(p.lmp_date, p.date_of_registration) as day from public.maternal_pregnancies p
          where p.resident_id = new.resident_id and p.id is distinct from selected_pregnancy_id
        union all
        select coalesce(m.lmp, m.date_of_registration) from public.maternal_records m
          where m.resident_id = new.resident_id and m.id is distinct from record_id
          and (selected_pregnancy_id is null or m.pregnancy_id is distinct from selected_pregnancy_id)
      ) s where s.day > start_date;
      if (start_date is not null and clinical_date < start_date) or (next_start is not null and clinical_date >= next_start) then
        raise exception 'Maternal clinical date is outside the selected pregnancy episode' using errcode = '23514';
      end if;
      if stage = 'prenatal' and ((end_date is not null and clinical_date > end_date)
        or (end_date is null and lower(coalesce(pregnancy.status, maternal.status, '')) not in ('active', 'lost_to_followup', 'transferred'))) then
        raise exception 'Prenatal clinical date must be within the recorded pregnancy episode' using errcode = '23514';
      end if;
    end if;
    if stage = 'postpartum' and selected_pregnancy_id is not null then
      if same_relationship and link.encounter_table = 'postpartum_encounters' then
        select * into delivery from public.delivery_records where id = (prior_encounter->>'delivery_record_id')::uuid for share;
      else
        select count(*) into delivery_count from public.delivery_records d where d.pregnancy_id = selected_pregnancy_id;
        if delivery_count <> 1 then raise exception 'Postpartum consultation requires one unambiguous real delivery record' using errcode = '23514'; end if;
        select * into delivery from public.delivery_records d where d.pregnancy_id = selected_pregnancy_id for share;
      end if;
      if delivery.id is null or delivery.resident_id is distinct from new.resident_id or delivery.pregnancy_id is distinct from selected_pregnancy_id
        or clinical_date < delivery.delivery_date then raise exception 'Postpartum consultation must reference its real delivery and clinical date' using errcode = '23514'; end if;
    elsif stage = 'postpartum' and (maternal.delivery_date is null or clinical_date < maternal.delivery_date) then
      raise exception 'Postpartum consultation requires a recorded delivery date in its maternal case' using errcode = '23514';
    end if;
    source_table := case when selected_pregnancy_id is null then 'maternal_visits' when stage = 'prenatal' then 'pregnancy_encounters' else 'postpartum_encounters' end;
    source_status := case when new.status in ('completed', 'referred') then 'active' else 'pending' end;
  else
    if lower(coalesce(category, '')) = 'maternal' then raise exception 'Maternal care cannot clear its episode without reclassifying the service' using errcode = '23514'; end if;
    source_table := link.encounter_table;
    source_status := 'reclassified';
    record_id := link.maternal_record_id;
    selected_pregnancy_id := link.pregnancy_id;
    stage := link.stage;
    clinical_date := nullif(details->>'consultationDate', '')::date;
    clinical_time := nullif(details->>'consultationTime', '')::time;
    select * into strict resident_row from public.residents where id = new.resident_id for key share;
  end if;
  snapshot := jsonb_build_object(
    'consultationId', new.id, 'clinicalDate', clinical_date, 'clinicalTime', nullif(details->>'consultationTime', ''), 'timeZone', 'Asia/Manila',
    'maternalContext', context, 'healthServiceId', new.health_service_id, 'healthServiceName', new.health_service_name, 'status', new.status,
    'vitals', jsonb_build_object('bp', new.bp, 'temperature', new.temperature, 'hr', new.hr, 'rr', new.rr, 'o2sat', new.o2sat, 'heightCm', new.height_cm, 'weightKg', new.weight_kg, 'bmi', new.bmi),
    'chiefComplaint', coalesce(details->>'chiefComplaint', new.chief_complaint), 'findings', coalesce(details->>'findings', new.findings),
    'diagnosis', details->>'diagnosis', 'treatmentGiven', coalesce(details->>'treatmentGiven', new.treatment_given),
    'adviceGiven', details->>'adviceGiven', 'remarks', details->>'remarks', 'nextVisitDate', details->>'nextVisitDate',
    'referralRequired', to_jsonb(new)->'referral_required', 'medications', to_jsonb(new)->'medications'
  );
  source_hash := md5(snapshot::text);
  if prior_exists and link.source_hash = source_hash and link.projection_status = source_status then return new; end if;
  begin
    actor_id := coalesce(auth.uid(), nullif(details->>'lastModifiedBy', '')::uuid,
      case when not prior_exists then nullif(new.recorded_by_id, '')::uuid else null end);
  exception when invalid_text_representation then
    raise exception 'Maternal amendment requires a valid server-attributed actor' using errcode = '23514';
  end;
  select * into actor from public.profiles where id = actor_id for share;
  if not found or actor.status <> 'active' or actor.role not in ('admin', 'health_supervisor', 'phn', 'bhw', 'rhu_personnel')
    or (actor.role <> 'admin' and (actor.municipality_id is null or actor.municipality_id is distinct from resident_row.municipality_id))
    or (actor.role in ('health_supervisor', 'bhw') and (actor.barangay_id is null or actor.barangay_id is distinct from resident_row.barangay_id)) then
    raise exception 'Maternal amendment requires an active authorized actor in the resident scope' using errcode = '42501';
  end if;
  if context is not null then
    execute format('select id from public.%I where source_consultation_id = $1', source_table) into source_id using new.id;
    source_id := coalesce(source_id, gen_random_uuid());
  else source_id := link.encounter_id; end if;
  if prior_exists and link.encounter_table <> source_table then
    execute format('update public.%I set source_projection_status = ''superseded'' where id = $1', link.encounter_table) using link.encounter_id;
  end if;
  insert into public.consultation_maternal_links(source_consultation_id, resident_id, maternal_record_id, pregnancy_id, health_service_id, stage,
    encounter_table, encounter_id, projection_status, source_hash)
  values (new.id, new.resident_id, record_id, selected_pregnancy_id, new.health_service_id, stage, source_table, source_id, source_status, source_hash)
  on conflict (source_consultation_id) do update set maternal_record_id = excluded.maternal_record_id,
    pregnancy_id = excluded.pregnancy_id, health_service_id = excluded.health_service_id, stage = excluded.stage,
    encounter_table = excluded.encounter_table, encounter_id = excluded.encounter_id, projection_status = excluded.projection_status,
    source_hash = excluded.source_hash, updated_at = clock_timestamp();
  if source_status = 'reclassified' then
    execute format('update public.%I set source_projection_status = $1, source_snapshot = $2 where id = $3', source_table) using source_status, snapshot, source_id;
  else
    bp_values := regexp_match(new.bp, '^\s*([0-9]{1,3})\s*/\s*([0-9]{1,3})\s*$');
    if bp_values is not null and bp_values[1]::numeric > bp_values[2]::numeric and bp_values[2]::numeric > 0 then
      systolic := bp_values[1]::numeric; diastolic := bp_values[2]::numeric;
    end if;
    gestation := case when lmp is not null and clinical_date >= lmp then round((clinical_date - lmp)::numeric / 7, 2) else null end;
    if source_table = 'maternal_visits' then
      insert into public.maternal_visits(id, resident_id, maternal_case_id, visit_date, visit_type, blood_pressure, weight, height_cm,
        gestational_age_weeks, provider, notes, clinical_data, created_by, source_consultation_id, source_projection_status, source_consultation_time, source_snapshot)
      values (source_id, new.resident_id, record_id, clinical_date, stage, new.bp, new.weight_kg, new.height_cm, gestation,
        new.recorded_by_name, coalesce(details->>'remarks', ''), jsonb_build_object('sourceConsultation', snapshot), actor_id,
        new.id, source_status, clinical_time, snapshot)
      on conflict (source_consultation_id) where source_consultation_id is not null do update set
        maternal_case_id = excluded.maternal_case_id, visit_date = excluded.visit_date, visit_type = excluded.visit_type,
        blood_pressure = excluded.blood_pressure, weight = excluded.weight, height_cm = excluded.height_cm,
        gestational_age_weeks = excluded.gestational_age_weeks, provider = excluded.provider, notes = excluded.notes,
        clinical_data = excluded.clinical_data, source_projection_status = excluded.source_projection_status,
        source_consultation_time = excluded.source_consultation_time, source_snapshot = excluded.source_snapshot;
    elsif source_table = 'pregnancy_encounters' then
      insert into public.pregnancy_encounters(id, pregnancy_id, resident_id, maternal_record_id, encounter_type, encounter_date,
        provider_id, provider_name, gestational_age_weeks, systolic_bp, diastolic_bp, weight_kg, height_cm, bmi,
        clinical_findings, assessment, care_plan, next_visit_planned_date, notes, created_by,
        source_consultation_id, source_projection_status, source_consultation_time, source_snapshot)
      values (source_id, selected_pregnancy_id, new.resident_id, record_id, 'prenatal', clinical_date, actor_id, new.recorded_by_name, gestation,
        systolic, diastolic, new.weight_kg, new.height_cm, new.bmi, coalesce(details->>'findings', new.findings), coalesce(details->>'diagnosis', ''),
        coalesce(details->>'treatmentGiven', new.treatment_given), nullif(details->>'nextVisitDate', '')::date, coalesce(details->>'remarks', ''), actor_id,
        new.id, source_status, clinical_time, snapshot)
      on conflict (source_consultation_id) where source_consultation_id is not null do update set
        pregnancy_id = excluded.pregnancy_id, maternal_record_id = excluded.maternal_record_id, encounter_date = excluded.encounter_date,
        provider_name = excluded.provider_name, gestational_age_weeks = excluded.gestational_age_weeks,
        systolic_bp = excluded.systolic_bp, diastolic_bp = excluded.diastolic_bp, weight_kg = excluded.weight_kg,
        height_cm = excluded.height_cm, bmi = excluded.bmi, clinical_findings = excluded.clinical_findings,
        assessment = excluded.assessment, care_plan = excluded.care_plan, next_visit_planned_date = excluded.next_visit_planned_date,
        notes = excluded.notes, source_projection_status = excluded.source_projection_status,
        source_consultation_time = excluded.source_consultation_time, source_snapshot = excluded.source_snapshot, version = pregnancy_encounters.version + 1;
    else
      insert into public.postpartum_encounters(id, pregnancy_id, delivery_record_id, resident_id, maternal_record_id, encounter_date,
        days_postpartum, provider_id, provider_name, systolic_bp, diastolic_bp, temperature_celsius, weight_kg,
        assessment, care_plan, next_visit_planned_date, notes, created_by,
        source_consultation_id, source_projection_status, source_consultation_time, source_snapshot)
      values (source_id, selected_pregnancy_id, delivery.id, new.resident_id, record_id, clinical_date, clinical_date - delivery.delivery_date,
        actor_id, new.recorded_by_name, systolic, diastolic, new.temperature, new.weight_kg, coalesce(details->>'diagnosis', ''),
        coalesce(details->>'treatmentGiven', new.treatment_given), nullif(details->>'nextVisitDate', '')::date, coalesce(details->>'remarks', ''), actor_id,
        new.id, source_status, clinical_time, snapshot)
      on conflict (source_consultation_id) where source_consultation_id is not null do update set
        pregnancy_id = excluded.pregnancy_id, delivery_record_id = excluded.delivery_record_id, maternal_record_id = excluded.maternal_record_id,
        encounter_date = excluded.encounter_date, days_postpartum = excluded.days_postpartum, provider_name = excluded.provider_name,
        systolic_bp = excluded.systolic_bp, diastolic_bp = excluded.diastolic_bp, temperature_celsius = excluded.temperature_celsius,
        weight_kg = excluded.weight_kg, assessment = excluded.assessment, care_plan = excluded.care_plan,
        next_visit_planned_date = excluded.next_visit_planned_date, notes = excluded.notes,
        source_projection_status = excluded.source_projection_status, source_consultation_time = excluded.source_consultation_time,
        source_snapshot = excluded.source_snapshot, version = postpartum_encounters.version + 1;
    end if;
  end if;
  select * into strict link from public.consultation_maternal_links where source_consultation_id = new.id;
  execute format('select to_jsonb(e) from public.%I e where id = $1', source_table) into current_encounter using source_id;
  insert into public.consultation_maternal_audit(source_consultation_id, resident_id, municipality_id, barangay_id, actor_id,
    prior_maternal_record_id, maternal_record_id, prior_pregnancy_id, pregnancy_id, prior_delivery_record_id, delivery_record_id,
    action, before_snapshot, after_snapshot)
  values (new.id, new.resident_id, resident_row.municipality_id, resident_row.barangay_id, actor_id,
    prior_link.maternal_record_id, link.maternal_record_id, prior_link.pregnancy_id, link.pregnancy_id,
    (prior_encounter->>'delivery_record_id')::uuid, (current_encounter->>'delivery_record_id')::uuid,
    case when not prior_exists then 'created' when source_status = 'reclassified' then 'reclassified' else 'amended' end,
    case when prior_exists then jsonb_build_object('link', to_jsonb(prior_link), 'encounter', prior_encounter) else null end,
    jsonb_build_object('link', to_jsonb(link), 'encounter', current_encounter));
  return new;
end;
$$;

drop trigger if exists visits_maternal_projection on public.visits;

create trigger visits_maternal_projection after insert or update on public.visits
  for each row execute function public.project_consultation_maternal();

alter table public.consultation_maternal_links enable row level security;

alter table public.consultation_maternal_audit enable row level security;

drop policy if exists consultation_maternal_links_read on public.consultation_maternal_links;

create policy consultation_maternal_links_read on public.consultation_maternal_links for select to authenticated using (
  exists (select 1 from public.visits v where v.id = source_consultation_id)
);

drop policy if exists consultation_maternal_audit_read on public.consultation_maternal_audit;

create policy consultation_maternal_audit_read on public.consultation_maternal_audit for select to authenticated using (
  (public.is_admin() or (public.is_staff_active() and exists (
    select 1 from public.residents r where r.id = resident_id and public.profile_covers_barangay(r.barangay_id)
  ))) and exists (select 1 from public.visits v where v.id = source_consultation_id)
);

revoke all on public.consultation_maternal_links, public.consultation_maternal_audit from public, anon, authenticated, service_role;

grant select on public.consultation_maternal_links, public.consultation_maternal_audit to authenticated, service_role;

-- Clinical eligibility stays in the existing JS catalog adapter. This read-only
-- RPC validates REAL case/resident provenance and deduplicates eligible people,
-- keyed by actual indicator + normalized range + care classification + resident.
-- It stores neither guessed rules, arbitrary client eligibility, nor counters.
create or replace function public.m1_maternal_contributors(p_actor_id uuid, p_barangay_id uuid, p_candidates jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare actor public.profiles%rowtype; normalized jsonb; result jsonb; verified_count integer;
begin
  if p_actor_id is null or (auth.uid() is not null and auth.uid() is distinct from p_actor_id) then
    raise exception 'Maternal reporting requires the authenticated actor' using errcode = '42501';
  end if;
  select * into actor from public.profiles where id = p_actor_id;
  if not found or actor.status <> 'active' or actor.role not in ('admin', 'mho', 'phn', 'rhu_personnel', 'health_supervisor', 'bhw')
    or (actor.role <> 'admin' and actor.municipality_id is null)
    or (actor.role in ('health_supervisor', 'bhw') and actor.barangay_id is null) then
    raise exception 'Maternal reporting requires an active scoped staff actor' using errcode = '42501';
  end if;
  if p_barangay_id is not null and ((actor.role in ('health_supervisor', 'bhw') and p_barangay_id is distinct from actor.barangay_id)
    or (actor.role <> 'admin' and not exists (select 1 from public.barangays b where b.id = p_barangay_id and b.municipality_id = actor.municipality_id and b.status <> 'Inactive'))) then
    raise exception 'Maternal reporting barangay is outside the actor scope' using errcode = '42501';
  end if;
  if jsonb_typeof(p_candidates) is distinct from 'array' then raise exception 'Maternal contributors require a candidate array' using errcode = '23514'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'indicatorCode', c."indicatorCode", 'rangeStart', c."rangeStart"::date, 'rangeEnd', c."rangeEnd"::date,
    'classification', c.classification, 'caseSource', c."caseSource", 'caseId', c."caseId"::uuid,
    'residentId', c."residentId", 'eventDate', c."eventDate"::date, 'occurrenceId', c."occurrenceId"
  )), '[]'::jsonb) into normalized
  from jsonb_to_recordset(p_candidates) c("indicatorCode" text, "rangeStart" text, "rangeEnd" text, classification text,
    "caseSource" text, "caseId" text, "residentId" text, "eventDate" text, "occurrenceId" text);
  if exists (select 1 from jsonb_to_recordset(normalized) c("indicatorCode" text, "rangeStart" date, "rangeEnd" date, classification text,
    "caseSource" text, "caseId" uuid, "residentId" text, "eventDate" date, "occurrenceId" text)
    where c."indicatorCode" is null or c."indicatorCode" !~ '^B(1|3)_[0-9]+[a-z]?$'
      or c.classification is distinct from case when c."indicatorCode" like 'B1_%' then 'prenatal' else 'postpartum' end
      or c."rangeStart" is null or c."rangeEnd" is null or c."rangeStart" > c."rangeEnd"
      or c."eventDate" is null or c."eventDate" not between c."rangeStart" and c."rangeEnd"
      or c."caseSource" not in ('maternal_records', 'maternal_pregnancies') or c."caseSource" is null
      or c."caseId" is null or nullif(c."residentId", '') is null or nullif(c."occurrenceId", '') is null) then
    raise exception 'Maternal contributor keys must identify an eligible person, care classification and normalized reporting range' using errcode = '23514';
  end if;
  with candidates as (
    select * from jsonb_to_recordset(normalized) c("indicatorCode" text, "rangeStart" date, "rangeEnd" date, classification text,
      "caseSource" text, "caseId" uuid, "residentId" text, "eventDate" date, "occurrenceId" text)
  ), cases as (
    select 'maternal_records' as source, id, resident_id from public.maternal_records
    union all select 'maternal_pregnancies', id, resident_id from public.maternal_pregnancies
  ), verified as (
    select c.* from candidates c join cases m on m.source = c."caseSource" and m.id = c."caseId" and m.resident_id = c."residentId"
      join public.residents r on r.id = m.resident_id
    where (actor.role = 'admin' or r.municipality_id = actor.municipality_id)
      and (actor.role not in ('health_supervisor', 'bhw') or r.barangay_id = actor.barangay_id)
      and (p_barangay_id is null or r.barangay_id = p_barangay_id)
  ), distinct_contributors as (
    select distinct on ("indicatorCode", "rangeStart", "rangeEnd", classification, "residentId") * from verified
    order by "indicatorCode", "rangeStart", "rangeEnd", classification, "residentId", "eventDate", "caseSource", "caseId", "occurrenceId"
  )
  select (select count(*) from verified), coalesce(jsonb_agg(to_jsonb(d) order by d."indicatorCode", d."rangeStart", d."rangeEnd", d.classification, d."residentId"), '[]'::jsonb)
    into verified_count, result from distinct_contributors d;
  if verified_count <> jsonb_array_length(normalized) then
    raise exception 'Maternal contributor case/resident provenance or scope could not be verified' using errcode = '42501';
  end if;
  return result;
end;
$$;

revoke all on function public.guard_maternal_relationship_identity(), public.guard_consultation_maternal_source_row(),
  public.guard_consultation_maternal_ledger(), public.guard_consultation_maternal_audit(), public.project_consultation_maternal(),
  public.m1_maternal_contributors(uuid, uuid, jsonb) from public, anon, authenticated;

grant execute on function public.guard_maternal_relationship_identity(), public.guard_consultation_maternal_source_row(),
  public.guard_consultation_maternal_ledger(), public.guard_consultation_maternal_audit(), public.project_consultation_maternal(),
  public.m1_maternal_contributors(uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
