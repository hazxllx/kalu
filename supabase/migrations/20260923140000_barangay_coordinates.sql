-- KALUSAGAP - Barangay point coordinates for the Community Health Overview map.
--
-- Additive only: adds nullable latitude/longitude to public.barangays so the
-- Leaflet map can plot each barangay. No existing column, row, policy or
-- trigger is modified or removed, and no barangay is deleted.
--
-- COORDINATE SOURCE (recorded per project rule — no fabricated/estimated points):
--   OpenStreetMap via Nominatim (https://nominatim.openstreetmap.org),
--   ODbL 1.0, © OpenStreetMap contributors. Only OSM `place`-type nodes whose
--   name matches the barangay were used:
--     - San Antonio   -> node 13050541914 (place=quarter) 13.558173, 123.273117
--     - Old San Roque  -> node 7805803701  (place=quarter) 13.552406, 123.276504
--   San Isidro is intentionally LEFT NULL: OSM has no authoritative place node
--   for it (only an unrelated "San Isidro Tanod Outpost" building located in the
--   San Antonio quarter), so a verified coordinate is not available. Per the
--   no-fabrication rule it is reported as unavailable rather than guessed.
--
-- These are reference points (poblacion quarter nodes), not official barangay
-- hall coordinates or boundaries; they are adequate to place a marker. Replace
-- with surveyed coordinates/boundaries when the LGU provides them.

begin;

alter table public.barangays
  add column if not exists latitude numeric(9, 6),
  add column if not exists longitude numeric(9, 6);

-- Guard against clearly-invalid values without forcing every row to have coords.
alter table public.barangays
  drop constraint if exists barangays_latitude_range;
alter table public.barangays
  add constraint barangays_latitude_range
  check (latitude is null or (latitude >= -90 and latitude <= 90));

alter table public.barangays
  drop constraint if exists barangays_longitude_range;
alter table public.barangays
  add constraint barangays_longitude_range
  check (longitude is null or (longitude >= -180 and longitude <= 180));

-- Seed ONLY the OSM-verified points, scoped to Pili so a same-named barangay in
-- another municipality is never touched. Idempotent (safe to re-run).
update public.barangays b
set latitude = 13.558173, longitude = 123.273117
from public.municipalities m
where b.municipality_id = m.id and m.name = 'Pili' and b.name = 'San Antonio';

update public.barangays b
set latitude = 13.552406, longitude = 123.276504
from public.municipalities m
where b.municipality_id = m.id and m.name = 'Pili' and b.name = 'Old San Roque';

commit;
