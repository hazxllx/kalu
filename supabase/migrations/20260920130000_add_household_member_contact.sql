-- supabase/migrations/20260920130000_add_household_member_contact.sql
-- KALUSAGAP — household_members contact column
--
-- Adds an optional contact field for household member reachability.
begin;

alter table public.household_members
  add column if not exists contact text;

commit;
