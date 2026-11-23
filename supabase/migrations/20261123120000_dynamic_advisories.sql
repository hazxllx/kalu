begin;

create table public.advisories (
  id uuid primary key default gen_random_uuid(),
  title text check (title is null or char_length(title) <= 160),
  message text not null check (char_length(message) <= 5000 and btrim(message) <> ''),
  is_active boolean not null default true,
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create index advisories_active_order_idx
  on public.advisories (display_order, created_at)
  where is_active;
create index advisories_management_order_idx
  on public.advisories (display_order, created_at desc);

create trigger advisories_set_updated_at
  before update on public.advisories
  for each row execute function public.set_updated_at();

alter table public.advisories enable row level security;

grant select on public.advisories to anon, authenticated;
grant insert, update, delete on public.advisories to authenticated;

create policy advisories_public_active_read
  on public.advisories for select to anon, authenticated
  using (is_active or public.is_admin());

create policy advisories_admin_insert
  on public.advisories for insert to authenticated
  with check (public.is_admin());

create policy advisories_admin_update
  on public.advisories for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy advisories_admin_delete
  on public.advisories for delete to authenticated
  using (public.is_admin());

-- Broadcast only a change signal; clients must fetch public data from the API.
create or replace function public.broadcast_advisory_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('changed', true),
    'advisories_changed',
    'public:advisories',
    false
  );
  return null;
end;
$$;

create trigger advisories_broadcast_changes
  after insert or update or delete on public.advisories
  for each row execute function public.broadcast_advisory_change();

create policy advisories_public_change_signal_read
  on realtime.messages for select to anon, authenticated
  using (topic = 'public:advisories');

commit;
