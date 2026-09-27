-- KALUSAGAP - secure resident account linking

begin;

create unique index if not exists residents_identity_no_unique
  on public.residents (identity_no)
  where nullif(btrim(identity_no), '') is not null;

create or replace function public.claim_resident_for_account(
  p_auth_user_id uuid,
  p_identity_no text,
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
  if p_auth_user_id is null or nullif(btrim(p_identity_no), '') is null or p_birth_date is null then
    return null;
  end if;

  update public.residents
     set auth_user_id = p_auth_user_id,
         updated_at = now()
   where identity_no = btrim(p_identity_no)
     and birth_date = p_birth_date
     and auth_user_id is null
  returning * into claimed;

  return claimed;
end;
$$;

revoke execute on function public.claim_resident_for_account(uuid, text, date) from public, anon, authenticated;
grant execute on function public.claim_resident_for_account(uuid, text, date) to service_role;

commit;