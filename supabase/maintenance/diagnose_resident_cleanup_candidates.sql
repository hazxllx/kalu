-- Read-only diagnostic. Run this in the same Supabase project where the
-- candidate and linked-history previews were run.

with reviewed_ids(id) as (
  values
    ('RES-000007'),('RES-000008'),('RES-000009'),('RES-000010'),('RES-000011'),('RES-000012'),
    ('RES-000013'),('RES-000014'),('RES-000015'),('RES-000016'),('RES-000017'),('RES-000018'),
    ('RES-000019'),('RES-000020'),('RES-000021'),('RES-000022'),('RES-000023'),('RES-000040'),
    ('RES-000047'),('RES-000050'),('RES-000054'),('RES-000055'),('RES-000056'),('RES-000057'),
    ('RES-000058'),('RES-000062')
)
select ids.id as reviewed_resident_id,
       current_database() as database_name,
       current_schema() as schema_name,
       r.id is not null as resident_row_exists,
       r.health_record_no,
       r.created_by_role,
       r.auth_user_id,
       r.verification_status,
       r.barangay,
       r.created_at,
       (r.auth_user_id is null and lower(trim(coalesce(r.created_by_role, ''))) in ('resident', 'resident-limited')) as still_matches_cleanup_rule
from reviewed_ids ids
left join public.residents r on r.id = ids.id
order by ids.id;
