begin;

-- Files are private and served only through the authenticated API. No browser
-- storage policies: knowing an object name does not grant access to its bytes.
insert into storage.buckets (id, name, public)
values ('resident-laboratory', 'resident-laboratory', false)
on conflict (id) do update set public = false;

create table public.resident_laboratory_documents (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null references public.residents(id) on delete restrict,
  consultation_id text references public.visits(id) on delete restrict,
  category text not null check (category in ('cbc', 'urinalysis', 'fecalysis',
    'blood_chemistry', 'fasting_blood_sugar', 'lipid_profile', 'pregnancy_test',
    'ultrasound', 'xray', 'other')),
  file_name text not null check (length(file_name) between 1 and 255),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  storage_path text not null unique,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default clock_timestamp(),
  constraint laboratory_path_owner check (storage_path = resident_id || '/' || id::text || '.' ||
    case content_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' else 'png' end)
);
create index resident_laboratory_history_idx
  on public.resident_laboratory_documents (resident_id, uploaded_at desc, id);
create index resident_laboratory_consultation_idx
  on public.resident_laboratory_documents (consultation_id) where consultation_id is not null;

-- Use the resident's CURRENT assignment, including after a residency transfer.
create function public.can_read_resident_laboratory(p_resident_id text)
returns boolean language sql stable security definer set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.residents r where r.id = p_resident_id and (
    (r.auth_user_id = auth.uid() and public.profile_role() = 'resident')
    or (public.is_staff_active()
      and public.canonical_referral_has_permission(auth.uid(), 'consultation.history.view')
      and ((public.profile_role() = 'health_supervisor' and r.barangay_id = public.profile_barangay_id())
        or (public.profile_role() in ('phn', 'mho') and r.municipality_id = public.profile_municipality_id())))
  ));
$$;
revoke all on function public.can_read_resident_laboratory(text) from public, anon;
grant execute on function public.can_read_resident_laboratory(text) to authenticated, service_role;

alter table public.resident_laboratory_documents enable row level security;
revoke all on public.resident_laboratory_documents from anon, authenticated;
grant select on public.resident_laboratory_documents to authenticated;
grant all on public.resident_laboratory_documents to service_role;
create policy resident_laboratory_read on public.resident_laboratory_documents
  for select to authenticated using (public.can_read_resident_laboratory(resident_id));
create policy personnel_account_access_gate on public.resident_laboratory_documents
  as restrictive for all to authenticated
  using ((select public.personnel_session_is_usable()))
  with check ((select public.personnel_session_is_usable()));

-- Metadata and bytes are immutable; only an authorized API operation can attach
-- an existing result to an encounter for the same patient. Upload is not review.
create function public.guard_resident_laboratory_document()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare resident_row public.residents%rowtype;
begin
  select * into strict resident_row from public.residents where id = new.resident_id;
  if tg_op = 'INSERT' then
    if new.uploaded_by is distinct from resident_row.auth_user_id then
      raise exception 'Laboratory uploader must own the resident record' using errcode = '23514';
    end if;
    new.uploaded_at := clock_timestamp();
  elsif (to_jsonb(new) - 'consultation_id') is distinct from (to_jsonb(old) - 'consultation_id') then
    -- Permit only the FK's author anonymization when an account is deleted.
    if not (new.uploaded_by is null and old.uploaded_by is not null
      and not exists (select 1 from public.profiles where id = old.uploaded_by)
      and (to_jsonb(new) - array['consultation_id', 'uploaded_by'])
        = (to_jsonb(old) - array['consultation_id', 'uploaded_by'])) then
      raise exception 'Laboratory document history is immutable' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.consultation_id is not null
    and new.consultation_id is distinct from old.consultation_id then
    raise exception 'Laboratory consultation history cannot be replaced' using errcode = '23514';
  end if;
  if new.consultation_id is not null and not exists (
    select 1 from public.visits v where v.id = new.consultation_id and v.resident_id = new.resident_id
  ) then
    raise exception 'Laboratory consultation must belong to the same resident' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_resident_laboratory_document() from public, anon, authenticated;
create trigger resident_laboratory_guard before insert or update on public.resident_laboratory_documents
  for each row execute function public.guard_resident_laboratory_document();

create function public.audit_resident_laboratory_document()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  insert into public.health_audit_logs(actor_id, action, entity_type, entity_id,
    municipality_id, barangay_id, metadata)
  select case when tg_op = 'INSERT' then new.uploaded_by else auth.uid() end,
    case when tg_op = 'INSERT' then 'LABORATORY_UPLOADED' else 'LABORATORY_CONSULTATION_LINKED' end,
    'resident_laboratory_documents', new.id::text, r.municipality_id, r.barangay_id,
    jsonb_build_object('consultation_id', new.consultation_id, 'verified_clinical_finding', false)
  from public.residents r where r.id = new.resident_id;
  return new;
end;
$$;
revoke all on function public.audit_resident_laboratory_document() from public, anon, authenticated;
create trigger resident_laboratory_audit after insert on public.resident_laboratory_documents
  for each row execute function public.audit_resident_laboratory_document();

-- Staff linking and its attributed audit event commit together. This RPC is
-- server-only; actor identity has already been verified by API authentication.
create function public.link_resident_laboratory_document(p_id uuid, p_consultation_id text, p_actor_id uuid)
returns public.resident_laboratory_documents
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare doc public.resident_laboratory_documents%rowtype;
  resident_row public.residents%rowtype; actor public.profiles%rowtype;
begin
  select * into doc from public.resident_laboratory_documents where id = p_id for update;
  if not found then raise exception 'Laboratory result not found' using errcode = 'P0002'; end if;
  select * into strict resident_row from public.residents where id = doc.resident_id;
  select * into actor from public.profiles where id = p_actor_id;
  if not public.canonical_referral_has_permission(p_actor_id, 'consultation.records.update')
    or not public.canonical_referral_has_permission(p_actor_id, 'consultation.history.view')
    or not coalesce((actor.role = 'health_supervisor' and actor.barangay_id = resident_row.barangay_id
      and actor.municipality_id = resident_row.municipality_id)
      or (actor.role in ('phn', 'mho') and actor.municipality_id = resident_row.municipality_id), false) then
    raise exception 'Laboratory result access denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.visits where id = p_consultation_id and resident_id = doc.resident_id) then
    raise exception 'Consultation must belong to the same resident' using errcode = '23514';
  end if;
  if doc.consultation_id is not null and doc.consultation_id <> p_consultation_id then
    raise exception 'Laboratory result is already linked' using errcode = '23505';
  end if;
  if doc.consultation_id = p_consultation_id then return doc; end if;
  update public.resident_laboratory_documents set consultation_id = p_consultation_id
    where id = p_id returning * into doc;
  insert into public.health_audit_logs(actor_id, action, entity_type, entity_id, municipality_id, barangay_id, metadata)
  values (p_actor_id, 'LABORATORY_CONSULTATION_LINKED', 'resident_laboratory_documents', doc.id::text,
    resident_row.municipality_id, resident_row.barangay_id, jsonb_build_object('consultation_id', p_consultation_id));
  return doc;
end;
$$;
revoke all on function public.link_resident_laboratory_document(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.link_resident_laboratory_document(uuid, text, uuid) to service_role;

commit;
notify pgrst, 'reload schema';
