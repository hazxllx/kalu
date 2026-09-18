-- =============================================================================
-- KALUSAGAP — reference data (canonical deployment registry)
--
-- Applies on top of ALL migrations. Idempotent: safe to re-run.
--
-- Canonical barangays for the Pili deployment (matching the frontend
-- BARANGAYS constant in frontend/src/lib/barangays.js):
--   San Isidro, San Antonio, Old San Roque
-- Facilities (matching frontend/src/lib/consultationLocations.js):
--   "RHU" plus one "<Barangay> Barangay Health Center" per barangay.
-- =============================================================================

begin;

insert into public.municipalities (name, province, region)
values ('Pili', 'Camarines Sur', 'Region V (Bicol)')
on conflict (name, province) do update
  set region = excluded.region;

insert into public.barangays (municipality_id, name, status, health_station_name)
select m.id, v.name, 'Active', v.name || ' Barangay Health Center'
from public.municipalities m,
     (values ('San Isidro'), ('San Antonio'), ('Old San Roque')) as v(name)
where m.name = 'Pili' and m.province = 'Camarines Sur'
on conflict (municipality_id, name) do nothing;

insert into public.facilities (municipality_id, barangay_id, name, type)
select m.id, null, 'RHU', 'rhu'
from public.municipalities m
where m.name = 'Pili' and m.province = 'Camarines Sur'
on conflict (municipality_id, name) do nothing;

insert into public.facilities (municipality_id, barangay_id, name, type)
select b.municipality_id, b.id, b.name || ' Barangay Health Center', 'barangay_health_station'
from public.barangays b
join public.municipalities m on m.id = b.municipality_id
where m.name = 'Pili' and m.province = 'Camarines Sur'
on conflict (municipality_id, name) do nothing;

commit;
