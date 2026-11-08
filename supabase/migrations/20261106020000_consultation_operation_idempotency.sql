-- Durable consultation creates. Apply before deploying the SAFE_SYNC client.
-- Requires the existing visits, follow-up confirmation/operation-key, shared
-- consultation_id and consultation notification migrations. No clinical rows
-- have clinical values overwritten or deleted; legacy recorded_at reads fall
-- back to created_at.
begin;

alter table public.visits
  add column if not exists client_operation_key uuid,
  add column if not exists client_operation_payload_hash text,
  add column if not exists consultation_details jsonb,
  add column if not exists recorded_at timestamptz,
  add column if not exists consultation_effects_completed_at timestamptz;

-- Old clients stored a naive clinical datetime as UTC; its displayed calendar
-- day must not shift when date filtering starts honoring new +08:00 timestamps.
create or replace function public.consultation_calendar_date(p_details jsonb, p_visit_date timestamptz)
returns date language sql immutable set search_path = public as $$
  select case when p_details->>'consultationDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    then make_date((substring(p_details->>'consultationDate', 1, 4))::integer,
      (substring(p_details->>'consultationDate', 6, 2))::integer,
      (substring(p_details->>'consultationDate', 9, 2))::integer)
    else (p_visit_date at time zone 'UTC')::date end;
$$;
alter table public.visits add column if not exists consultation_date date
  generated always as (public.consultation_calendar_date(consultation_details, visit_date)) stored;
create index if not exists visits_consultation_date_idx on public.visits (consultation_date);

create unique index if not exists visits_client_operation_key_unique
  on public.visits (client_operation_key)
  where client_operation_key is not null;
create index if not exists visits_unkeyed_resident_idx
  on public.visits (resident_id) where client_operation_key is null;

alter table public.visits drop constraint if exists visits_consultation_operation_complete;
alter table public.visits add constraint visits_consultation_operation_complete check (
  client_operation_key is null or (
    client_operation_payload_hash is not null
    and client_operation_payload_hash ~ '^[0-9a-f]{64}$'
    and recorded_at is not null
    and consultation_details is not null
    and jsonb_typeof(consultation_details) = 'object'
  )
);

comment on column public.visits.client_operation_key is
  'Original client operation UUID, globally unique. Retries must match the original recorder, resident and payload hash.';
comment on column public.visits.consultation_details is
  'Non-lossy consultation form fields, including local clinical date/time and distinct findings, diagnosis, treatment, advice and follow-up date.';
comment on column public.visits.recorded_at is
  'Original client recording instant, retained through offline upload/retries/edits. created_at remains the server insertion time.';
comment on column public.visits.consultation_effects_completed_at is
  'Set only after the initial follow-up, audit and resident notifications commit together.';

create or replace function public.guard_consultation_operation_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.client_operation_key is not null and (
    new.client_operation_key is distinct from old.client_operation_key
    or new.client_operation_payload_hash is distinct from old.client_operation_payload_hash
    or new.resident_id is distinct from old.resident_id
    or new.recorded_by_id is distinct from old.recorded_by_id
    or new.recorded_by_role is distinct from old.recorded_by_role
    or new.recorded_by_name is distinct from old.recorded_by_name
    or new.recorded_at is distinct from old.recorded_at
  ) then
    raise exception 'Original consultation operation identity is immutable' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.client_operation_key is not null
    and auth.role() = 'authenticated' and new.recorded_by_id is distinct from auth.uid()::text then
    raise exception 'Consultation operation must belong to its original creator' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists visits_consultation_operation_identity on public.visits;
create trigger visits_consultation_operation_identity
  before insert or update on public.visits
  for each row execute function public.guard_consultation_operation_identity();
revoke all on function public.guard_consultation_operation_identity() from public, anon, authenticated;

-- These existing unique keys are prerequisites, not optional optimizations.
create unique index if not exists follow_ups_client_operation_key_unique
  on public.follow_ups (client_operation_key) where client_operation_key is not null;
create unique index if not exists notifications_consultation_once_idx
  on public.notifications (recipient_id, related_id) where related_type = 'consultation';

-- Clinical insertion is separate so a later transient outage never loses the
-- visit. Completion locks that visit: a retry resumes the same transaction,
-- including after a response loss, without resetting a resident's decision or
-- adopting another consultation's unlinked follow-up.
create or replace function public.complete_consultation_operation(
  p_visit_id text,
  p_creator_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_visit public.visits%rowtype;
  v_resident public.residents%rowtype;
  v_followup public.follow_ups%rowtype;
  v_key text;
  v_next_date date;
  v_created boolean := false;
begin
  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found or v_visit.client_operation_key is null
    or v_visit.recorded_by_id is distinct from p_creator_id::text then
    raise exception 'Consultation operation does not belong to this creator' using errcode = '42501';
  end if;
  if v_visit.consultation_effects_completed_at is not null then
    return jsonb_build_object('completed', true, 'consultationId', v_visit.id);
  end if;

  select * into strict v_resident from public.residents where id = v_visit.resident_id;
  v_next_date := nullif(v_visit.consultation_details->>'nextVisitDate', '')::date;
  if v_next_date is not null then
    v_key := 'consultation-followup:' || v_visit.id || ':' || v_next_date::text;
    insert into public.follow_ups (
      resident_id, consultation_id, created_by, client_operation_key,
      purpose, scheduled_date, notes, assigned_provider, status,
      requires_resident_response, resident_decision,
      resident_decision_at, resident_decision_reason
    ) values (
      v_visit.resident_id, v_visit.id, p_creator_id, v_key,
      coalesce(nullif(v_visit.consultation_details->>'chiefComplaint', ''),
        nullif(v_visit.consultation_details->>'diagnosis', ''), 'Consultation') || ' follow-up',
      v_next_date, coalesce(v_visit.consultation_details->>'adviceGiven', ''),
      v_visit.recorded_by_name, 'Pending', true, 'pending', null, ''
    ) on conflict (client_operation_key) where client_operation_key is not null do nothing
    returning * into v_followup;
    v_created := found;
    if not v_created then
      select * into strict v_followup from public.follow_ups where client_operation_key = v_key;
    end if;
    if v_followup.resident_id is distinct from v_visit.resident_id
      or v_followup.created_by is distinct from p_creator_id
      or v_followup.consultation_id is distinct from v_visit.id then
      raise exception 'Follow-up operation belongs to another creator or resident' using errcode = '23505';
    end if;
    if v_created then
      insert into public.health_audit_logs (
        actor_id, action, entity_type, entity_id, municipality_id, barangay_id
      ) values (
        p_creator_id, 'FOLLOWUPS_CREATED', 'follow_ups', v_followup.id::text,
        v_resident.municipality_id, v_resident.barangay_id
      );
    end if;
    if v_resident.auth_user_id is not null then
      insert into public.notifications (recipient_id, category, title, message, related_type, related_id)
      select v_resident.auth_user_id, 'reminder', 'New follow-up requires your response',
        'A health worker requested a follow-up on ' || v_next_date::text
          || '. Please review it and confirm or reject it in your Follow-ups.',
        'follow_ups', v_followup.id::text
      where not exists (
        select 1 from public.notifications where recipient_id = v_resident.auth_user_id
          and related_type = 'follow_ups' and related_id = v_followup.id::text
          and title = 'New follow-up requires your response'
      );
    end if;
  end if;

  if v_resident.auth_user_id is not null then
    insert into public.notifications (recipient_id, category, title, message, related_type, related_id)
    values (
      v_resident.auth_user_id, 'information', 'New consultation record',
      'A new consultation record from ' || (v_visit.consultation_details->>'consultationDate')
        || ' is now available in My Health Records.',
      'consultation', v_visit.id
    ) on conflict (recipient_id, related_id) where related_type = 'consultation' do nothing;
  end if;
  insert into public.health_audit_logs (
    actor_id, action, entity_type, entity_id, municipality_id, barangay_id
  ) values (
    p_creator_id, 'CONSULTATION_CREATED', 'visits', v_visit.id,
    v_resident.municipality_id, v_resident.barangay_id
  );
  update public.visits set consultation_effects_completed_at = now() where id = v_visit.id;
  return jsonb_build_object('completed', true, 'consultationId', v_visit.id, 'followUpId', v_followup.id);
end;
$$;

-- Only the authenticated/authorized Express service may complete an operation.
-- This RPC does not grant browser clients access to anyone else's clinical row.
revoke all on function public.complete_consultation_operation(text, uuid) from public, anon, authenticated;
grant execute on function public.complete_consultation_operation(text, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
