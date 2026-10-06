begin;

create table public.official_logos (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references public.municipalities(id) on delete restrict,
  logo_type text not null check (logo_type in ('municipal', 'rhu')),
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg')),
  file_size integer not null check (file_size > 0 and file_size <= 5242880),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint official_logos_one_active_type_per_municipality unique (municipality_id, logo_type),
  constraint official_logos_storage_scope check (
    storage_path like ('official-logos/' || municipality_id::text || '/' || logo_type || '/%')
  )
);

create trigger official_logos_set_updated_at
  before update on public.official_logos
  for each row execute function public.set_updated_at();

alter table public.official_logos enable row level security;
revoke all on public.official_logos from public, anon, authenticated;
grant select, insert, update, delete on public.official_logos to service_role;

comment on table public.official_logos is
  'Private, municipality-scoped official document logo configuration. Access is mediated by the authenticated backend.';

create or replace function public.save_official_logo(
  p_municipality_id uuid,
  p_logo_type text,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_file_size integer,
  p_uploaded_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous_path text;
  v_saved public.official_logos%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_municipality_id::text || ':' || p_logo_type, 0));

  select storage_path into v_previous_path
  from public.official_logos
  where municipality_id = p_municipality_id and logo_type = p_logo_type
  for update;

  insert into public.official_logos (
    municipality_id, logo_type, storage_path, original_filename, mime_type, file_size, uploaded_by
  ) values (
    p_municipality_id, p_logo_type, p_storage_path, p_original_filename, p_mime_type, p_file_size, p_uploaded_by
  )
  on conflict (municipality_id, logo_type) do update
    set storage_path = excluded.storage_path,
        original_filename = excluded.original_filename,
        mime_type = excluded.mime_type,
        file_size = excluded.file_size,
        uploaded_by = excluded.uploaded_by
  returning * into v_saved;

  insert into public.health_audit_logs (
    actor_id, action, entity_type, entity_id, municipality_id, barangay_id, metadata
  ) values (
    p_uploaded_by,
    case when v_previous_path is null then 'OFFICIAL_LOGO_UPLOADED' else 'OFFICIAL_LOGO_REPLACED' end,
    'official_logo',
    p_logo_type,
    p_municipality_id,
    null,
    jsonb_build_object(
      'result', 'success',
      'logo_type', p_logo_type,
      'original_filename', p_original_filename,
      'mime_type', p_mime_type,
      'file_size', p_file_size
    )
  );

  return jsonb_build_object(
    'previousStoragePath', v_previous_path,
    'logo', to_jsonb(v_saved)
  );
end;
$$;

create or replace function public.remove_official_logo(
  p_municipality_id uuid,
  p_logo_type text,
  p_uploaded_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_removed public.official_logos%rowtype;
begin
  delete from public.official_logos
  where municipality_id = p_municipality_id and logo_type = p_logo_type
  returning * into v_removed;

  if not found then
    return null;
  end if;

  insert into public.health_audit_logs (
    actor_id, action, entity_type, entity_id, municipality_id, barangay_id, metadata
  ) values (
    p_uploaded_by,
    'OFFICIAL_LOGO_REMOVED',
    'official_logo',
    p_logo_type,
    p_municipality_id,
    null,
    jsonb_build_object(
      'result', 'success',
      'logo_type', p_logo_type,
      'original_filename', v_removed.original_filename
    )
  );

  return jsonb_build_object('storagePath', v_removed.storage_path);
end;
$$;

revoke all on function public.save_official_logo(uuid, text, text, text, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.remove_official_logo(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.save_official_logo(uuid, text, text, text, text, integer, uuid) to service_role;
grant execute on function public.remove_official_logo(uuid, text, uuid) to service_role;

-- The documents bucket stays private. Deny direct authenticated/anonymous
-- access to its official-logo namespace even if a future permissive policy is
-- added for other document paths. The backend uses the service role and signed
-- URLs only after applying application role and municipality checks.
create policy official_logos_no_direct_read
  on storage.objects as restrictive for select to anon, authenticated
  using (bucket_id <> 'documents' or name not like 'official-logos/%');

create policy official_logos_no_direct_insert
  on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'documents' or name not like 'official-logos/%');

create policy official_logos_no_direct_update
  on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'documents' or name not like 'official-logos/%')
  with check (bucket_id <> 'documents' or name not like 'official-logos/%');

create policy official_logos_no_direct_delete
  on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id <> 'documents' or name not like 'official-logos/%');

notify pgrst, 'reload schema';

commit;
