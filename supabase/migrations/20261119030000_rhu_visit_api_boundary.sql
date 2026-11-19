-- Clinical writes use the authenticated Express service, which validates role,
-- station, patient scope, raw measurements, and workflow state. Browser table
-- writes must not bypass those checks through the older permissive policies.
begin;

revoke insert, update, delete, truncate, references, trigger
  on table public.visits from anon, authenticated;

-- Narrow the existing municipality/barangay policies, preserving their other
-- constraints and existing patient/history readers. RHU station access alone
-- does not authorize another facility's records or another worker's drafts.
drop policy if exists visits_rhu_station_read on public.visits;
create policy visits_rhu_station_read on public.visits as restrictive
for select to authenticated
using (
  public.profile_role() <> 'rhu_personnel'
  or (
    public.is_staff_active()
    and facility_id is not null
    and facility_id = public.profile_facility_id()
    and (
      ('triage' = any(public.profile_rhu_stations()) and recorded_by_id = auth.uid()::text)
      or ('consultation' = any(public.profile_rhu_stations()) and status <> 'draft')
    )
  )
);

commit;
notify pgrst, 'reload schema';
