-- =============================================================================
-- KALUSAGAP — BUG-001 (CRITICAL): enforce medical-certificate decision authority
-- at the database layer.
--
-- PROBLEM: medical_certificates_update (20260928150100) required only
--   is_admin() OR (is_staff_active() AND profile_covers_barangay(barangay_id))
-- for both USING and WITH CHECK, with NO guard on the decision columns
-- (status / reviewed_by / reviewed_at / review_remarks / date_issued). Any
-- active staff user in the barangay (rhu_personnel, health_supervisor, phn, …)
-- holding a valid authenticated JWT could PATCH a certificate directly via
-- PostgREST and set status = 'Approved' / 'Issued', bypassing the MHO-only rule
-- that existed ONLY in medicalCertificates.service.js.
--
-- FIX: a decision-aware BEFORE UPDATE trigger (compares OLD vs NEW) that
-- mirrors the backend service exactly:
--   * any change to a decision column requires review authority (PHN or MHO)
--     via public.can_review_medical_certificates();
--   * moving a certificate INTO 'Approved' requires the MHO specifically.
--
-- The trigger follows the same convention as public.guard_profile_updates():
-- it only constrains real end-user (authenticated JWT) writes — auth.uid() is
-- null for the service-role backend, which has already run its own
-- authenticate + authorize checks and legitimately performs the write. RLS and
-- this trigger are the boundary for any direct, user-token PostgREST access.
--
-- Non-decision edits (findings, purpose, remarks, notes, medical_officer, …)
-- performed by legitimate in-scope staff continue to work unchanged.
--
-- Idempotent: safe to re-run.
-- =============================================================================

begin;

create or replace function public.enforce_medical_certificate_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decision_changed boolean;
begin
  -- Service-role / trusted backend context: the Express service layer already
  -- enforced the MHO-only rule before issuing this write. RLS + this trigger
  -- exist to constrain DIRECT authenticated PostgREST calls, which always carry
  -- a real auth.uid(). Mirrors guard_profile_updates()'s auth.uid() gate.
  if auth.uid() is null then
    return new;
  end if;

  v_decision_changed :=
        (new.status is distinct from old.status
          and new.status in ('Approved', 'Issued', 'Rejected'))
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.review_remarks is distinct from old.review_remarks
     or new.date_issued is distinct from old.date_issued;

  if v_decision_changed then
    -- Decision columns may only be touched by the PHN or the MHO.
    if not public.can_review_medical_certificates() then
      raise exception
        'medical_certificates: only the PHN or MHO may record an approval/issuance/rejection decision'
        using errcode = '42501';
    end if;

    -- Approval is the MHO signatory step. A PHN reviewing a certificate may
    -- submit it, reject it or issue an already-approved one, but only the MHO
    -- may move it into 'Approved'. Because 'Issued' is reachable only FROM
    -- 'Approved' (ALLOWED_TRANSITIONS), a certificate can never be issued
    -- without a real MHO approval already on record.
    if new.status = 'Approved' and old.status is distinct from 'Approved'
       and public.profile_role() <> 'mho' then
      raise exception
        'medical_certificates: only the Municipal Health Officer may approve a medical certificate'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.enforce_medical_certificate_decision() is
  'BUG-001: DB-layer guard so only PHN/MHO can change certificate decision columns and only the MHO can approve. Skips the service-role backend (auth.uid() is null).';

drop trigger if exists medical_certificates_decision_guard on public.medical_certificates;
create trigger medical_certificates_decision_guard
  before update on public.medical_certificates
  for each row execute function public.enforce_medical_certificate_decision();

commit;
