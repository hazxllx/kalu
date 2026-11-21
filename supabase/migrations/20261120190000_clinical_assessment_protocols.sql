-- New encounter rules stay unapproved until authorized health personnel review
-- the references, thresholds and local referral protocol. No automatic seed approval.
create table if not exists public.clinical_assessment_protocols (
  municipality_id uuid primary key references public.municipalities(id),
  version text not null,
  thresholds jsonb not null default '{}'::jsonb check (jsonb_typeof(thresholds) = 'object'),
  active boolean not null default false,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  review_reference text,
  check (not active or (approved_by is not null and approved_at is not null and review_reference is not null and length(trim(review_reference)) > 0))
);
alter table public.clinical_assessment_protocols enable row level security;
revoke all on public.clinical_assessment_protocols from anon, authenticated;
grant select, insert, update, delete on public.clinical_assessment_protocols to service_role;

-- Restrict approval to a current municipal medical officer or public health nurse.
create or replace function public.validate_clinical_protocol_approval()
returns trigger language plpgsql set search_path = public as $$
declare protocol_group text;
begin
  if new.active then
    foreach protocol_group in array array['adult', 'pregnancy'] loop
      if jsonb_typeof(new.thresholds->(protocol_group || 'Elevated')) is distinct from 'object'
        or jsonb_typeof(new.thresholds->(protocol_group || 'Severe')) is distinct from 'object'
        or jsonb_typeof(new.thresholds->(protocol_group || 'Elevated')->'systolic') is distinct from 'number'
        or jsonb_typeof(new.thresholds->(protocol_group || 'Elevated')->'diastolic') is distinct from 'number'
        or jsonb_typeof(new.thresholds->(protocol_group || 'Severe')->'systolic') is distinct from 'number'
        or jsonb_typeof(new.thresholds->(protocol_group || 'Severe')->'diastolic') is distinct from 'number'
        or (new.thresholds->(protocol_group || 'Elevated')->>'systolic')::numeric <= 0
        or (new.thresholds->(protocol_group || 'Elevated')->>'diastolic')::numeric <= 0
        or (new.thresholds->(protocol_group || 'Severe')->>'systolic')::numeric > 300
        or (new.thresholds->(protocol_group || 'Severe')->>'diastolic')::numeric > 300
        or (new.thresholds->(protocol_group || 'Elevated')->>'systolic')::numeric >= (new.thresholds->(protocol_group || 'Severe')->>'systolic')::numeric
        or (new.thresholds->(protocol_group || 'Elevated')->>'diastolic')::numeric >= (new.thresholds->(protocol_group || 'Severe')->>'diastolic')::numeric then
        raise exception 'Clinical BP thresholds must contain valid elevated and severe systolic/diastolic ranges';
      end if;
    end loop;
  end if;
  if new.active and not exists (
    select 1 from public.profiles p where p.id = new.approved_by
      and p.role in ('mho', 'phn') and p.status = 'active' and p.municipality_id = new.municipality_id
  ) then
    raise exception 'An authorized municipal health professional must approve the clinical protocol';
  end if;
  return new;
end;
$$;
create trigger clinical_protocol_approval_guard before insert or update
  on public.clinical_assessment_protocols for each row
  execute function public.validate_clinical_protocol_approval();

create table if not exists public.clinical_assessment_protocol_history (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references public.municipalities(id),
  version text not null,
  thresholds jsonb not null,
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null,
  review_reference text not null,
  recorded_at timestamptz not null default now()
);
alter table public.clinical_assessment_protocol_history enable row level security;
revoke all on public.clinical_assessment_protocol_history from anon, authenticated;
grant select, insert on public.clinical_assessment_protocol_history to service_role;

create or replace function public.record_clinical_protocol_history()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.active then
    insert into public.clinical_assessment_protocol_history
      (municipality_id, version, thresholds, approved_by, approved_at, review_reference)
    values (new.municipality_id, new.version, new.thresholds, new.approved_by, new.approved_at, new.review_reference);
  end if;
  return new;
end;
$$;
create trigger clinical_protocol_history_insert after insert
  on public.clinical_assessment_protocols for each row when (new.active)
  execute function public.record_clinical_protocol_history();
create trigger clinical_protocol_history_update after update
  on public.clinical_assessment_protocols for each row
  when (new.active and (new.version, new.thresholds, new.approved_by, new.approved_at, new.review_reference)
    is distinct from (old.version, old.thresholds, old.approved_by, old.approved_at, old.review_reference))
  execute function public.record_clinical_protocol_history();

-- Preserve encounter assessment history during updates through either workflow.
create or replace function public.preserve_clinical_assessment_history()
returns trigger language plpgsql set search_path = public as $$
declare old_history jsonb; new_history jsonb;
begin
  old_history := coalesce(old.consultation_details->'clinicalAssessmentHistory', '[]'::jsonb);
  new_history := coalesce(new.consultation_details->'clinicalAssessmentHistory', '[]'::jsonb);
  if jsonb_array_length(new_history) < jsonb_array_length(old_history)
    or (select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
        from jsonb_array_elements(new_history) with ordinality
        where ordinality <= jsonb_array_length(old_history)) <> old_history then
    raise exception 'Clinical assessment history is append-only';
  end if;
  return new;
end;
$$;
create trigger clinical_assessment_history_guard before update of consultation_details
  on public.visits for each row execute function public.preserve_clinical_assessment_history();

-- Protocol history is database-maintained and not directly mutable by API roles.
revoke all on public.clinical_assessment_protocol_history from service_role;
grant select on public.clinical_assessment_protocol_history to service_role;
create or replace function public.record_clinical_protocol_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.active then
    insert into public.clinical_assessment_protocol_history
      (municipality_id, version, thresholds, approved_by, approved_at, review_reference)
    values (new.municipality_id, new.version, new.thresholds, new.approved_by, new.approved_at, new.review_reference);
  end if;
  return new;
end;
$$;
