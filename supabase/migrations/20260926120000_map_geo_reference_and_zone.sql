-- KALUSAGAP — Community Health Map geographic reference + resident Zone.
--
-- Additive / idempotent. No table, policy or trigger is dropped and no row is
-- deleted. Three concerns are handled together because they share the same
-- Pili reference deployment:
--
--   1. Barangay-level geographic reference points for the Community Health Map.
--      Reuses the existing public.barangays.latitude/longitude columns added by
--      20260923140000_barangay_coordinates.sql (no new geo table is created,
--      per the "reuse existing structure" rule). The three initial barangays
--      are set to the LGU-provided reference points supplied for this
--      deployment. These are BARANGAY-LEVEL reference points only — never
--      individual resident/household coordinates.
--
--   2. Municipality centre point (public.municipalities.latitude/longitude) so
--      the map can frame the Municipality of Pili without hard-coding the
--      centre in a React component.
--
--   3. A controlled Zone (1..8) on residents for the registration form, stored
--      as a small integer with a CHECK constraint. Frontend restrictions are
--      not sufficient; this is the database-level guarantee.

begin;

-- ---------------------------------------------------------------------------
-- 1. Barangay reference points (Pili). Scoped to Pili so a same-named barangay
--    in another municipality is never touched. Overwrites the earlier OSM
--    seed with the LGU-provided reference points for this deployment.
-- ---------------------------------------------------------------------------
update public.barangays b
set latitude = 13.559700, longitude = 123.272000
from public.municipalities m
where b.municipality_id = m.id and m.name = 'Pili' and b.name = 'San Isidro';

update public.barangays b
set latitude = 13.558100, longitude = 123.273000
from public.municipalities m
where b.municipality_id = m.id and m.name = 'Pili' and b.name = 'San Antonio';

update public.barangays b
set latitude = 13.553000, longitude = 123.274500
from public.municipalities m
where b.municipality_id = m.id and m.name = 'Pili' and b.name = 'Old San Roque';

-- ---------------------------------------------------------------------------
-- 2. Municipality centre point.
-- ---------------------------------------------------------------------------
alter table public.municipalities
  add column if not exists latitude numeric(9, 6),
  add column if not exists longitude numeric(9, 6);

alter table public.municipalities
  drop constraint if exists municipalities_latitude_range;
alter table public.municipalities
  add constraint municipalities_latitude_range
  check (latitude is null or (latitude >= -90 and latitude <= 90));

alter table public.municipalities
  drop constraint if exists municipalities_longitude_range;
alter table public.municipalities
  add constraint municipalities_longitude_range
  check (longitude is null or (longitude >= -180 and longitude <= 180));

update public.municipalities
set latitude = 13.554170, longitude = 123.275280
where name = 'Pili' and province = 'Camarines Sur';

-- ---------------------------------------------------------------------------
-- 3. Resident Zone (1..8), controlled by a CHECK constraint. Nullable so the
--    huge body of existing resident rows (which predate the field) stays
--    valid; new registrations supply it and the API rejects anything outside
--    1..8 before it ever reaches the row.
-- ---------------------------------------------------------------------------
alter table public.residents
  add column if not exists zone smallint;

alter table public.residents
  drop constraint if exists residents_zone_range;
alter table public.residents
  add constraint residents_zone_range
  check (zone is null or (zone >= 1 and zone <= 8));

commit;
