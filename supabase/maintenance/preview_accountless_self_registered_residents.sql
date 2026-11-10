-- Read-only preview for the cleanup requested by the project owner.
-- It selects only residents created by resident self-registration whose Auth
-- account has since been deleted. Staff-created residents and residents with
-- an existing (including deactivated) Auth account are excluded.
-- Run this SELECT first and review the returned IDs before any deletion.

select
  r.id as resident_id,
  r.health_record_no,
  concat_ws(' ', nullif(r.first_name, ''), nullif(r.middle_name, ''),
            nullif(r.last_name, ''), nullif(r.suffix, '')) as resident_name,
  r.created_by_role,
  r.verification_status,
  r.auth_user_id,
  r.barangay,
  r.created_at
from public.residents r
where r.auth_user_id is null
  and lower(trim(coalesce(r.created_by_role, ''))) in ('resident', 'resident-limited')
order by r.created_at, r.id;
