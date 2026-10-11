-- =============================================================================
-- KALUSAGAP — Resident transfer: resubmission state + complete reassignment
--
-- Extends the existing change-of-barangay transfer workflow
-- (20260928120000_transfer_change_of_barangay.sql) with:
--
--   1. A 'resubmission_required' status so the authorized receiving Health
--      Supervisor can return a request to the resident for corrections with
--      written instructions. The request history and uploaded documents are
--      preserved; the resident resubmits the SAME request (it returns to
--      'pending'). A new `resubmission_instructions` column carries the
--      reviewer's explanation to the resident.
--
--   2. A hardened approve_transfer_request() that performs the FULL, atomic
--      barangay reassignment — not just the resident's barangay_id:
--        * records the resident's actual previous barangay on the request
--          (durable transfer history: from -> to, approver, timestamp),
--        * re-points the resident's operational/clinical records (visits,
--          referrals, follow-ups, TCL, maternal, immunizations) to the new
--          barangay via their existing *_sync_scope triggers, so the old
--          barangay loses access through ordinary queries and the receiving
--          barangay gains it — WITHOUT copying, duplicating or deleting any
--          medical history (every row stays keyed on the unchanged resident id),
--        * unlinks the resident from OLD-barangay household memberships so the
--          resident no longer appears in the old barangay's Resident Directory
--          (which unions verified-household members). The household census rows
--          themselves are preserved; only the resident link is cleared.
--      The resident id and auth_user_id are never changed, and the Health
--      Record Number is untouched.
--
-- Idempotent and transactional. Safe to re-run.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Resubmission state + reviewer instructions
-- ---------------------------------------------------------------------------

alter table public.transfer_requests
  add column if not exists resubmission_instructions text not null default '';

alter table public.transfer_requests
  drop constraint if exists transfer_requests_status_check;
alter table public.transfer_requests
  add constraint transfer_requests_status_check
  check (status in (
    'draft', 'pending', 'under_review', 'resubmission_required',
    'approved', 'rejected', 'cancelled'
  ));

-- The OTP column hardening (20260929130000) revoked table-wide SELECT from
-- `authenticated` and re-granted only the non-secret columns. The new
-- non-secret column must be granted the same way so a direct authenticated
-- PostgREST read of a resident's OWN row (RLS-scoped) can see the instructions.
-- The service-role backend bypasses column grants and is unaffected.
grant select (resubmission_instructions) on public.transfer_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Approval = full, atomic barangay reassignment
-- ---------------------------------------------------------------------------
-- Replaces the 2-arg approve_transfer_request() from
-- 20260928120000_transfer_change_of_barangay.sql. Same signature + same
-- service_role-only grant, so the repository call is unchanged.
create or replace function public.approve_transfer_request(p_request_id uuid, p_reviewer_id uuid)
returns public.transfer_requests
language plpgsql security definer set search_path = public
as $$
declare
  request_row public.transfer_requests;
  v_resident  text;
  v_from      uuid;
  v_to        uuid;
begin
  -- Lock the request so two concurrent approvals cannot both proceed.
  select * into request_row from public.transfer_requests where id = p_request_id for update;
  if not found or request_row.status not in ('pending', 'under_review') then
    return null;
  end if;
  if request_row.resident_id is null or request_row.to_barangay_id is null then
    return null;
  end if;

  v_resident := request_row.resident_id;
  v_to := request_row.to_barangay_id;

  -- Capture the resident's ACTUAL current barangay (the authoritative previous
  -- barangay) and lock the resident row against a concurrent transfer.
  select barangay_id into v_from from public.residents where id = v_resident for update;
  if not found then
    return null;
  end if;

  -- Already in the destination barangay: nothing to move, but still finalize
  -- the request so it is not left pending forever.
  if v_from is not distinct from v_to then
    update public.transfer_requests
      set status = 'approved',
          from_barangay_id = v_from,
          reviewed_by = p_reviewer_id,
          reviewed_at = now(),
          updated_at = now()
      where id = p_request_id
      returning * into request_row;
    return request_row;
  end if;

  -- (a) Change the resident's current residency. Same resident id, same account
  --     link, same Health Record Number, same medical history.
  update public.residents
    set barangay_id = v_to, updated_at = now()
    where id = v_resident;

  -- (b) Re-point the resident's operational/clinical records to the new
  --     barangay. Each table carries a before-insert/update *_sync_scope
  --     trigger that derives barangay_id + municipality_id FROM the resident,
  --     so touching the rows (now that the resident is updated) moves access to
  --     the receiving barangay. No row is copied or deleted.
  update public.visits           set updated_at = now() where resident_id = v_resident;
  update public.referrals        set updated_at = now() where resident_id = v_resident;
  update public.follow_ups       set updated_at = now() where resident_id = v_resident;
  update public.tcl_entries      set updated_at = now() where resident_id = v_resident;
  update public.maternal_records set updated_at = now() where resident_id = v_resident;
  update public.immunizations    set updated_at = now() where resident_id = v_resident;

  -- (c) Unlink the resident from OLD-barangay household memberships so they
  --     disappear from the old barangay's Resident Directory (which unions
  --     verified-household members). The household member row itself is kept
  --     (census integrity); only the resident link is cleared.
  update public.household_members
    set resident_id = null, updated_at = now()
    where resident_id = v_resident
      and household_id in (select id from public.households where barangay_id = v_from);

  -- (d) Mark the request approved and record the durable transfer history
  --     (previous barangay, destination, approver, timestamp).
  update public.transfer_requests
    set status = 'approved',
        from_barangay_id = v_from,
        reviewed_by = p_reviewer_id,
        reviewed_at = now(),
        updated_at = now()
    where id = p_request_id
    returning * into request_row;

  return request_row;
end; $$;

revoke execute on function public.approve_transfer_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_transfer_request(uuid, uuid) to service_role;

commit;
