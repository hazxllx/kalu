-- Read-only check for any remaining rows tied to the 26 reviewed resident IDs.
-- It does not depend on the resident rows still existing.
with reviewed_ids(id) as (
  values
    ('RES-000007'),('RES-000008'),('RES-000009'),('RES-000010'),('RES-000011'),('RES-000012'),
    ('RES-000013'),('RES-000014'),('RES-000015'),('RES-000016'),('RES-000017'),('RES-000018'),
    ('RES-000019'),('RES-000020'),('RES-000021'),('RES-000022'),('RES-000023'),('RES-000040'),
    ('RES-000047'),('RES-000050'),('RES-000054'),('RES-000055'),('RES-000056'),('RES-000057'),
    ('RES-000058'),('RES-000062')
), target_visits as (
  select v.id from public.visits v join reviewed_ids i on i.id = v.resident_id
), target_referrals as (
  select distinct r.id
  from public.referrals r
  left join target_visits v on v.id = r.visit_id
  where r.resident_id in (select id from reviewed_ids) or v.id is not null
), target_health_referrals as (
  select distinct r.id
  from public.health_referrals r
  left join target_visits v on v.id = r.treatment_visit_id
  where r.resident_id in (select id from reviewed_ids) or v.id is not null
), residual_counts as (
  select 'residents'::text table_name, count(*)::bigint remaining
  from public.residents where id in (select id from reviewed_ids)
  union all select 'visits', count(*) from public.visits where resident_id in (select id from reviewed_ids)
  union all select 'referrals (resident or visit-linked)', count(*) from target_referrals
  union all select 'health_referrals (resident or visit-linked)', count(*) from target_health_referrals
  union all select 'health_referral_history', count(*) from public.health_referral_history h
    where h.referral_id in (select id from target_health_referrals)
  union all select 'health_referral_legacy_map', count(*) from public.health_referral_legacy_map m
    where m.legacy_referral_id in (select id from target_referrals)
       or m.health_referral_id in (select id from target_health_referrals)
  union all select 'documents', count(*) from public.documents where resident_id in (select id from reviewed_ids)
  union all select 'resident_verification_logs', count(*) from public.resident_verification_logs where resident_id in (select id from reviewed_ids)
  union all select 'identity_verifications', count(*) from public.identity_verifications where resident_id in (select id from reviewed_ids)
  union all select 'household_members', count(*) from public.household_members where resident_id in (select id from reviewed_ids)
  union all select 'transfer_requests', count(*) from public.transfer_requests
    where resident_id in (select id from reviewed_ids) or target_resident_id in (select id from reviewed_ids)
  union all select 'follow_ups', count(*) from public.follow_ups where resident_id in (select id from reviewed_ids)
  union all select 'tcl_entries', count(*) from public.tcl_entries where resident_id in (select id from reviewed_ids)
  union all select 'maternal_records', count(*) from public.maternal_records where resident_id in (select id from reviewed_ids)
  union all select 'immunizations', count(*) from public.immunizations where resident_id in (select id from reviewed_ids)
  union all select 'm1_records', count(*) from public.m1_records where resident_id in (select id from reviewed_ids)
  union all select 'medical_certificates', count(*) from public.medical_certificates where resident_id in (select id from reviewed_ids)
  union all select 'resident_guardian_links', count(*) from public.resident_guardian_links
    where minor_resident_id in (select id from reviewed_ids) or guardian_resident_id in (select id from reviewed_ids)
  union all select 'health_service_attendance', count(*) from public.health_service_attendance where resident_id in (select id from reviewed_ids)
  union all select 'ncd_risk_assessments', count(*) from public.ncd_risk_assessments where resident_id in (select id from reviewed_ids)
  union all select 'ncd_cervical_breast', count(*) from public.ncd_cervical_breast where resident_id in (select id from reviewed_ids)
  union all select 'ncd_visual_ppv', count(*) from public.ncd_visual_ppv where resident_id in (select id from reviewed_ids)
  union all select 'oral_health_records', count(*) from public.oral_health_records where resident_id in (select id from reviewed_ids)
  union all select 'appointments', count(*) from public.appointments where resident_id in (select id from reviewed_ids)
  union all select 'visit_plans', count(*) from public.visit_plans where resident_id in (select id from reviewed_ids)
  union all select 'maternal_visits', count(*) from public.maternal_visits where resident_id in (select id from reviewed_ids)
)
select table_name, remaining
from residual_counts
order by table_name;
