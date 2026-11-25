-- KALUSAGAP account/data-integrity review (READ ONLY)
--
-- Run in the Supabase SQL editor using a privileged administrator connection.
-- This report intentionally never updates, deletes, merges, or exposes clinical
-- history.  Each row is an independently reviewable finding.  Do not treat a
-- matching name or telephone number as evidence of a duplicate.
--
-- Resolution guidance:
--   * Preserve the oldest/authoritative identity and its history.
--   * Confirm ownership with the person before changing any account linkage.
--   * Repair a link only through the supported admin/claim workflow, then
--     rerun this report.  Do not delete a profile or resident to clear a row.

with findings as (
  -- Confirmed: an expression index normally prevents this.  It remains useful
  -- when reviewing a database restored from before that constraint was applied.
  select
    'confirmed'::text as confidence,
    'duplicate_normalized_profile_email'::text as finding,
    lower(btrim(p.email)) as subject,
    array_agg(p.id order by p.created_at) as affected_ids,
    count(*)::integer as affected_count,
    'Resolve the identities administratively; do not merge or delete records automatically.'::text as resolution
  from public.profiles p
  where nullif(btrim(p.email), '') is not null
  group by lower(btrim(p.email))
  having count(*) > 1

  union all

  -- Confirmed: a resident Auth account must map to one resident record.
  select
    'confirmed',
    'multiple_residents_for_auth_user',
    r.auth_user_id::text,
    array_agg(r.id order by r.id),
    count(*)::integer,
    'Confirm which resident record belongs to this login, preserving all historical records before any authorized correction.'
  from public.residents r
  where r.auth_user_id is not null
  group by r.auth_user_id
  having count(*) > 1

  union all

  -- Confirmed: profiles should be created by the Auth trigger and point to an
  -- existing Auth identity (the FK prevents this in a fully migrated schema).
  select
    'confirmed',
    'orphan_profile_without_auth_identity',
    p.id::text,
    array[p.id],
    1,
    'Do not recreate a second account. Verify the Auth identity and repair through an authorized migration or support procedure.'
  from public.profiles p
  left join auth.users u on u.id = p.id
  where u.id is null

  union all

  -- Confirmed: an account cannot be both a resident portal identity and a
  -- managed personnel identity.
  select
    'confirmed',
    'resident_personnel_identity_conflict',
    p.id::text,
    array[p.id],
    1,
    'Keep the existing audit and clinical history; have an administrator determine the intended account type before changing roles or links.'
  from public.profiles p
  join public.residents r on r.auth_user_id = p.id
  join public.personnel_accounts pa on pa.account_id = p.id

  union all

  -- Confirmed: staff roles must be backed by the personnel lifecycle sidecar.
  select
    'confirmed',
    'personnel_profile_missing_lifecycle_record',
    p.id::text,
    array[p.id],
    1,
    'Review lifecycle history and provision the missing lifecycle record through an authorized repair; do not create a replacement profile.'
  from public.profiles p
  left join public.personnel_accounts pa on pa.account_id = p.id
  where p.role in ('admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw')
    and pa.account_id is null

  union all

  -- Confirmed: residents may not receive personnel roles.  The record itself
  -- is reported rather than its demographic values.
  select
    'confirmed',
    'resident_linked_to_non_resident_role',
    r.auth_user_id::text,
    array[r.id],
    1,
    'Review authorization and account ownership before correcting the role. Preserve the resident and all related health history.'
  from public.residents r
  join public.profiles p on p.id = r.auth_user_id
  where p.role not in ('resident', 'resident-limited')
)
select confidence, finding, subject, affected_ids, affected_count, resolution
from findings
order by confidence, finding, subject;
