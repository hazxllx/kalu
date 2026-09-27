-- KALUSAGAP — Transfer of Residency = change of the EXISTING resident's barangay
--
-- Reframes the transfer workflow. A transfer is NOT a new resident registration
-- and NOT an account-claim: the resident already exists and is already linked to
-- the signed-in account (residents.auth_user_id). A transfer only changes the
-- resident's CURRENT barangay after approval. The same resident id, the same
-- auth link and ALL existing health records (visits, referrals, follow-ups, …)
-- stay attached to that one resident row throughout every transfer.
--
-- This migration:
--   * adds the transfer's own columns (which resident, from/to barangay, reason),
--   * adds a 'draft' status so documents can attach before the request is
--     submitted for review (only 'pending'/'under_review' block a new request),
--   * replaces approve_transfer_request() so approval UPDATES the resident's
--     barangay instead of claiming an unlinked record. Health history is never
--     copied or duplicated — it is already keyed on the unchanged resident id.

begin;

-- ---------------------------------------------------------------------------
-- Transfer request columns for the change-of-barangay model
-- ---------------------------------------------------------------------------

alter table public.transfer_requests
  add column if not exists resident_id text references public.residents(id) on delete restrict,
  add column if not exists from_barangay_id uuid references public.barangays(id) on delete set null,
  add column if not exists to_barangay_id uuid references public.barangays(id) on delete set null,
  add column if not exists reason text not null default '';

create index if not exists transfer_requests_resident_idx
  on public.transfer_requests(resident_id, created_at desc);

-- Allow a 'draft' state: a request being assembled (destination chosen,
-- documents uploaded) that has NOT yet been submitted for review. A draft never
-- counts as an active/pending request, so it never blocks the resident. Only
-- 'pending'/'under_review' are treated as an open request.
alter table public.transfer_requests
  drop constraint if exists transfer_requests_status_check;
alter table public.transfer_requests
  add constraint transfer_requests_status_check
  check (status in ('draft', 'pending', 'under_review', 'approved', 'rejected', 'cancelled'));

-- ---------------------------------------------------------------------------
-- Approval: change ONLY the resident's current barangay (transactional)
-- ---------------------------------------------------------------------------
-- Replaces the old account-claim implementation. On approval:
--   1. the resident's barangay is updated to the requested destination
--      (residents_sync_scope keeps the free-text barangay + municipality in
--       sync from the barangay_id),
--   2. the transfer request is marked approved.
-- The resident id and auth_user_id are untouched, and no health record is
-- read, copied or deleted here — history stays keyed on the same resident id.
create or replace function public.approve_transfer_request(p_request_id uuid, p_reviewer_id uuid)
returns public.transfer_requests
language plpgsql security definer set search_path = public
as $$
declare request_row public.transfer_requests;
begin
  select * into request_row from public.transfer_requests where id = p_request_id for update;
  if not found or request_row.status not in ('pending', 'under_review') then
    return null;
  end if;
  if request_row.resident_id is null or request_row.to_barangay_id is null then
    return null;
  end if;

  -- Change the resident's current residency. Same resident id, same account
  -- link, same health records.
  update public.residents
    set barangay_id = request_row.to_barangay_id, updated_at = now()
    where id = request_row.resident_id;
  if not found then
    return null;
  end if;

  update public.transfer_requests
    set status = 'approved', reviewed_by = p_reviewer_id, reviewed_at = now(), updated_at = now()
    where id = p_request_id
    returning * into request_row;
  return request_row;
end; $$;

-- Retire the old three-argument (account-claim) signature.
drop function if exists public.approve_transfer_request(uuid, uuid, text);

revoke execute on function public.approve_transfer_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_transfer_request(uuid, uuid) to service_role;

commit;
