-- supabase/migrations/20261121150000_atomic_transfer_approval_notification.sql
-- Keep the established approval RPC, identity checks and geography snapshots intact.
begin;

create unique index notifications_transfer_approval_once
  on public.notifications(recipient_id, related_id)
  where related_type = 'transfer_request_approved';

create or replace function public.notify_transfer_approval()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  insert into public.notifications(recipient_id, category, title, message, related_type, related_id)
  values (new.auth_user_id, 'information', 'Residency transfer approved',
    'Your residency transfer request has been approved. Your current barangay has been updated and your existing health record remains associated with your account.',
    'transfer_request_approved', new.id::text)
  on conflict (recipient_id, related_id) where related_type = 'transfer_request_approved' do nothing;
  return new;
end;
$$;

revoke all on function public.notify_transfer_approval() from public, anon, authenticated;
grant execute on function public.notify_transfer_approval() to service_role;

create trigger transfer_approval_notification
after update of status on public.transfer_requests
for each row when (old.status in ('pending', 'under_review') and new.status = 'approved')
execute function public.notify_transfer_approval();

-- Serialize evidence writes with submission/approval so a stale draft upload or
-- deletion cannot alter evidence once the request has entered review. Review
-- metadata remains writable by the existing authorized verification workflow.
create or replace function public.guard_transfer_document_evidence()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  old_request uuid;
  new_request uuid;
  request_row record;
begin
  if tg_op <> 'INSERT' then old_request := old.transfer_request_id; end if;
  if tg_op <> 'DELETE' then new_request := new.transfer_request_id; end if;
  if old_request is null and new_request is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and row(new.transfer_request_id, new.resident_id, new.application_id,
    new.document_type, new.purpose, new.file_name, new.storage_path, new.mime_type, new.size_bytes)
    is not distinct from row(old.transfer_request_id, old.resident_id, old.application_id,
    old.document_type, old.purpose, old.file_name, old.storage_path, old.mime_type, old.size_bytes) then
    return new;
  end if;
  for request_row in select id, status from public.transfer_requests
    where id in (old_request, new_request) order by id for update
  loop
    if request_row.status not in ('draft', 'resubmission_required') then
      raise exception using errcode = '55000', message = 'Submitted transfer documents are read-only until corrections are requested.';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.guard_transfer_document_evidence() from public, anon, authenticated;
grant execute on function public.guard_transfer_document_evidence() to service_role;
create trigger transfer_document_evidence_guard
before insert or update or delete on public.documents
for each row execute function public.guard_transfer_document_evidence();

commit;
notify pgrst, 'reload schema';
