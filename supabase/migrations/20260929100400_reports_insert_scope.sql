-- =============================================================================
-- KALUSAGAP — BUG-013: reports INSERT must bind sender municipality/barangay
--
-- reports_insert only checked created_by = auth.uid() and profile_role() =
-- sender_role, so a direct PostgREST insert with a valid staff token could set
-- municipality_id (and barangay_id) to ANOTHER municipality/barangay and inject
-- a report into that queue. The backend already derives these from the session
-- (reports.service.js), but RLS must independently enforce the same binding.
--
-- Fix: WITH CHECK now pins municipality_id to the caller's own municipality and
-- barangay_id to the caller's own barangay (Health Supervisor) or NULL
-- (municipality-wide senders).
--
-- Idempotent: safe to re-run.
-- =============================================================================

begin;

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated
  with check (
    public.is_staff_active()
    and created_by = auth.uid()
    and public.profile_role() = sender_role
    -- BUG-013: municipality is bound to the sender's own profile.
    and municipality_id = public.profile_municipality_id()
    -- Barangay is the sender's own barangay (Health Supervisor) or NULL.
    and (
      (public.profile_role() = 'health_supervisor' and barangay_id = public.profile_barangay_id())
      or (public.profile_role() <> 'health_supervisor' and barangay_id is null)
    )
  );

commit;
