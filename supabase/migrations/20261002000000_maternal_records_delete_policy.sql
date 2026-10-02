-- KALUSAGAP — maternal_records DELETE policy (spec PART 13).
--
-- The original operational-records migration generated SELECT / INSERT / UPDATE
-- RLS policies for follow_ups, tcl_entries, maternal_records and immunizations
-- but no DELETE policy, so maternal records could not be removed through a
-- user token. The Maternal Record page now supports deleting a maternal record
-- (its totals must stop counting it in Monthly / Quarterly / Annual reports),
-- so add a DELETE policy for maternal_records ONLY, mirroring its UPDATE policy
-- (admin, or an active staff member whose assignment covers the record's
-- barangay). Other operational kinds remain append-only.

begin;

create policy maternal_records_delete on public.maternal_records
  for delete to authenticated using (
    public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id))
  );

commit;
