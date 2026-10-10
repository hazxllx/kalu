-- =============================================================================
-- KALUSAGAP — Medical certificate REQUEST initiation by RHU Triage personnel
--
-- Revised workflow:
--
--   Triage Personnel -> Medical Certificate Request -> PHN or MHO Review
--                                                        -> Issue / Reject / Return
--
-- Triage personnel may INITIATE a request, but can never approve/issue/reject a
-- certificate. This supersedes the earlier blanket denial of RHU personnel
-- (20260930102000_medical_certificate_rhu_denial.sql) with a narrower rule:
--
--   * SELECT: RHU personnel may read certificates in their own municipality.
--   * INSERT: RHU personnel may create a certificate ONLY as a request
--     (status 'For Review', no decision/signatory fields). A BEFORE INSERT
--     guard rejects any other status or decision column from a user token.
--   * UPDATE: RHU personnel remain DENIED at the RLS layer, so a direct
--     PostgREST call cannot move a request to Approved/Issued. The existing
--     decision guard (20260929100000) already limits decision columns to
--     PHN/MHO for any other staff.
--
-- Additive + idempotent.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Guard: a Triage-initiated certificate is a REQUEST only
-- ---------------------------------------------------------------------------
create or replace function public.enforce_triage_certificate_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-role backend has its own authorization; only constrain direct
  -- authenticated user-token writes.
  if auth.uid() is null then
    return new;
  end if;
  if public.profile_role() = 'rhu_personnel' then
    if new.status is distinct from 'For Review' then
      raise exception
        'medical_certificates: triage personnel may only submit a certificate REQUEST (status ''For Review'')'
        using errcode = '42501';
    end if;
    if new.reviewed_by is not null
       or new.reviewed_at is not null
       or new.date_issued is not null
       or coalesce(new.review_remarks, '') <> '' then
      raise exception
        'medical_certificates: triage personnel cannot record a certificate decision'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.enforce_triage_certificate_request() is
  'Triage personnel may only INSERT a certificate request (For Review), never a decision/signatory field.';

drop trigger if exists medical_certificates_triage_request_guard on public.medical_certificates;
create trigger medical_certificates_triage_request_guard
  before insert on public.medical_certificates
  for each row execute function public.enforce_triage_certificate_request();

-- ---------------------------------------------------------------------------
-- RLS: allow RHU personnel to read + create requests in their municipality;
-- keep UPDATE denied for them.
-- ---------------------------------------------------------------------------
drop policy if exists medical_certificates_select on public.medical_certificates;
create policy medical_certificates_select on public.medical_certificates
  for select to authenticated
  using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() = 'health_supervisor' and barangay_id = public.profile_barangay_id())
      )
    ) or exists (
      select 1 from public.residents r
      where r.id = medical_certificates.resident_id and r.auth_user_id = auth.uid()
    )
  );

drop policy if exists medical_certificates_insert on public.medical_certificates;
create policy medical_certificates_insert on public.medical_certificates
  for insert to authenticated
  with check (
    public.is_staff_active()
    and public.profile_covers_barangay(barangay_id)
  );

drop policy if exists medical_certificates_update on public.medical_certificates;
create policy medical_certificates_update on public.medical_certificates
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() <> 'rhu_personnel'
      and public.profile_covers_barangay(barangay_id)
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() <> 'rhu_personnel'
      and public.profile_covers_barangay(barangay_id)
    )
  );

drop policy if exists medical_certificate_logs_select on public.medical_certificate_logs;
create policy medical_certificate_logs_select on public.medical_certificate_logs
  for select to authenticated
  using (
    public.is_admin() or (
      public.is_staff_active() and exists (
        select 1 from public.medical_certificates mc
        where mc.id = medical_certificate_logs.certificate_id
          and (
            (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and mc.municipality_id = public.profile_municipality_id())
            or (public.profile_role() = 'health_supervisor' and mc.barangay_id = public.profile_barangay_id())
          )
      )
    ) or exists (
      select 1
      from public.medical_certificates mc
      join public.residents r on r.id = mc.resident_id
      where mc.id = medical_certificate_logs.certificate_id and r.auth_user_id = auth.uid()
    )
  );

commit;
