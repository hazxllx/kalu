begin;

alter table public.medical_certificates
  add column if not exists signatory_position text not null default '',
  add column if not exists issued_at timestamptz,
  add column if not exists issued_by uuid references public.profiles(id) on delete set null;

update public.medical_certificates
set issued_at = date_issued::timestamptz,
    issued_by = coalesce(issued_by, reviewed_by)
where status = 'Issued'
  and issued_at is null;

create unique index if not exists medical_certificates_certificate_number_uidx
  on public.medical_certificates (certificate_number)
  where nullif(btrim(certificate_number), '') is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.medical_certificates'::regclass
      and conname = 'medical_certificates_review_decision_fields_check'
  ) then
    alter table public.medical_certificates
      add constraint medical_certificates_review_decision_fields_check
      check (
        status not in ('Approved', 'Rejected')
        or (reviewed_by is not null and reviewed_at is not null)
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.medical_certificates'::regclass
      and conname = 'medical_certificates_rejection_reason_check'
  ) then
    alter table public.medical_certificates
      add constraint medical_certificates_rejection_reason_check
      check (status <> 'Rejected' or nullif(btrim(review_remarks), '') is not null) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.medical_certificates'::regclass
      and conname = 'medical_certificates_issuance_fields_check'
  ) then
    alter table public.medical_certificates
      add constraint medical_certificates_issuance_fields_check
      check (
        status <> 'Issued'
        or (date_issued is not null and issued_at is not null
          and issued_by is not null and reviewed_by is not null and reviewed_at is not null)
      ) not valid;
  end if;
end;
$$;

comment on column public.medical_certificates.issued_at is
  'Timestamp when the certificate became official; distinct from the legacy date-only date_issued field.';
comment on column public.medical_certificates.issued_by is
  'Authenticated PHN or MHO account that finalized issuance.';

create or replace function public.enforce_medical_certificate_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_decision_changed boolean;
  v_document_changed boolean;
  v_signatory record;
begin
  -- The Express service uses the service-role client only after authenticating
  -- the request and enforcing role + municipality scope.
  if auth.uid() is null then
    return new;
  end if;

  v_role := public.profile_role();

  if tg_op = 'INSERT' then
    if not public.is_staff_active()
       or v_role not in ('mho', 'phn', 'rhu_personnel')
       or new.created_by is distinct from auth.uid() then
      raise exception 'medical_certificates: unauthorized certificate creator'
        using errcode = '42501';
    end if;

    if (v_role = 'rhu_personnel' and new.status is distinct from 'For Review')
       or (v_role in ('mho', 'phn') and new.status not in ('Draft', 'For Review')) then
      raise exception 'medical_certificates: a new certificate must be a draft or pending review'
        using errcode = '42501';
    end if;

    if new.reviewed_by is not null
       or new.reviewed_at is not null
       or coalesce(new.review_remarks, '') <> ''
       or new.date_issued is not null
       or new.issued_at is not null
       or new.issued_by is not null then
      raise exception 'medical_certificates: decisions and issuance cannot be set on insert'
        using errcode = '42501';
    end if;

    return new;
  end if;

  v_document_changed :=
       row(new.reference_no, new.resident_id, new.purpose, new.findings,
           new.date_of_examination, new.medical_officer, new.license_number,
           new.signatory_position, new.certificate_number, new.civil_status,
           new.recommendation, new.notes, new.remarks)
       is distinct from
       row(old.reference_no, old.resident_id, old.purpose, old.findings,
           old.date_of_examination, old.medical_officer, old.license_number,
           old.signatory_position, old.certificate_number, old.civil_status,
           old.recommendation, old.notes, old.remarks);

  if v_document_changed and old.status in ('Approved', 'Issued', 'Rejected', 'Cancelled') then
    raise exception 'medical_certificates: finalized certificate details are immutable'
      using errcode = '42501';
  end if;

  v_decision_changed :=
       new.status is distinct from old.status
    or new.reviewed_by is distinct from old.reviewed_by
    or new.reviewed_at is distinct from old.reviewed_at
    or new.review_remarks is distinct from old.review_remarks
    or new.date_issued is distinct from old.date_issued
    or new.issued_at is distinct from old.issued_at
    or new.issued_by is distinct from old.issued_by;

  if v_decision_changed then
    if not public.can_review_medical_certificates() then
      raise exception 'medical_certificates: only an active in-scope PHN or MHO may decide'
        using errcode = '42501';
    end if;

    if new.status is not distinct from old.status then
      raise exception 'medical_certificates: review decisions cannot be rewritten'
        using errcode = '42501';
    end if;

    if not (
      (old.status = 'Draft' and new.status in ('For Review', 'Cancelled'))
      or (old.status = 'For Review' and new.status in ('Approved', 'Issued', 'Rejected', 'Cancelled'))
      or (old.status = 'Approved' and new.status in ('Issued', 'Cancelled'))
    ) then
      raise exception 'medical_certificates: invalid status transition from % to %', old.status, new.status
        using errcode = '23514';
    end if;

    if new.status in ('For Review', 'Cancelled')
       and (new.reviewed_by is distinct from old.reviewed_by
         or new.reviewed_at is distinct from old.reviewed_at
         or new.review_remarks is distinct from old.review_remarks) then
      raise exception 'medical_certificates: a non-decision transition cannot change review fields'
        using errcode = '42501';
    end if;

    if new.status in ('Approved', 'Rejected')
       or (new.status = 'Issued' and old.status = 'For Review') then
      if new.status = 'Rejected' and nullif(btrim(new.review_remarks), '') is null then
        raise exception 'medical_certificates: a rejection reason is required'
          using errcode = '23514';
      end if;

      new.reviewed_by := auth.uid();
      new.reviewed_at := now();

      select full_name, position, license_no
      into v_signatory
      from public.profiles
      where id = auth.uid();

      new.medical_officer := coalesce(v_signatory.full_name, '');
      new.license_number := coalesce(v_signatory.license_no, '');
      new.signatory_position := coalesce(
        nullif(v_signatory.position, ''),
        case when v_role = 'mho' then 'Municipal Health Officer' else 'Public Health Nurse' end
      );
    end if;

    if new.status = 'Issued' then
      if old.status = 'Approved'
         and (old.reviewed_by is null or old.reviewed_at is null) then
        raise exception 'medical_certificates: an approved certificate must have a recorded reviewer'
          using errcode = '23514';
      elsif old.status = 'Approved'
         and (new.reviewed_by is distinct from old.reviewed_by
           or new.reviewed_at is distinct from old.reviewed_at
           or new.review_remarks is distinct from old.review_remarks) then
        raise exception 'medical_certificates: issuance cannot replace the recorded approval'
          using errcode = '42501';
      end if;
      new.issued_by := auth.uid();
      new.issued_at := now();
      new.date_issued := current_date;
    elsif new.issued_by is distinct from old.issued_by
       or new.issued_at is distinct from old.issued_at
       or new.date_issued is distinct from old.date_issued then
      raise exception 'medical_certificates: issuance fields may only be set when issuing'
        using errcode = '42501';
    end if;

    insert into public.medical_certificate_logs
      (certificate_id, actor_id, action, previous_status, new_status, notes)
    values
      (new.id, auth.uid(),
       case when new.status = 'Issued' and old.status = 'For Review' then 'Approved and Issued' else new.status end,
       old.status, new.status, coalesce(new.review_remarks, ''));
  end if;

  return new;
end;
$$;

create or replace function public.log_medical_certificate_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    insert into public.medical_certificate_logs
      (certificate_id, actor_id, action, previous_status, new_status, notes)
    values
      (new.id, auth.uid(), new.status, null, new.status,
       case when new.status = 'For Review' then 'Certificate request submitted for review' else 'Certificate created' end);
  end if;
  return new;
end;
$$;

comment on function public.enforce_medical_certificate_workflow() is
  'Protects certificate creation, scoped PHN/MHO review decisions, immutable finalized documents, and one-time issuance for direct authenticated PostgREST writes.';

drop trigger if exists medical_certificates_triage_request_guard on public.medical_certificates;
drop trigger if exists medical_certificates_decision_guard on public.medical_certificates;
drop trigger if exists medical_certificates_workflow_guard on public.medical_certificates;
create trigger medical_certificates_workflow_guard
  before insert or update on public.medical_certificates
  for each row execute function public.enforce_medical_certificate_workflow();
drop trigger if exists medical_certificates_creation_history on public.medical_certificates;
create trigger medical_certificates_creation_history
  after insert on public.medical_certificates
  for each row execute function public.log_medical_certificate_creation();

drop policy if exists medical_certificates_insert on public.medical_certificates;
create policy medical_certificates_insert on public.medical_certificates
  for insert to authenticated
  with check (
    public.is_staff_active()
    and public.profile_role() in ('mho', 'phn', 'rhu_personnel')
    and public.profile_covers_barangay(barangay_id)
    and created_by = auth.uid()
  );

drop policy if exists medical_certificates_update on public.medical_certificates;
create policy medical_certificates_update on public.medical_certificates
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('mho', 'phn')
      and public.profile_covers_barangay(barangay_id)
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('mho', 'phn')
      and public.profile_covers_barangay(barangay_id)
    )
  );

commit;
