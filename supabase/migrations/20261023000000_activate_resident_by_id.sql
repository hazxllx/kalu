-- =============================================================================
-- KALUSAGAP — Existing-resident account activation by Resident ID
--
-- Adds an atomic, race-safe claim keyed on the permanent internal Resident ID
-- (public.residents.id, e.g. 'RES-000123'), mirroring the existing
-- claim_resident_for_account(uuid, text, date) which is keyed on identity_no.
--
-- The simplified "I already have a barangay health record" activation flow
-- lets an existing resident link a NEW Supabase Auth account to their EXISTING
-- resident record using the Resident ID their Health Supervisor gave them.
-- Identity is proven by (a) a verified email (Supabase Auth OTP that created
-- the session) and (b) a server-side date-of-birth match against the stored
-- record — a Resident ID alone is never sufficient.
--
-- Security:
--   * SECURITY DEFINER, service_role-only EXECUTE (the backend calls it with
--     the service client after verifying the session + DOB).
--   * The UPDATE only ever touches an UNLINKED record (auth_user_id IS NULL)
--     whose id + birth_date match, so two concurrent activations can never both
--     win and no second resident profile is ever created.
--   * Relies on the existing residents_auth_user_id_unique partial index
--     (20260927140000) to guarantee one account ↔ one resident record.
--
-- Idempotent and transactional. Safe to re-run.
-- =============================================================================

begin;

create or replace function public.activate_resident_by_id(
  p_auth_user_id uuid,
  p_resident_id text,
  p_birth_date date
)
returns public.residents
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.residents;
begin
  if p_auth_user_id is null
     or nullif(btrim(p_resident_id), '') is null
     or p_birth_date is null then
    return null;
  end if;

  update public.residents
     set auth_user_id = p_auth_user_id,
         updated_at = now()
   where id = btrim(p_resident_id)
     and birth_date = p_birth_date
     and auth_user_id is null       -- only an UNLINKED record can be claimed
  returning * into claimed;

  return claimed;   -- null when not found / DOB mismatch / already linked
end;
$$;

revoke execute on function public.activate_resident_by_id(uuid, text, date) from public, anon, authenticated;
grant  execute on function public.activate_resident_by_id(uuid, text, date) to service_role;

commit;
