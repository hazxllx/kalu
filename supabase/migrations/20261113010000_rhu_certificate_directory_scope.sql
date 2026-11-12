-- RHU certificate requests use the same authorized resident directory as the
-- backend. The risk enrichment RPC previously omitted rhu_personnel, so every
-- RHU directory page was reported as having a changed scope.
begin;

create or replace function public.resident_risk_for_ids(p_resident_ids text[], p_actor_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.profiles%rowtype;
  configuration jsonb;
  result jsonb;
begin
  if coalesce(cardinality(p_resident_ids), 0) > 1000 then
    raise exception using errcode = '22023', message = 'Risk detail requests must be paginated.';
  end if;
  if p_actor_id is not null then
    select * into actor from public.profiles where id = p_actor_id;
    if not found or not coalesce(actor.status::text = 'active' or
      (actor.role::text = 'resident' and actor.status::text = 'pending_verification'), false) then
      raise exception using errcode = '42501', message = 'An active authorized account is required.';
    end if;
  end if;
  configuration := public.analytics_risk_configuration();
  with scoped as (
    select r.id from public.residents r
    where r.id = any(p_resident_ids) and (
      p_actor_id is null
      or (actor.role::text = 'resident' and r.auth_user_id = actor.id)
      or (r.municipality_id = actor.municipality_id and (
        actor.role::text in ('mho', 'phn', 'rhu_personnel')
        or (actor.role::text in ('health_supervisor', 'bhw') and r.barangay_id = actor.barangay_id)
      ))
    )
  ), assessed as (
    select r.id, coalesce(v.visit_date, v.created_at) as occurred_at,
      public.analytics_assess_vitals(v.bp, v.o2sat, v.temperature, v.hr, v.rr,
        v.height_cm, v.weight_kg, configuration, true) as risk
    from scoped r left join lateral (
      select * from public.visits v where v.resident_id = r.id
      order by coalesce(v.visit_date, v.created_at) desc, v.updated_at desc, v.created_at desc, v.id desc limit 1
    ) v on true
  )
  select coalesce(jsonb_agg(risk || jsonb_build_object(
    'residentId', id, 'riskAssessedAt', case when risk ->> 'riskLevel' is not null then occurred_at end
  ) order by id), '[]'::jsonb) into result from assessed;
  return result;
end;
$$;

revoke all on function public.resident_risk_for_ids(text[], uuid) from public, anon, authenticated;
grant execute on function public.resident_risk_for_ids(text[], uuid) to service_role;

-- Existing configured matrices retain explicit administrator choices; this
-- only fills the newly required workflow permission when a role is configured.
insert into public.role_permissions(role, permission_id, granted)
select role_name, 'certificates.request', true
from unnest(array['mho', 'phn', 'rhu_personnel']::public.app_role[]) role_name
where exists (select 1 from public.role_permissions where role = role_name)
on conflict (role, permission_id) do nothing;

commit;
notify pgrst, 'reload schema';
