-- supabase/migrations/20261202150000_resident_risk_pending_followups_kpi.sql
begin;

create or replace function public.resident_risk_summary_records(
  p_actor_id uuid, p_barangay_id uuid default null, p_zone smallint default null,
  p_risk_level text default null, p_assessment_status text default null,
  p_from date default null, p_to date default null, p_indicator text default null,
  p_search text default null, p_limit integer default 25, p_offset integer default 0
)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
declare actor public.profiles%rowtype; result jsonb;
begin
  select * into actor from public.profiles where id = p_actor_id;
  if not found or actor.status::text <> 'active' or actor.municipality_id is null
    or actor.role::text not in ('health_supervisor','phn','mho')
    or not public.personnel_actor_has_permission(actor.id,'reports.analytics.view') then
    raise exception using errcode='42501', message='Resident risk summary is not available to this account.';
  end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 or (p_from is not null and p_to is not null and p_from > p_to) then
    raise exception using errcode='22023', message='Invalid resident risk summary filters or pagination.';
  end if;
  if p_risk_level is not null and p_risk_level not in ('Low','Moderate','High','Unassigned') then
    raise exception using errcode='22023', message='Invalid risk level filter.';
  end if;
  if p_assessment_status is not null and p_assessment_status not in ('assessed','incomplete','unassessed') then
    raise exception using errcode='22023', message='Invalid assessment status filter.';
  end if;
  if p_indicator is not null and p_indicator not in ('bloodPressure','bmi','oxygenSaturation','respiratoryRate','temperature','heartRate') then
    raise exception using errcode='22023', message='Invalid clinical indicator filter.';
  end if;
  if actor.role::text = 'health_supervisor' and (actor.barangay_id is null or (p_barangay_id is not null and p_barangay_id <> actor.barangay_id)) then
    raise exception using errcode='42501', message='Health Supervisor risk records are restricted to the assigned barangay.';
  end if;
  if p_barangay_id is not null and not exists(select 1 from public.barangays b
    where b.id=p_barangay_id and b.municipality_id=actor.municipality_id and b.status='Active') then
    raise exception using errcode='42501', message='The selected barangay is outside the authorized municipality.';
  end if;

  with source as materialized (
    select r.id,r.first_name,r.middle_name,r.last_name,r.suffix,r.birth_date,r.sex,r.barangay,r.barangay_id,r.zone,
      b.name as barangay_name, r.risk_level as persisted_level,
      public.analytics_resident_risk(r.id,public.analytics_risk_configuration(),true) as risk,
      public.analytics_clinical_screening_for_resident(r.id) as screening,
      case when r.birth_date is not null then extract(year from age(current_date,r.birth_date))::integer end as age,
      latest.recorded_by_name as personnel
    from public.residents r join public.barangays b on b.id=r.barangay_id
    left join lateral (select v.recorded_by_name from public.visits v where v.resident_id=r.id
      order by coalesce(v.visit_date,v.created_at) desc,v.updated_at desc,v.created_at desc,v.id desc limit 1) latest on true
    where r.municipality_id=actor.municipality_id and b.municipality_id=actor.municipality_id
      and (actor.role::text <> 'health_supervisor' or r.barangay_id=actor.barangay_id)
      and (p_barangay_id is null or r.barangay_id=p_barangay_id)
      and (p_zone is null or r.zone=p_zone)
  ), normalized as materialized (
    select s.*, nullif(s.risk->>'riskLevel','') as level,
      coalesce(nullif(s.risk->>'riskAssessmentStatus',''),'unavailable') as raw_status,
      public.analytics_risk_timestamp(s.risk->>'riskAssessedAt') as assessed_at,
      coalesce(s.screening->'classifications','{}'::jsonb) as classifications
    from source s
  ), filtered as materialized (
    select n.*, case when n.level is not null then 'assessed'
      when n.raw_status='incomplete' then 'incomplete' else 'unassessed' end as status
    from normalized n
    where (p_risk_level is null or (p_risk_level='Unassigned' and n.level is null) or n.level=p_risk_level)
      and (p_assessment_status is null or (p_assessment_status='assessed' and n.level is not null)
        or (p_assessment_status='incomplete' and n.raw_status='incomplete')
        or (p_assessment_status='unassessed' and n.level is null and n.raw_status<>'incomplete'))
      and (p_from is null or (n.screening->>'assessmentAt')::timestamptz >= p_from::timestamp at time zone 'Asia/Manila')
      and (p_to is null or (n.screening->>'assessmentAt')::timestamptz < (p_to+1)::timestamp at time zone 'Asia/Manila')
      and (p_indicator is null or (n.classifications ? p_indicator and n.classifications->p_indicator->>'classification' not in ('Not assessed','Not classified')))
      and (p_search is null or concat_ws(' ',n.first_name,n.middle_name,n.last_name,n.suffix,n.id,n.barangay_name) ilike '%'||btrim(p_search)||'%')
  ), totals as (
    select count(*) as total, count(*) filter(where level is not null) as assessed,
      count(*) filter(where raw_status='incomplete') as incomplete,
      count(*) filter(where level='Low') as low, count(*) filter(where level='Moderate') as moderate,
      count(*) filter(where level='High') as high,
      count(*) filter(where level is null and raw_status<>'incomplete') as unassessed from filtered
  ), page as (
    select * from filtered order by last_name,first_name,id limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'summary',jsonb_build_object('totalResidents',t.total,'assessed',t.assessed,'incomplete',t.incomplete,
      'low',t.low,'moderate',t.moderate,'high',t.high,'unassessed',t.unassessed,
      'pendingFollowUps',case when public.personnel_actor_has_permission(actor.id,'followups.view') then
        (select count(distinct f.resident_id) from public.follow_ups f
          join filtered resident_set on resident_set.id=f.resident_id
          where lower(f.status) not in ('completed','cancelled','rejected'))
        else null end,
      'distribution',jsonb_build_array(jsonb_build_object('name','Low','value',t.low),
        jsonb_build_object('name','Moderate','value',t.moderate),jsonb_build_object('name','High','value',t.high),
        jsonb_build_object('name','Incomplete','value',t.incomplete),jsonb_build_object('name','Unassessed','value',t.unassessed))),
    'total',t.total,'limit',p_limit,'offset',p_offset,
    'barangays',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name)
      from public.barangays b where b.municipality_id=actor.municipality_id and b.status='Active'
        and actor.role::text in ('phn','mho') and p_barangay_id is null),'[]'::jsonb),
    'zones',coalesce((select jsonb_agg(distinct r.zone order by r.zone) from public.residents r
      where r.municipality_id=actor.municipality_id and r.zone is not null
        and (actor.role::text <> 'health_supervisor' or r.barangay_id=actor.barangay_id)
        and (p_barangay_id is null or r.barangay_id=p_barangay_id)),'[]'::jsonb),
    'rows',(select coalesce(jsonb_agg(jsonb_build_object(
      'residentId',id,'name',trim(concat_ws(' ',first_name,nullif(middle_name,''),last_name,nullif(suffix,''))),
      'age',age,'sex',sex,'barangay',barangay_name,'zone',zone,'assessmentAt',screening->>'assessmentAt',
      'riskLevel',level,'riskAssessmentStatus',status,'riskScore',risk->'riskScore','riskFactors',risk->'riskFactors',
      'riskReason',risk->>'riskReason','missingMeasurements',risk->'missingMeasurements',
      'clinicalScreening',screening,'responsiblePersonnel',nullif(personnel,'')) order by last_name,first_name,id), '[]'::jsonb) from page))
  into result from totals t;
  return result;
end;
$$;

commit;
