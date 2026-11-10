-- Read-only export to preserve the Storage object paths before deleting the
-- matching residents. Save the result as CSV; remove the objects through the
-- Supabase Storage API after the SQL cleanup succeeds.
with candidates as (
  select r.id
  from public.residents r
  where r.auth_user_id is null
    and lower(trim(coalesce(r.created_by_role, ''))) in ('resident', 'resident-limited')
), candidate_transfers as (
  select tr.id
  from public.transfer_requests tr
  join candidates c on c.id = tr.resident_id or c.id = tr.target_resident_id
)
select distinct d.storage_path
from public.documents d
where d.resident_id in (select id from candidates)
   or d.transfer_request_id in (select id from candidate_transfers)
order by d.storage_path;
