-- P0-3: Atomic household member mutations + parent household risk recalculation.
--
-- Ensures adding, updating, or removing a household member and persisting the
-- parent household's recomputed risk_score, risk_level, risk_factors, and flags
-- happen inside a single PostgreSQL transaction (all commit or all roll back).
--
-- SECURITY: EXECUTE is revoked from PUBLIC/anon/authenticated and granted only
-- to service_role. The Express backend invokes these RPCs with the service-role
-- client after authenticate/authorize and barangay-scope checks.

begin;

create or replace function public.add_household_member_with_risk(
  p_household_id text,
  p_member jsonb,
  p_risk jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_household public.households%rowtype;
  v_member_in public.household_members%rowtype;
  v_member public.household_members%rowtype;
begin
  if p_household_id is null or btrim(p_household_id) = '' then
    raise exception 'add_household_member_with_risk: p_household_id is required';
  end if;
  if p_member is null or jsonb_typeof(p_member) <> 'object' then
    raise exception 'add_household_member_with_risk: p_member must be a JSON object';
  end if;
  if p_risk is null or jsonb_typeof(p_risk) <> 'object' then
    raise exception 'add_household_member_with_risk: p_risk must be a JSON object';
  end if;

  select * into v_household
    from public.households
    where id = p_household_id
    for update;
  if not found then
    return jsonb_build_object('missing', 'household');
  end if;

  select * into v_member_in
    from jsonb_populate_record(null::public.household_members, p_member);

  insert into public.household_members
    (household_id, resident_id, name, birthday, age, sex, classification,
     relationship, contact, is_pwd, philhealth, fp_method, quarter_status, is_head)
  values
    (p_household_id, v_member_in.resident_id, coalesce(v_member_in.name, ''),
     coalesce(v_member_in.birthday, ''), v_member_in.age, coalesce(v_member_in.sex, ''),
     coalesce(v_member_in.classification, ''), coalesce(v_member_in.relationship, ''),
     coalesce(v_member_in.contact, ''), coalesce(v_member_in.is_pwd, false),
     coalesce(v_member_in.philhealth, ''), coalesce(v_member_in.fp_method, ''),
     coalesce(v_member_in.quarter_status, ''), coalesce(v_member_in.is_head, false))
  returning * into v_member;

  update public.households
     set risk_score = (p_risk ->> 'risk_score')::integer,
         risk_level = p_risk ->> 'risk_level',
         risk_factors = coalesce(p_risk -> 'risk_factors', '[]'::jsonb),
         flags = coalesce(p_risk -> 'flags', '[]'::jsonb),
         revision = coalesce(revision, 1) + 1
   where id = p_household_id
  returning * into v_household;

  return jsonb_build_object(
    'member', to_jsonb(v_member),
    'household', to_jsonb(v_household)
  );
end;
$$;

create or replace function public.update_household_member_with_risk(
  p_household_id text,
  p_member_id uuid,
  p_member jsonb,
  p_risk jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_household public.households%rowtype;
  v_member_in public.household_members%rowtype;
  v_member public.household_members%rowtype;
begin
  if p_household_id is null or btrim(p_household_id) = '' or p_member_id is null then
    raise exception 'update_household_member_with_risk: household_id and member_id are required';
  end if;
  if p_member is null or jsonb_typeof(p_member) <> 'object' then
    raise exception 'update_household_member_with_risk: p_member must be a JSON object';
  end if;
  if p_risk is null or jsonb_typeof(p_risk) <> 'object' then
    raise exception 'update_household_member_with_risk: p_risk must be a JSON object';
  end if;

  select * into v_household
    from public.households
    where id = p_household_id
    for update;
  if not found then
    return jsonb_build_object('missing', 'household');
  end if;

  select * into v_member_in
    from jsonb_populate_record(null::public.household_members, p_member);

  update public.household_members
     set resident_id = case when p_member ? 'resident_id' then v_member_in.resident_id else resident_id end,
         name = case when p_member ? 'name' then coalesce(v_member_in.name, '') else name end,
         birthday = case when p_member ? 'birthday' then coalesce(v_member_in.birthday, '') else birthday end,
         age = case when p_member ? 'age' then v_member_in.age else age end,
         sex = case when p_member ? 'sex' then coalesce(v_member_in.sex, '') else sex end,
         classification = case when p_member ? 'classification' then coalesce(v_member_in.classification, '') else classification end,
         relationship = case when p_member ? 'relationship' then coalesce(v_member_in.relationship, '') else relationship end,
         contact = case when p_member ? 'contact' then coalesce(v_member_in.contact, '') else contact end,
         is_pwd = case when p_member ? 'is_pwd' then coalesce(v_member_in.is_pwd, false) else is_pwd end,
         philhealth = case when p_member ? 'philhealth' then coalesce(v_member_in.philhealth, '') else philhealth end,
         fp_method = case when p_member ? 'fp_method' then coalesce(v_member_in.fp_method, '') else fp_method end,
         quarter_status = case when p_member ? 'quarter_status' then coalesce(v_member_in.quarter_status, '') else quarter_status end,
         is_head = case when p_member ? 'is_head' then coalesce(v_member_in.is_head, false) else is_head end
   where id = p_member_id
     and household_id = p_household_id
  returning * into v_member;

  if not found then
    return jsonb_build_object('missing', 'member');
  end if;

  update public.households
     set risk_score = (p_risk ->> 'risk_score')::integer,
         risk_level = p_risk ->> 'risk_level',
         risk_factors = coalesce(p_risk -> 'risk_factors', '[]'::jsonb),
         flags = coalesce(p_risk -> 'flags', '[]'::jsonb),
         revision = coalesce(revision, 1) + 1
   where id = p_household_id
  returning * into v_household;

  return jsonb_build_object(
    'member', to_jsonb(v_member),
    'household', to_jsonb(v_household)
  );
end;
$$;

create or replace function public.remove_household_member_with_risk(
  p_household_id text,
  p_member_id uuid,
  p_risk jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_household public.households%rowtype;
  v_deleted_id uuid;
begin
  if p_household_id is null or btrim(p_household_id) = '' or p_member_id is null then
    raise exception 'remove_household_member_with_risk: household_id and member_id are required';
  end if;
  if p_risk is null or jsonb_typeof(p_risk) <> 'object' then
    raise exception 'remove_household_member_with_risk: p_risk must be a JSON object';
  end if;

  select * into v_household
    from public.households
    where id = p_household_id
    for update;
  if not found then
    return jsonb_build_object('missing', 'household');
  end if;

  delete from public.household_members
   where id = p_member_id
     and household_id = p_household_id
  returning id into v_deleted_id;

  if not found then
    return jsonb_build_object('missing', 'member');
  end if;

  update public.households
     set risk_score = (p_risk ->> 'risk_score')::integer,
         risk_level = p_risk ->> 'risk_level',
         risk_factors = coalesce(p_risk -> 'risk_factors', '[]'::jsonb),
         flags = coalesce(p_risk -> 'flags', '[]'::jsonb),
         revision = coalesce(revision, 1) + 1
   where id = p_household_id
  returning * into v_household;

  return jsonb_build_object(
    'removed', true,
    'household', to_jsonb(v_household)
  );
end;
$$;

revoke all on function public.add_household_member_with_risk(text, jsonb, jsonb) from public;
grant execute on function public.add_household_member_with_risk(text, jsonb, jsonb) to service_role;

revoke all on function public.update_household_member_with_risk(text, uuid, jsonb, jsonb) from public;
grant execute on function public.update_household_member_with_risk(text, uuid, jsonb, jsonb) to service_role;

revoke all on function public.remove_household_member_with_risk(text, uuid, jsonb) from public;
grant execute on function public.remove_household_member_with_risk(text, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
