-- =============================================================================
-- KALUSAGAP — DEVELOPMENT reference data (synthetic, non-production)
--
-- !! DO NOT APPLY TO PRODUCTION lblawqeoixojyytkmfqy !!
--
-- This seed is for a DEDICATED development/staging Supabase project only. It
-- creates deliberately synthetic reference data (municipality "Taguig Test",
-- barangay "Test Poblacion") so dev records can never be mistaken for the real
-- Pili deployment data created by supabase/seed.sql.
--
-- Idempotent: safe to re-run.
--
-- Apply against the linked DEV project:
--   supabase db execute --file supabase/seed-dev.sql
--   # or: psql "<DEV_DB_URL>" -f supabase/seed-dev.sql
--
-- The matching test BHW auth user + profile is created separately by
-- backend/scripts/provision-test-bhw.mjs (auth users cannot be seeded from SQL).
-- =============================================================================

begin;

-- Municipality --------------------------------------------------------------
insert into public.municipalities (name, province, region)
values ('Taguig Test', 'NCR', 'NCR')
on conflict (name, province) do update
  set region = excluded.region;

-- Barangay ------------------------------------------------------------------
insert into public.barangays (municipality_id, name, status, health_station_name)
select m.id, 'Test Poblacion', 'Active', 'Test Poblacion Barangay Health Center'
from public.municipalities m
where m.name = 'Taguig Test' and m.province = 'NCR'
on conflict (municipality_id, name) do nothing;

-- Facilities (RHU + one barangay health station) ----------------------------
insert into public.facilities (municipality_id, barangay_id, name, type)
select m.id, null, 'Test RHU', 'rhu'
from public.municipalities m
where m.name = 'Taguig Test' and m.province = 'NCR'
on conflict (municipality_id, name) do nothing;

insert into public.facilities (municipality_id, barangay_id, name, type)
select b.municipality_id, b.id, 'Test Poblacion Barangay Health Center', 'barangay_health_station'
from public.barangays b
join public.municipalities m on m.id = b.municipality_id
where m.name = 'Taguig Test' and m.province = 'NCR'
on conflict (municipality_id, name) do nothing;

commit;

-- =============================================================================
-- Verification (run manually after seeding)
-- =============================================================================
-- select id, name, province from public.municipalities where name = 'Taguig Test';
-- select id, name from public.barangays where name = 'Test Poblacion';
-- select id, name, type from public.facilities
--   where municipality_id = (select id from public.municipalities
--                            where name='Taguig Test' and province='NCR');
