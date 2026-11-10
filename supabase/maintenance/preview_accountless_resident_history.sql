-- Read-only preview. Run in Supabase SQL Editor; this file contains SELECTs only.

with candidates as (
  select r.id, r.health_record_no,
         concat_ws(' ', nullif(r.first_name, ''), nullif(r.middle_name, ''),
                   nullif(r.last_name, ''), nullif(r.suffix, '')) as resident_name,
         r.created_by_role, r.verification_status, r.barangay, r.created_at
  from public.residents r
  where r.auth_user_id is null
    and lower(trim(coalesce(r.created_by_role, ''))) in ('resident', 'resident-limited')
)
select * from candidates order by created_at, id;

with candidates as (
  select r.id
  from public.residents r
  where r.auth_user_id is null
    and lower(trim(coalesce(r.created_by_role, ''))) in ('resident', 'resident-limited')
),
candidate_visits as (
  select v.id
  from public.visits v
  join candidates c on c.id = v.resident_id
),
candidate_legacy_referrals as (
  select distinct rf.id
  from public.referrals rf
  left join candidate_visits cv on cv.id = rf.visit_id
  join candidates c on c.id = rf.resident_id
     or cv.id is not null
),
candidate_health_referrals as (
  select distinct hr.id
  from public.health_referrals hr
  left join candidate_visits cv on cv.id = hr.treatment_visit_id
  join candidates c on c.id = hr.resident_id
     or cv.id is not null
),
linked_counts as (
  select 'residents'::text as table_name, count(*)::bigint as linked_rows from candidates
  union all select 'visits', count(*) from candidate_visits
  union all select 'referrals (resident or linked visit)', count(*) from candidate_legacy_referrals
  union all select 'health_referrals (resident or linked visit)', count(*) from candidate_health_referrals
  union all select 'health_referral_history', count(*) from public.health_referral_history h
    join candidate_health_referrals c on c.id = h.referral_id
  union all select 'health_referral_legacy_map', count(*) from public.health_referral_legacy_map m
    where m.legacy_referral_id in (select id from candidate_legacy_referrals)
       or m.health_referral_id in (select id from candidate_health_referrals)
  union all select 'documents', count(*) from public.documents d join candidates c on c.id = d.resident_id
  union all select 'identity_verifications', count(*) from public.identity_verifications i join candidates c on c.id = i.resident_id
  union all select 'resident_verification_logs', count(*) from public.resident_verification_logs l join candidates c on c.id = l.resident_id
  union all select 'household_members (link rows only)', count(*) from public.household_members hm join candidates c on c.id = hm.resident_id
  union all select 'transfer_requests (resident_id)', count(*) from public.transfer_requests tr join candidates c on c.id = tr.resident_id
  union all select 'transfer_requests (target_resident_id)', count(*) from public.transfer_requests tr join candidates c on c.id = tr.target_resident_id
  union all select 'follow_ups', count(*) from public.follow_ups x join candidates c on c.id = x.resident_id
  union all select 'tcl_entries', count(*) from public.tcl_entries x join candidates c on c.id = x.resident_id
  union all select 'maternal_records', count(*) from public.maternal_records x join candidates c on c.id = x.resident_id
  union all select 'immunizations', count(*) from public.immunizations x join candidates c on c.id = x.resident_id
  union all select 'm1_records (resident-linked)', count(*) from public.m1_records x join candidates c on c.id = x.resident_id
  union all select 'medical_certificates', count(*) from public.medical_certificates x join candidates c on c.id = x.resident_id
  union all select 'resident_guardian_links (either side)', count(*) from public.resident_guardian_links x
    join candidates c on c.id = x.minor_resident_id or c.id = x.guardian_resident_id
  union all select 'health_service_attendance', count(*) from public.health_service_attendance x join candidates c on c.id = x.resident_id
  union all select 'ncd_risk_assessments', count(*) from public.ncd_risk_assessments x join candidates c on c.id = x.resident_id
  union all select 'ncd_cervical_breast', count(*) from public.ncd_cervical_breast x join candidates c on c.id = x.resident_id
  union all select 'ncd_visual_ppv', count(*) from public.ncd_visual_ppv x join candidates c on c.id = x.resident_id
  union all select 'oral_health_records', count(*) from public.oral_health_records x join candidates c on c.id = x.resident_id
  union all select 'appointments', count(*) from public.appointments x join candidates c on c.id = x.resident_id
  union all select 'visit_plans', count(*) from public.visit_plans x join candidates c on c.id = x.resident_id
  union all select 'maternal_visits', count(*) from public.maternal_visits x join candidates c on c.id = x.resident_id
)
select table_name, linked_rows
from linked_counts
where linked_rows > 0
order by table_name;
