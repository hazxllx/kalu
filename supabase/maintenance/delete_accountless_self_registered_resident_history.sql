-- Destructive one-time cleanup. Run only after exporting the storage paths with
-- export_accountless_resident_document_paths.sql and retaining that CSV.
-- The script aborts unless the exact 26 reviewed residents still match the
-- self-registration + deleted-account criteria.

begin;

do $$
declare
  target_ids text[] := array[
    'RES-000007','RES-000008','RES-000009','RES-000010','RES-000011','RES-000012',
    'RES-000013','RES-000014','RES-000015','RES-000016','RES-000017','RES-000018',
    'RES-000019','RES-000020','RES-000021','RES-000022','RES-000023','RES-000040',
    'RES-000047','RES-000050','RES-000054','RES-000055','RES-000056','RES-000057',
    'RES-000058','RES-000062'
  ];
  currently_eligible text[];
  missing_ids text[];
  unexpected_ids text[];
begin
  select array_agg(r.id order by r.id)
    into currently_eligible
  from public.residents r
  where r.id = any(target_ids)
    and r.auth_user_id is null
    and lower(trim(coalesce(r.created_by_role, ''))) in ('resident', 'resident-limited');

  select array_agg(expected_id order by expected_id)
    into missing_ids
  from unnest(target_ids) as expected(expected_id)
  where not (expected_id = any(coalesce(currently_eligible, array[]::text[])));

  select array_agg(current_id order by current_id)
    into unexpected_ids
  from unnest(coalesce(currently_eligible, array[]::text[])) as current(current_id)
  where not (current_id = any(target_ids));

  if cardinality(coalesce(currently_eligible, array[]::text[])) <> cardinality(target_ids)
     or coalesce(cardinality(missing_ids), 0) > 0
     or coalesce(cardinality(unexpected_ids), 0) > 0 then
    raise exception 'Cleanup stopped: candidate IDs differ. Missing from current eligible set: %. Newly eligible IDs: %.',
      coalesce(missing_ids, array[]::text[]), coalesce(unexpected_ids, array[]::text[]);
  end if;

  -- Clear referral audit children and the crosswalk before their parent rows.
  delete from public.health_referral_history h
  where h.referral_id in (
    select hr.id from public.health_referrals hr
    where hr.resident_id = any(target_ids)
       or hr.treatment_visit_id in (select v.id from public.visits v where v.resident_id = any(target_ids))
  );

  delete from public.health_referral_legacy_map m
  where m.health_referral_id in (
    select hr.id from public.health_referrals hr
    where hr.resident_id = any(target_ids)
       or hr.treatment_visit_id in (select v.id from public.visits v where v.resident_id = any(target_ids))
  ) or m.legacy_referral_id in (
    select rf.id from public.referrals rf
    where rf.resident_id = any(target_ids)
       or rf.visit_id in (select v.id from public.visits v where v.resident_id = any(target_ids))
  );

  delete from public.referrals rf
  where rf.resident_id = any(target_ids)
     or rf.visit_id in (select v.id from public.visits v where v.resident_id = any(target_ids));

  -- Remove resident-specific clinical and operational history with RESTRICT FKs.
  delete from public.follow_ups where resident_id = any(target_ids);
  delete from public.tcl_entries where resident_id = any(target_ids);
  delete from public.maternal_records where resident_id = any(target_ids);
  delete from public.immunizations where resident_id = any(target_ids);
  delete from public.m1_records where resident_id = any(target_ids);
  delete from public.medical_certificates where resident_id = any(target_ids);
  delete from public.ncd_risk_assessments where resident_id = any(target_ids);
  delete from public.ncd_cervical_breast where resident_id = any(target_ids);
  delete from public.ncd_visual_ppv where resident_id = any(target_ids);
  delete from public.oral_health_records where resident_id = any(target_ids);
  delete from public.maternal_visits where resident_id = any(target_ids);
  delete from public.transfer_requests
    where resident_id = any(target_ids) or target_resident_id = any(target_ids);

  -- Remove history row(s) before the encounter, then its original referral.
  delete from public.visits where resident_id = any(target_ids);
  delete from public.health_referrals where resident_id = any(target_ids);

  -- Remove the person's household membership link, while preserving the shared
  -- household profile and any other members. Other resident links are nulled by
  -- the resident FK's existing ON DELETE SET NULL behavior.
  delete from public.household_members where resident_id = any(target_ids);

  -- Cascading FKs remove identity verification, resident documents and logs,
  -- appointments, visit plans, service attendance, and minor-side guardian links.
  delete from public.residents where id = any(target_ids);
end $$;

commit;

-- This should return zero after a successful cleanup.
select count(*) as matching_residents_remaining
from public.residents
where id in (
  'RES-000007','RES-000008','RES-000009','RES-000010','RES-000011','RES-000012',
  'RES-000013','RES-000014','RES-000015','RES-000016','RES-000017','RES-000018',
  'RES-000019','RES-000020','RES-000021','RES-000022','RES-000023','RES-000040',
  'RES-000047','RES-000050','RES-000054','RES-000055','RES-000056','RES-000057',
  'RES-000058','RES-000062'
);
