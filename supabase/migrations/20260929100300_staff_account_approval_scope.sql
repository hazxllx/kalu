-- =============================================================================
-- KALUSAGAP — BUG-006: staff account approval must be municipality/barangay
-- scoped, not role-only.
--
-- staff_account_requests_select / _update relied solely on
-- public.can_approve_staff_role(role), so a Health Supervisor could approve or
-- reject a request from ANY barangay, and a PHN from any municipality, as long
-- as the requested ROLE matched. This adds the coverage scope the approver
-- actually has:
--   PHN               -> requests in their own municipality
--   Health Supervisor -> requests in their own assigned barangay
-- Mirrors the API-layer scope added in staffAccounts.service.js.
--
-- Idempotent: safe to re-run.
-- =============================================================================

begin;

-- Whether the caller may approve this request's role AND is within scope for it.
create or replace function public.can_approve_staff_request(
  target_role public.app_role,
  target_municipality uuid,
  target_barangay uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_approve_staff_role(target_role)
    and case
      when public.profile_role() = 'phn'
        then target_municipality is not distinct from public.profile_municipality_id()
      when public.profile_role() = 'health_supervisor'
        then target_barangay is not distinct from public.profile_barangay_id()
      else false
    end;
$$;

comment on function public.can_approve_staff_request(public.app_role, uuid, uuid) is
  'BUG-006: role authority + coverage scope. PHN is municipality-scoped, Health Supervisor barangay-scoped.';

drop policy if exists staff_account_requests_select on public.staff_account_requests;
create policy staff_account_requests_select
  on public.staff_account_requests
  for select to authenticated
  using (
    public.is_admin()
    or public.can_approve_staff_request(role, municipality_id, barangay_id)
  );

drop policy if exists staff_account_requests_update on public.staff_account_requests;
create policy staff_account_requests_update
  on public.staff_account_requests
  for update to authenticated
  using (public.can_approve_staff_request(role, municipality_id, barangay_id))
  with check (public.can_approve_staff_request(role, municipality_id, barangay_id));

commit;
