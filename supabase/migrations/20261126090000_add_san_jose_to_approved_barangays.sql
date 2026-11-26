-- supabase/migrations/20261126090000_add_san_jose_to_approved_barangays.sql
begin;

-- San Jose is an official Pili barangay and already has boundary/workflow data
-- in this deployment. Keep the database registry guard in sync with the
-- application allowlist so admins can register it.
insert into public.approved_barangay_names (name)
values ('San Jose')
on conflict (name) do nothing;

commit;
