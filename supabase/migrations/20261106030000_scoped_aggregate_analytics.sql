begin;

-- No clinical rows leave these RPCs. Scope is resolved again from the stored
-- actor profile even though the API has already authenticated/authorized it.
-- Resident geography, not stale visit/referral snapshots, is authoritative.
create index if not exists analytics_residents_scope_idx
  on public.residents (municipality_id, barangay_id, id);
create index if not exists analytics_visits_resident_latest_idx
  on public.visits (resident_id, (coalesce(visit_date, created_at)) desc, updated_at desc, created_at desc, id desc);
create index if not exists analytics_health_referrals_resident_date_idx
  on public.health_referrals (resident_id, created_at);
create index if not exists analytics_active_tb_resident_date_idx
  on public.tcl_entries (resident_id, created_at)
  where lower(status) = 'active' and program ~* '\mtb\M|tuberculosis';
create index if not exists analytics_households_scope_idx
  on public.households (municipality_id, barangay_id, id);

-- Mirrors analytics.service.classifyCondition, including its substring matching
-- and rule precedence. Early-warning includes findings; map filters do not.
create function public.analytics_condition(p_text text)
returns text language sql immutable parallel safe
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when lower(coalesce(p_text, '')) like any (array['%tuberculosis%', '%tb%', '%ptb%', '%koch%']) then 'Tuberculosis'
    when lower(coalesce(p_text, '')) like any (array['%dengue%', '%hemorrhagic fever%']) then 'Dengue'
    when lower(coalesce(p_text, '')) like any (array['%malaria%', '%plasmodium%']) then 'Malaria'
    when lower(coalesce(p_text, '')) like any (array['%hypertension%', '%blood pressure%', '%elevated blood%']) then 'Hypertension'
    when lower(coalesce(p_text, '')) like any (array['%diabetes%', '%blood sugar%', '%glucose%', '%hba1c%']) then 'Diabetes'
    when lower(coalesce(p_text, '')) like any (array['%respiratory%', '%asthma%', '%cough%', '%pneumonia%', '%ili%', '%influenza%']) then 'Respiratory'
    when lower(coalesce(p_text, '')) like any (array['%prenatal%', '%pregnan%', '%postnatal%', '%postpartum%']) then 'Maternal'
    when lower(coalesce(p_text, '')) like any (array['%anemia%', '%anaemia%', '%pallor%', '%cbc%']) then 'Anemia'
    when lower(coalesce(p_text, '')) like any (array['%epigastric%', '%abdominal%', '%diarrhea%', '%vomiting%', '%heartburn%']) then 'Gastrointestinal'
    else 'Others'
  end;
$$;

-- Scalar-only counterpart of residentRisk.healthDataFromVitals/assessVitals:
-- enabled criteria add their weights, all six operators are inclusive/exclusive
-- exactly as in JS, and missing/non-finite measurements never match. Stored BMI
-- and persisted resident risk are deliberately not trusted after config changes.
create function public.analytics_assess_vitals(
  p_bp text, p_o2sat numeric, p_temperature numeric, p_pulse numeric,
  p_respiratory numeric, p_height_cm numeric, p_weight_kg numeric, p_config jsonb,
  p_include_factors boolean default true
)
returns jsonb language sql immutable parallel safe
set search_path = pg_catalog, public, pg_temp
as $$
  with health as (
    select regexp_match(coalesce(p_bp, ''), '([0-9]{2,3})[[:space:]]*/[[:space:]]*([0-9]{2,3})') as bp,
      case when p_height_cm > 0 and p_weight_kg > 0
        and p_height_cm::text not in ('NaN', 'Infinity', '-Infinity')
        and p_weight_kg::text not in ('NaN', 'Infinity', '-Infinity')
        then round(p_weight_kg / ((p_height_cm / 100) * (p_height_cm / 100)), 1) end as bmi
  ), fields as (
    select field, case when measured::text in ('NaN', 'Infinity', '-Infinity') then null else measured end as measured
    from health cross join lateral (values
      ('systolic', bp[1]::numeric), ('diastolic', bp[2]::numeric),
      ('o2sat', p_o2sat), ('temperature', p_temperature), ('pulse', p_pulse),
      ('respiratory', p_respiratory), ('bmi', bmi)
    ) measurements(field, measured)
  ), matched as (
    select c.code, c.name, c.field, coalesce(c.weight, 0) as weight, c.priority, f.measured
    from jsonb_to_recordset(p_config -> 'criteria') as c(
      code text, name text, field text, operator text, value numeric, value2 numeric,
      weight numeric, enabled boolean, priority integer
    ) join fields f on f.field = c.field
    where c.enabled is distinct from false and f.measured is not null and case c.operator
      when 'gte' then f.measured >= c.value
      when 'gt' then f.measured > c.value
      when 'lte' then f.measured <= c.value
      when 'lt' then f.measured < c.value
      when 'eq' then f.measured = c.value
      when 'between' then f.measured >= c.value and f.measured <= c.value2
      else false end
  ), score as (
    select coalesce(sum(weight), 0) as value from matched
  ), assessment as (
    select exists (select 1 from fields where measured is not null) as assessed,
      score.value, case
        when score.value >= coalesce((p_config #>> '{thresholds,highMin}')::numeric, 70) then 'High'
        when score.value >= coalesce((p_config #>> '{thresholds,moderateMin}')::numeric, 40) then 'Moderate'
        else 'Low' end as level from score
  )
  select jsonb_build_object('riskScore', case when a.assessed then a.value end,
    'riskLevel', case when a.assessed then a.level end,
    'riskFactors', case when p_include_factors then coalesce((select jsonb_agg(jsonb_build_object(
      'code', code, 'name', name, 'field', field, 'measured', measured, 'weight', weight
    ) order by coalesce(priority, 0), code collate "C") from matched), '[]'::jsonb) else '[]'::jsonb end)
  from assessment a;
$$;

create function public.analytics_visit_risk(
  p_bp text, p_o2sat numeric, p_temperature numeric, p_pulse numeric,
  p_respiratory numeric, p_height_cm numeric, p_weight_kg numeric, p_config jsonb
)
returns text language sql immutable parallel safe
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(public.analytics_assess_vitals(p_bp, p_o2sat, p_temperature, p_pulse,
    p_respiratory, p_height_cm, p_weight_kg, p_config, false) ->> 'riskLevel', 'Unassessed');
$$;

-- Bounded configuration-only read, shared with server-owned directory risk
-- assessment. Empty tables use the JS engine's documented defaults; failed or
-- missing tables do not. No resident record or identifier is returned.
create function public.analytics_risk_configuration()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object('criteria', coalesce(jsonb_agg(jsonb_build_object(
    'code', c.code, 'name', c.name, 'field', c.field, 'operator', c.operator,
    'value', case when c.value::text not in ('NaN', 'Infinity', '-Infinity') then c.value end,
    'value2', case when c.value2::text not in ('NaN', 'Infinity', '-Infinity') then c.value2 end,
    'weight', case when c.weight::text not in ('NaN', 'Infinity', '-Infinity') then c.weight else 0 end,
    'enabled', c.enabled, 'priority', c.priority
  ) order by c.priority, c.code), '[
    {"code":"bp_systolic_high","name":"High blood pressure","field":"systolic","operator":"gte","value":140,"weight":70,"enabled":true,"priority":10},
    {"code":"o2sat_low","name":"Low oxygen saturation","field":"o2sat","operator":"lt","value":95,"weight":70,"enabled":true,"priority":20},
    {"code":"bp_systolic_elevated","name":"Elevated blood pressure","field":"systolic","operator":"between","value":130,"value2":139,"weight":40,"enabled":true,"priority":30}
  ]'::jsonb), 'thresholds', coalesce((select jsonb_build_object(
    'moderateMin', s.moderate_min, 'highMin', s.high_min
  ) from public.risk_settings s where s.id), '{"moderateMin":40,"highMin":70}'::jsonb))
  from public.risk_criteria c;
$$;

create function public.scoped_aggregate_analytics(
  p_actor_id uuid,
  p_kind text,
  p_barangay text default null,
  p_condition text default null,
  p_status text default null,
  p_risk_level text default null,
  p_from date default null,
  p_to date default null,
  p_year integer default null,
  p_distinct_residents boolean default false
)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_actor record;
  v_barangay_id uuid;
  v_barangay_name text;
  v_scope_ids uuid[];
  v_municipality_name text;
  v_center jsonb;
  v_config jsonb;
  v_month date := date_trunc('month', now() at time zone 'Asia/Manila')::date;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_year integer := coalesce(p_year, extract(year from now() at time zone 'Asia/Manila')::integer);
  v_from timestamptz := p_from::timestamp at time zone 'Asia/Manila';
  -- A half-open next-midnight bound includes the entire final day, including
  -- microseconds, without depending on the server/session timezone.
  v_until timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Manila';
  v_activity_from date;
  v_activity_to date;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Aggregate analytics require the trusted API.';
  end if;
  select p.role, p.municipality_id, p.barangay_id into v_actor
  from public.profiles p left join public.personnel_accounts a on a.account_id = p.id
  where p.id = p_actor_id and p.status = 'active' and p.role in ('mho', 'phn', 'health_supervisor')
    and (a.account_id is null or (a.approval_status = 'approved' and not a.setup_required and a.suspended_at is null));
  if not found or not public.personnel_actor_has_permission(p_actor_id, 'reports.analytics.view') then
    raise exception using errcode = '42501', message = 'An authorized active analytics account is required.';
  end if;
  select m.name, case when m.latitude between -90 and 90 and m.longitude between -180 and 180
    then jsonb_build_object('latitude', m.latitude, 'longitude', m.longitude) end
  into v_municipality_name, v_center
  from public.municipalities m where m.id = v_actor.municipality_id and m.is_active;
  if not found then
    raise exception using errcode = '42501', message = 'Your account requires an active municipality assignment.';
  end if;

  p_barangay := nullif(btrim(p_barangay), '');
  if v_actor.role = 'health_supervisor' then
    select b.id, b.name into v_barangay_id, v_barangay_name from public.barangays b
    where b.id = v_actor.barangay_id and b.municipality_id = v_actor.municipality_id
      and b.status = 'Active' and public.is_approved_barangay_name(b.name);
    if not found then
      raise exception using errcode = '42501', message = 'Your account requires an approved active barangay assignment.';
    end if;
    if p_barangay is not null and lower(p_barangay) <> lower(v_barangay_name) and p_barangay <> v_barangay_id::text then
      raise exception using errcode = '42501', message = 'The requested barangay is outside your assigned scope.';
    end if;
  elsif p_barangay is not null then
    select b.id, b.name into v_barangay_id, v_barangay_name from public.barangays b
    where b.municipality_id = v_actor.municipality_id and lower(btrim(b.name)) = lower(p_barangay)
      and b.status = 'Active' and public.is_approved_barangay_name(b.name);
    if not found then
      raise exception using errcode = '22023', message = 'The selected barangay is not registered in your analytics scope.';
    end if;
  end if;
  select array_agg(b.id) into v_scope_ids from public.barangays b
  where b.municipality_id = v_actor.municipality_id and b.status = 'Active'
    and public.is_approved_barangay_name(b.name) and (v_barangay_id is null or b.id = v_barangay_id);

  p_condition := nullif(nullif(btrim(p_condition), ''), 'All');
  p_status := nullif(lower(btrim(p_status)), '');
  p_risk_level := nullif(btrim(p_risk_level), '');
  if p_kind is null or p_kind not in ('early-warning', 'community-map', 'community-map-trends', 'household-map')
    or (p_condition is not null and p_condition not in ('Tuberculosis', 'Dengue', 'Malaria', 'Hypertension', 'Diabetes', 'Respiratory', 'Maternal', 'Anemia', 'Gastrointestinal', 'Others'))
    or (p_status is not null and p_status not in ('draft', 'submitted', 'received', 'in_review', 'referred', 'completed'))
    or (p_risk_level is not null and p_risk_level not in ('High', 'Moderate', 'Low', 'Unassessed'))
    or (p_from is not null and p_to is not null and p_from > p_to) or v_year < 1 or v_year > 9999 then
    raise exception using errcode = '22023', message = 'Select valid analytics filters and reporting dates.';
  end if;
  if p_kind in ('community-map', 'community-map-trends') and coalesce(cardinality(v_scope_ids), 0) = 0 then
    raise exception using errcode = '55000', message = 'The analytics scope has no active approved barangay registry.';
  end if;

  v_config := public.analytics_risk_configuration();

  if p_kind = 'early-warning' then
    -- Activity filters are additive. The existing EW summary/trends/monitoring
    -- retain their original current-month/all-record definitions.
    v_activity_from := coalesce(p_from, case when p_year is null
      then (v_month - interval '11 months')::date else make_date(v_year, 1, 1) end);
    v_activity_to := coalesce(p_to, case when p_year is null
      then (v_month + interval '1 month' - interval '1 day')::date else make_date(v_year + 1, 1, 1) - 1 end);
    if v_activity_from > v_activity_to then
      raise exception using errcode = '22023', message = 'Select a valid activity reporting period.';
    end if;
    with residents as materialized (
      select r.id, r.barangay_id, r.birth_date, r.verification_status from public.residents r where r.municipality_id = v_actor.municipality_id
        and (v_barangay_id is null or r.barangay_id = v_barangay_id)
    ), visits as materialized (
      select v.id, v.resident_id, coalesce(v.visit_date, v.created_at) as occurred_at,
        v.updated_at, v.created_at, v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg,
        public.analytics_condition(v.chief_complaint || ' ' || v.findings) as condition
      from public.visits v join residents r on r.id = v.resident_id
    ), latest as materialized (
      select distinct on (v.resident_id) v.resident_id,
        public.analytics_visit_risk(v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg, v_config) as risk
      from visits v order by v.resident_id, v.occurred_at desc, v.updated_at desc, v.created_at desc, v.id desc
    ), risk as (
      select count(*) filter (where risk = 'Low') as low,
        count(*) filter (where risk = 'Moderate') as moderate,
        count(*) filter (where risk = 'High') as high,
        count(*) filter (where risk = 'Unassessed') as unassessed from latest
    ), conditions as (
      select condition as name, count(*) as value from visits group by condition
    ), visit_months as (
      select date_trunc('month', v.occurred_at at time zone 'Asia/Manila')::date as month, count(*) as value
      from visits v where v.occurred_at >= (v_month - interval '11 months') at time zone 'Asia/Manila'
        and v.occurred_at < (v_month + interval '1 month') at time zone 'Asia/Manila' group by 1
    ), referral_months as (
      select date_trunc('month', h.created_at at time zone 'Asia/Manila')::date as month, count(*) as value
      from public.health_referrals h join residents r on r.id = h.resident_id
      where h.created_at >= (v_month - interval '11 months') at time zone 'Asia/Manila'
        and h.created_at < (v_month + interval '1 month') at time zone 'Asia/Manila' group by 1
    ), months as (
      select m.month::date, coalesce(v.value, 0) as consultations, coalesce(h.value, 0) as referrals
      from generate_series(v_month - interval '11 months', v_month::timestamp, interval '1 month') as m(month)
      left join visit_months v on v.month = m.month::date left join referral_months h on h.month = m.month::date
    ), household_counts as (
      select count(*) as total,
        count(*) filter (where h.risk_level = 'High') as high,
        count(*) filter (where h.risk_level = 'Moderate') as moderate,
        count(*) filter (where h.risk_level = 'Low') as low
      from public.households h where h.municipality_id = v_actor.municipality_id
        and (v_barangay_id is null or h.barangay_id = v_barangay_id)
    ), followup_counts as (
      select count(*) filter (where lower(f.status) in ('scheduled', 'today', 'upcoming', 'ongoing')) as active,
        count(*) filter (where lower(f.status) in ('scheduled', 'upcoming')) as pending,
        count(*) filter (where lower(f.status) = 'missed' or
          (lower(f.status) in ('scheduled', 'today', 'upcoming', 'ongoing') and f.scheduled_date < v_today)) as overdue,
        count(*) filter (where lower(f.status) in ('scheduled', 'upcoming') and f.scheduled_date >= v_today) as upcoming
      from public.follow_ups f join residents r on r.id = f.resident_id
    ), referral_counts as (
      select count(*) as total, count(*) filter (where lower(h.status) in ('pending', 'accepted', 'in progress')) as pending
      from public.health_referrals h join residents r on r.id = h.resident_id
    ), maternal_counts as (
      select count(*) as total, count(*) filter (where lower(m.status) = 'active') as active
      from public.maternal_records m join residents r on r.id = m.resident_id
    ), immunization_counts as (
      select count(*) as total from public.immunizations i join residents r on r.id = i.resident_id
    ), monitoring as (
      select jsonb_build_object('verifiedResidents', (select count(*) from residents r where verification_status = 'approved'
        or exists (select 1 from public.household_members member join public.households household on household.id = member.household_id
          where member.resident_id = r.id and household.verification_status = 'Verified'
            and household.municipality_id = v_actor.municipality_id
            and (v_barangay_id is null or household.barangay_id = v_barangay_id))),
        'totalHouseholds', h.total, 'householdRisk', jsonb_build_object('High', h.high, 'Moderate', h.moderate, 'Low', h.low),
        'activeFollowUps', f.active, 'pendingFollowUps', f.pending, 'overdueFollowUps', f.overdue, 'upcomingFollowUps', f.upcoming,
        'pendingReferrals', ref.pending, 'totalReferrals', ref.total,
        'maternalCases', m.total, 'activeMaternalCases', m.active, 'immunizationRecords', i.total) as payload
      from household_counts h cross join followup_counts f cross join referral_counts ref
        cross join maternal_counts m cross join immunization_counts i
    ), activity_residents as materialized (
      select id, barangay_id, birth_date from residents where barangay_id = any(v_scope_ids)
    ), activity_followups as (
      select r.barangay_id, date_trunc('month', f.scheduled_date)::date as month,
        count(*) as scheduled, count(*) filter (where lower(f.status) = 'completed') as completed
      from public.follow_ups f join activity_residents r on r.id = f.resident_id
      where f.scheduled_date >= v_activity_from and f.scheduled_date <= v_activity_to group by 1, 2
    ), activity_referrals as (
      select r.barangay_id, date_trunc('month', h.created_at at time zone 'Asia/Manila')::date as month,
        count(*) as created, count(*) filter (where lower(h.status) = 'completed') as completed
      from public.health_referrals h join activity_residents r on r.id = h.resident_id
      where h.created_at >= v_activity_from::timestamp at time zone 'Asia/Manila'
        and h.created_at < (v_activity_to + 1)::timestamp at time zone 'Asia/Manila' group by 1, 2
    ), activity_maternal as (
      select r.barangay_id, date_trunc('month', m.created_at at time zone 'Asia/Manila')::date as month,
        count(*) as records, count(distinct r.id) as residents
      from public.maternal_records m join activity_residents r on r.id = m.resident_id
      where m.created_at >= v_activity_from::timestamp at time zone 'Asia/Manila'
        and m.created_at < (v_activity_to + 1)::timestamp at time zone 'Asia/Manila' group by 1, 2
    ), activity_encounters as materialized (
      select v.resident_id, r.barangay_id, date_trunc('month', v.occurred_at at time zone 'Asia/Manila')::date as month,
        case when isfinite(r.birth_date) and r.birth_date <= (v.occurred_at at time zone 'Asia/Manila')::date
          then extract(year from age((v.occurred_at at time zone 'Asia/Manila')::date, r.birth_date))::integer end as age
      from visits v join activity_residents r on r.id = v.resident_id
      where v.occurred_at >= v_activity_from::timestamp at time zone 'Asia/Manila'
        and v.occurred_at < (v_activity_to + 1)::timestamp at time zone 'Asia/Manila'
    ), activity_consultations as (
      select barangay_id, month, count(*) as records, count(distinct resident_id) as residents,
        count(*) filter (where age < 18) as minor_records, count(distinct resident_id) filter (where age < 18) as minor_residents,
        count(*) filter (where age >= 60) as senior_records, count(distinct resident_id) filter (where age >= 60) as senior_residents,
        count(*) filter (where age is null) as unknown_records, count(distinct resident_id) filter (where age is null) as unknown_residents
      from activity_encounters group by 1, 2
    ), activity_immunizations as (
      select r.barangay_id, date_trunc('month', i.created_at at time zone 'Asia/Manila')::date as month,
        count(*) as records, count(distinct r.id) as residents
      from public.immunizations i join activity_residents r on r.id = i.resident_id
      where i.created_at >= v_activity_from::timestamp at time zone 'Asia/Manila'
        and i.created_at < (v_activity_to + 1)::timestamp at time zone 'Asia/Manila' group by 1, 2
    ), activity_enrollments as (
      select r.barangay_id, date_trunc('month', t.created_at at time zone 'Asia/Manila')::date as month,
        count(distinct (r.id, lower(btrim(t.program)))) as groups, count(distinct r.id) as residents
      from public.tcl_entries t join activity_residents r on r.id = t.resident_id
      where nullif(btrim(t.program), '') is not null
        and t.created_at >= v_activity_from::timestamp at time zone 'Asia/Manila'
        and t.created_at < (v_activity_to + 1)::timestamp at time zone 'Asia/Manila' group by 1, 2
    ), activity_participation as (
      select r.barangay_id, date_trunc('month', t.last_visit)::date as month,
        count(distinct (r.id, lower(btrim(t.program)))) as groups, count(distinct r.id) as residents
      from public.tcl_entries t join activity_residents r on r.id = t.resident_id
      where nullif(btrim(t.program), '') is not null
        and t.last_visit >= v_activity_from and t.last_visit <= v_activity_to group by 1, 2
    ), activity_keys as (
      select barangay_id, month from activity_followups union select barangay_id, month from activity_referrals
      union select barangay_id, month from activity_maternal union select barangay_id, month from activity_consultations
      union select barangay_id, month from activity_immunizations union select barangay_id, month from activity_enrollments
      union select barangay_id, month from activity_participation
    ), activity_rows as (
      select k.month, b.id as barangay_id, b.name, jsonb_build_object(
        'barangayId', b.id, 'barangay', b.name, 'month', to_char(k.month, 'YYYY-MM'),
        'followUps', jsonb_build_object('scheduled', coalesce(f.scheduled, 0), 'completed', coalesce(f.completed, 0),
          'completionPercent', round(100.0 * f.completed / nullif(f.scheduled, 0), 2)),
        'referrals', jsonb_build_object('created', coalesce(ref.created, 0), 'completed', coalesce(ref.completed, 0),
          'completionPercent', round(100.0 * ref.completed / nullif(ref.created, 0), 2)),
        'maternal', jsonb_build_object('records', coalesce(m.records, 0), 'residents', coalesce(m.residents, 0)),
        'consultations', jsonb_build_object('records', coalesce(c.records, 0), 'residents', coalesce(c.residents, 0),
          'minor', jsonb_build_object('records', coalesce(c.minor_records, 0), 'residents', coalesce(c.minor_residents, 0)),
          'senior', jsonb_build_object('records', coalesce(c.senior_records, 0), 'residents', coalesce(c.senior_residents, 0)),
          'unknownAge', jsonb_build_object('records', coalesce(c.unknown_records, 0), 'residents', coalesce(c.unknown_residents, 0))),
        'immunizations', jsonb_build_object('records', coalesce(i.records, 0), 'residents', coalesce(i.residents, 0)),
        'tcl', jsonb_build_object('enrollmentGroups', coalesce(e.groups, 0), 'enrolledResidents', coalesce(e.residents, 0),
          'participationGroups', coalesce(p.groups, 0), 'participatingResidents', coalesce(p.residents, 0))
      ) as payload
      from activity_keys k join public.barangays b on b.id = k.barangay_id
      left join activity_followups f on f.barangay_id = k.barangay_id and f.month = k.month
      left join activity_referrals ref on ref.barangay_id = k.barangay_id and ref.month = k.month
      left join activity_maternal m on m.barangay_id = k.barangay_id and m.month = k.month
      left join activity_consultations c on c.barangay_id = k.barangay_id and c.month = k.month
      left join activity_immunizations i on i.barangay_id = k.barangay_id and i.month = k.month
      left join activity_enrollments e on e.barangay_id = k.barangay_id and e.month = k.month
      left join activity_participation p on p.barangay_id = k.barangay_id and p.month = k.month
    ), activity as (
      select jsonb_build_object('schemaVersion', 1, 'timeZone', 'Asia/Manila', 'granularity', 'barangay-month',
        'reportingPeriod', jsonb_build_object('from', v_activity_from, 'to', v_activity_to),
        'scopeComplete', coalesce(cardinality(v_scope_ids), 0) > 0,
        'scopeBasis', 'Current resident geography in registered active approved barangays',
        'rowBasis', 'Sparse stored activity; missing rows mean recorded zeroes only within a readable complete scope; zero completion denominator means null',
        'months', (select jsonb_agg(to_char(month, 'YYYY-MM') order by month) from generate_series(
          date_trunc('month', v_activity_from::timestamp), date_trunc('month', v_activity_to::timestamp), interval '1 month') as calendar(month)),
        'definitions', '{
          "followUps":{"label":"Recorded Scheduled Follow-up Completion","unit":"percent","countUnit":"records","value":"followUps.completionPercent","numerator":"followUps.completed","denominator":"followUps.scheduled","dateBasis":"scheduled_date","statusBasis":"current status","denominatorDefinition":"All recorded scheduled follow-up rows, including missed/cancelled; Completed only in numerator","zeroDenominatorValue":null},
          "referrals":{"label":"Recorded Referral Cohort Completion","unit":"percent","countUnit":"records","value":"referrals.completionPercent","numerator":"referrals.completed","denominator":"referrals.created","dateBasis":"health_referrals.created_at","statusBasis":"current status","denominatorDefinition":"All canonical rows created in the cohort, including Rejected/Cancelled; Completed only in numerator","zeroDenominatorValue":null},
          "maternal":{"label":"Recorded Maternal Resident Activity","unit":"residents","value":"maternal.residents","records":"maternal.records","dateBasis":"created_at","denominator":null},
          "minorConsultations":{"label":"Recorded Minor Consultation Activity","unit":"residents","value":"consultations.minor.residents","records":"consultations.minor.records","dateBasis":"coalesce(visit_date,created_at)","ageBasis":"Completed years at Manila encounter date, under 18; missing/future birth dates are unclassified","denominator":null},
          "seniorConsultations":{"label":"Recorded Senior Consultation Activity","unit":"residents","value":"consultations.senior.residents","records":"consultations.senior.records","dateBasis":"coalesce(visit_date,created_at)","ageBasis":"Completed years at Manila encounter date, at least 60","denominator":null},
          "immunizations":{"label":"Recorded Immunization Records","unit":"records","value":"immunizations.records","residents":"immunizations.residents","dateBasis":"created_at","denominator":null,"officialCoverageAvailable":false,"note":"Recorded rows including Due/Missed, not doses given or official coverage/eligibility"},
          "tclEnrollment":{"label":"Recorded TCL Enrollment Activity","unit":"residents","value":"tcl.enrolledResidents","groups":"tcl.enrollmentGroups","groupUnit":"resident-program groups","groupBasis":"Unique resident plus nonblank normalized recorded program text per month","dateBasis":"created_at","denominator":null,"officialComplianceAvailable":false},
          "tclParticipation":{"label":"Recorded TCL Resident Participation","unit":"residents","value":"tcl.participatingResidents","groups":"tcl.participationGroups","groupUnit":"resident-program groups","groupBasis":"Unique resident plus nonblank normalized recorded program text per month","dateBasis":"last_visit","denominator":null,"officialComplianceAvailable":false,"note":"Stored last_visit dates only, not a complete attendance history or official compliance measure"}
        }'::jsonb,
        'rows', coalesce((select jsonb_agg(payload order by month,
          array_position(array['san antonio', 'san isidro', 'old san roque'], lower(name)), barangay_id)
          from activity_rows), '[]'::jsonb)) as payload
    ), summary as (
      select (select count(*) from residents) as residents,
        coalesce((select consultations from months where month = v_month), 0) as consultations,
        coalesce((select referrals from months where month = v_month), 0) as referrals,
        coalesce((select jsonb_agg(jsonb_build_object('name', name, 'value', value)
          order by value desc, name collate "C") -> 0 from conditions where name <> 'Others'),
          '{"name":"No recorded condition","value":0}'::jsonb) as top,
        case when risk.high > 0 then 'Needs Attention' when risk.moderate > 0 then 'Stable' else 'Healthy' end as status,
        risk.* from risk
    )
    select jsonb_build_object(
      'scope', jsonb_build_object('barangay', v_barangay_name),
      'monitoring', (select payload from monitoring),
      'activity', (select payload from activity),
      'summary', jsonb_build_object('consultationsThisMonth', s.consultations, 'referralsThisMonth', s.referrals,
        'topCondition', s.top ->> 'name', 'topConditionCases', s.top -> 'value', 'highRiskResidents', s.high, 'residents', s.residents),
      'status', s.status,
      'consultationTrends', (select jsonb_agg(jsonb_build_object('month', to_char(month, 'Mon'),
        'consultations', consultations, 'referrals', referrals) order by month) from months),
      'diseaseDistribution', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'value', value)
        order by value desc, name collate "C") from conditions), '[]'::jsonb),
      'riskDistribution', jsonb_build_array(jsonb_build_object('name', 'Low Risk', 'value', s.low),
        jsonb_build_object('name', 'Moderate Risk', 'value', s.moderate), jsonb_build_object('name', 'High Risk', 'value', s.high),
        jsonb_build_object('name', 'Unassessed', 'value', s.unassessed)),
      'barangayOverview', jsonb_build_object('name', coalesce(v_barangay_name, 'Municipality of ' || v_municipality_name),
        'residents', s.residents, 'consultations', s.consultations, 'status', s.status)
    ) into v_result from summary s;

  elsif p_kind = 'community-map' then
    with barangays as materialized (
      select b.id, b.name, b.latitude, b.longitude from public.barangays b where b.id = any(v_scope_ids)
    ), residents as materialized (
      select r.id, r.barangay_id from public.residents r where r.municipality_id = v_actor.municipality_id
        and r.barangay_id = any(v_scope_ids)
    ), visits as materialized (
      select v.id, v.resident_id, r.barangay_id, coalesce(v.visit_date, v.created_at) as occurred_at,
        v.updated_at, v.created_at, lower(v.status) as status,
        public.analytics_condition(v.chief_complaint) as condition,
        public.analytics_visit_risk(v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg, v_config) as risk
      from public.visits v join residents r on r.id = v.resident_id
    ), latest as (
      select distinct on (resident_id) resident_id, barangay_id, risk from visits
      order by resident_id, occurred_at desc, updated_at desc, created_at desc, id desc
    ), matched as materialized (
      select * from visits where (v_from is null or occurred_at >= v_from) and (v_until is null or occurred_at < v_until)
        and (p_condition is null or condition = p_condition) and (p_status is null or status = p_status)
        and (p_risk_level is null or risk = p_risk_level)
    ), ranked as (
      select m.*, row_number() over (partition by resident_id, condition
        order by occurred_at desc, updated_at desc, created_at desc, id desc) as position from matched m
    ), cases as materialized (
      -- TB is always a unique resident-condition group. Other conditions retain
      -- visit counts unless the existing distinctResidents map option is set.
      select * from ranked where position = 1 or (not coalesce(p_distinct_residents, false) and condition <> 'Tuberculosis')
    ), tb as (
      select t.resident_id, r.barangay_id,
        max(coalesce(t.created_at, t.last_visit::timestamp at time zone 'Asia/Manila')) as occurred_at,
        bool_or(date_trunc('month', coalesce(t.created_at, t.last_visit::timestamp at time zone 'Asia/Manila') at time zone 'Asia/Manila')::date = v_month) as new_case
      from public.tcl_entries t join residents r on r.id = t.resident_id
      where p_status is null and p_risk_level is null and (p_condition is null or p_condition = 'Tuberculosis')
        and lower(t.status) = 'active' and t.program ~* '\mtb\M|tuberculosis'
        and (v_from is null or coalesce(t.created_at, t.last_visit::timestamp at time zone 'Asia/Manila') >= v_from)
        and (v_until is null or coalesce(t.created_at, t.last_visit::timestamp at time zone 'Asia/Manila') < v_until)
        and not exists (select 1 from cases c where c.resident_id = t.resident_id and c.condition = 'Tuberculosis')
      group by t.resident_id, r.barangay_id
    ), case_rows as materialized (
      select barangay_id, condition, status, occurred_at,
        date_trunc('month', occurred_at at time zone 'Asia/Manila')::date = v_month as new_case from cases
      union all select barangay_id, 'Tuberculosis', null, occurred_at, new_case from tb
    ), latest_matched as (
      select distinct on (resident_id) resident_id, barangay_id, risk from matched
      order by resident_id, occurred_at desc, updated_at desc, created_at desc, id desc
    ), condition_counts as (
      select barangay_id, condition as name, count(*) as value from case_rows group by barangay_id, condition
    ), stats as (
      select b.id, b.name, b.latitude, b.longitude,
        b.latitude between -90 and 90 and b.longitude between -180 and 180 as coordinates,
        (select count(*) from residents r where r.barangay_id = b.id) as residents,
        (select count(*) from latest l where l.barangay_id = b.id and l.risk = 'High') as high_risk,
        count(c.barangay_id) as case_count, count(*) filter (where c.new_case) as new_cases,
        count(c.barangay_id) filter (where c.status is distinct from 'completed') as active_cases,
        count(*) filter (where c.status = 'completed') as completed_cases,
        max((c.occurred_at at time zone 'Asia/Manila')::date) as last_recorded
      from barangays b left join case_rows c on c.barangay_id = b.id group by b.id, b.name, b.latitude, b.longitude
    ), rows as (
      select s.*, jsonb_build_object(
        'id', s.id, 'name', s.name, 'registryAvailable', true,
        'latitude', case when s.coordinates then s.latitude end, 'longitude', case when s.coordinates then s.longitude end,
        'hasCoordinates', coalesce(s.coordinates, false), 'residents', s.residents, 'highRiskResidents', s.high_risk,
        'caseCount', s.case_count, 'newCases', s.new_cases, 'activeCases', s.active_cases, 'completedCases', s.completed_cases,
        'conditions', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'value', value)
          order by value desc, name collate "C") from condition_counts c where c.barangay_id = s.id), '[]'::jsonb),
        'topCondition', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'value', value)
          order by value desc, name collate "C") -> 0 from condition_counts c where c.barangay_id = s.id and name <> 'Others'),
          '{"name":"No recorded condition","value":0}'::jsonb),
        'riskCounts', (select jsonb_build_object('High', count(*) filter (where risk = 'High'),
          'Moderate', count(*) filter (where risk = 'Moderate'), 'Low', count(*) filter (where risk = 'Low'),
          'Unassessed', count(*) filter (where risk = 'Unassessed')) from latest_matched m where m.barangay_id = s.id),
        'statusCounts', (select jsonb_build_object('draft', count(*) filter (where status = 'draft'),
          'submitted', count(*) filter (where status = 'submitted'), 'received', count(*) filter (where status = 'received'),
          'in_review', count(*) filter (where status = 'in_review'), 'referred', count(*) filter (where status = 'referred'),
          'completed', count(*) filter (where status = 'completed')) from cases c where c.barangay_id = s.id),
        'lastRecorded', s.last_recorded,
        'intensity', coalesce(round(s.case_count::numeric / nullif(max(s.case_count) over (), 0), 3), 0)
      ) as payload from stats s
    )
    select jsonb_build_object(
      'scope', case when v_barangay_id is null then 'municipality' else 'barangay' end,
      'condition', coalesce(p_condition, 'All'), 'status', coalesce(p_status, 'All'), 'riskLevel', coalesce(p_risk_level, 'All'),
      'reportingPeriod', jsonb_build_object('from', p_from, 'to', p_to), 'scopeComplete', true,
      'latestUpdatedAt', (select max(updated_at) from matched), 'center', v_center,
      'summary', jsonb_build_object('totalCases', coalesce(sum(case_count), 0),
        'affectedBarangays', count(*) filter (where case_count > 0), 'newCases', coalesce(sum(new_cases), 0),
        'activeCases', coalesce(sum(active_cases), 0), 'completedCases', coalesce(sum(completed_cases), 0)),
      'conditionTotals', (select jsonb_agg(jsonb_build_object('name', name, 'value',
        coalesce((select sum(c.value) from condition_counts c where c.name = n.name), 0)) order by n.position)
        from unnest(array['Tuberculosis', 'Dengue', 'Malaria', 'Hypertension', 'Diabetes', 'Respiratory', 'Maternal', 'Anemia', 'Gastrointestinal', 'Others'])
          with ordinality as n(name, position)),
      'barangays', coalesce(jsonb_agg(payload order by array_position(array['san antonio', 'san isidro', 'old san roque'], lower(name)), id), '[]'::jsonb)
    ) into v_result from rows;

  elsif p_kind = 'community-map-trends' then
    with residents as materialized (
      select r.id from public.residents r where r.municipality_id = v_actor.municipality_id
        and r.barangay_id = any(v_scope_ids)
    ), visits as materialized (
      select v.id, v.resident_id, coalesce(v.visit_date, v.created_at) as occurred_at, v.updated_at, v.created_at,
        public.analytics_condition(v.chief_complaint) as condition
      from public.visits v join residents r on r.id = v.resident_id
      where coalesce(v.visit_date, v.created_at) >= make_date(v_year, 1, 1)::timestamp at time zone 'Asia/Manila'
        and coalesce(v.visit_date, v.created_at) < make_date(v_year + 1, 1, 1)::timestamp at time zone 'Asia/Manila'
        and (v_from is null or coalesce(v.visit_date, v.created_at) >= v_from)
        and (v_until is null or coalesce(v.visit_date, v.created_at) < v_until)
        and (p_condition is null or public.analytics_condition(v.chief_complaint) = p_condition)
        and (p_status is null or lower(v.status) = p_status)
        and (p_risk_level is null or public.analytics_visit_risk(
          v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg, v_config) = p_risk_level)
    ), ranked as (
      select v.*, extract(month from occurred_at at time zone 'Asia/Manila')::integer as month,
        row_number() over (partition by resident_id, condition, date_trunc('month', occurred_at at time zone 'Asia/Manila')
          order by occurred_at desc, updated_at desc, created_at desc, id desc) as position from visits v
    ), cases as materialized (
      select resident_id, condition, month from ranked
      where position = 1 or (not coalesce(p_distinct_residents, false) and condition <> 'Tuberculosis')
    ), tb as (
      select distinct t.resident_id,
        extract(month from coalesce(t.created_at, t.last_visit::timestamp at time zone 'Asia/Manila') at time zone 'Asia/Manila')::integer as month
      from public.tcl_entries t join residents r on r.id = t.resident_id
      where p_status is null and p_risk_level is null and (p_condition is null or p_condition = 'Tuberculosis')
        and lower(t.status) = 'active' and t.program ~* '\mtb\M|tuberculosis'
        and coalesce(t.created_at, t.last_visit::timestamp at time zone 'Asia/Manila') >= make_date(v_year, 1, 1)::timestamp at time zone 'Asia/Manila'
        and coalesce(t.created_at, t.last_visit::timestamp at time zone 'Asia/Manila') < make_date(v_year + 1, 1, 1)::timestamp at time zone 'Asia/Manila'
        and (v_from is null or coalesce(t.created_at, t.last_visit::timestamp at time zone 'Asia/Manila') >= v_from)
        and (v_until is null or coalesce(t.created_at, t.last_visit::timestamp at time zone 'Asia/Manila') < v_until)
    ), case_months as (
      select month, count(*) as value from (
        select month from cases union all select t.month from tb t
        where not exists (select 1 from cases c where c.resident_id = t.resident_id and c.condition = 'Tuberculosis' and c.month = t.month)
      ) recorded group by month
    )
    select jsonb_build_object(
      'scope', case when v_barangay_id is null then 'municipality' else 'barangay' end, 'barangay', v_barangay_name,
      'condition', coalesce(p_condition, 'All'), 'status', coalesce(p_status, 'All'), 'riskLevel', coalesce(p_risk_level, 'All'),
      'reportingPeriod', jsonb_build_object('from', p_from, 'to', p_to), 'year', v_year, 'scopeComplete', true,
      'monthly', (select jsonb_agg(jsonb_build_object('month', to_char(make_date(v_year, m.month, 1), 'Mon'),
        'cases', coalesce(c.value, 0)) order by m.month) from generate_series(1, 12) as m(month)
        left join case_months c on c.month = m.month)
    ) into v_result;

  else
    with households as materialized (
      select h.id, h.barangay_id from public.households h where h.municipality_id = v_actor.municipality_id
        and (v_barangay_id is null or h.barangay_id = v_barangay_id)
    ), residents as materialized (
      select r.id, r.barangay_id from public.residents r where r.municipality_id = v_actor.municipality_id
        and (v_barangay_id is null or r.barangay_id = v_barangay_id)
    ), active_residents as (
      select r.id, r.barangay_id from residents r where
        exists (select 1 from public.visits v where v.resident_id = r.id and lower(v.status) <> 'completed')
        or exists (select 1 from public.tcl_entries t where t.resident_id = r.id
          and lower(t.status) = 'active' and t.program ~* '\mtb\M|tuberculosis')
    ), members as (
      select m.household_id, count(*) as value,
        bool_or(a.id is not null) as active from public.household_members m
      join households h on h.id = m.household_id
      left join active_residents a on a.id = m.resident_id and a.barangay_id = h.barangay_id
      group by m.household_id
    ), totals as (
      select h.barangay_id, count(*) as households, coalesce(sum(m.value), 0) as members,
        count(*) filter (where m.active) as active from households h
      left join members m on m.household_id = h.id group by h.barangay_id
    ), locations as (
      select t.*, b.name, b.latitude, b.longitude,
        coalesce(b.latitude between -90 and 90 and b.longitude between -180 and 180, false) as coordinates
      from totals t left join public.barangays b on b.id = t.barangay_id and b.municipality_id = v_actor.municipality_id
        and b.status = 'Active' and public.is_approved_barangay_name(b.name)
    )
    select jsonb_build_object(
      'scope', case when v_barangay_id is null then 'municipality' else 'barangay' end,
      'summary', jsonb_build_object('households', coalesce(sum(households), 0),
        'plotted', count(*) filter (where coordinates), 'unplotted', count(*) filter (where not coordinates),
        'activeCaseHouseholds', coalesce(sum(active), 0)),
      'locations', coalesce(jsonb_agg(jsonb_build_object('barangay', name, 'householdCount', households,
        'memberCount', members, 'activeHouseholds', active, 'hasCoordinates', true, 'latitude', latitude, 'longitude', longitude)
        order by array_position(array['san antonio', 'san isidro', 'old san roque'], lower(name)), barangay_id)
        filter (where coordinates), '[]'::jsonb)
    ) into v_result from locations;
  end if;
  return v_result;
end;
$$;

revoke all on function public.analytics_condition(text) from public, anon, authenticated;
revoke all on function public.analytics_assess_vitals(text, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.analytics_visit_risk(text, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.analytics_risk_configuration() from public, anon, authenticated;
revoke all on function public.scoped_aggregate_analytics(uuid, text, text, text, text, text, date, date, integer, boolean) from public, anon, authenticated;
grant execute on function public.analytics_condition(text) to service_role;
grant execute on function public.analytics_assess_vitals(text, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, boolean) to service_role;
grant execute on function public.analytics_visit_risk(text, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) to service_role;
grant execute on function public.analytics_risk_configuration() to service_role;
grant execute on function public.scoped_aggregate_analytics(uuid, text, text, text, text, text, date, date, integer, boolean) to service_role;

commit;
