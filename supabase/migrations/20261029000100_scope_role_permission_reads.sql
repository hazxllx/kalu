begin;

-- Authenticated users may inspect their own permission set. Only active
-- administrators may inspect the full matrix used by the access-control UI.
drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (public.is_admin() or role = public.profile_role());

commit;
