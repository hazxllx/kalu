-- Normalize profile email addresses and enforce case/whitespace-insensitive
-- uniqueness. Auth users already have an Auth-level unique email constraint;
-- this protects the application's one-profile-per-email mirror as well.
--
-- Stop before changing anything if imported/legacy profiles already collide.
-- Resolve those records explicitly before re-running this migration; this
-- migration never deletes or merges existing accounts.
do $$
begin
  if exists (
    select 1
    from public.profiles
    where btrim(email) <> ''
    group by lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception
      'Cannot enforce normalized profile email uniqueness: duplicate emails exist after trim/lowercase normalization. Reconcile the listed profiles explicitly, then retry this migration.';
  end if;
end;
$$;

create unique index profiles_email_normalized_unique
  on public.profiles (lower(btrim(email)))
  where btrim(email) <> '';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    lower(btrim(coalesce(new.email, ''))),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'resident',
    'pending_verification'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
