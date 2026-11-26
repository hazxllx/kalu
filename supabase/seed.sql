-- supabase/seed.sql
-- =============================================================================
-- KALUSAGAP — reference data (canonical deployment registry)
--
-- Applies on top of ALL migrations. Idempotent: safe to re-run.
--
-- Approved barangays for the Pili deployment (shared in shared/barangays.js):
--   San Antonio, San Isidro, Old San Roque
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
     (values ('San Antonio'), ('San Isidro'), ('Old San Roque')) as v(name)
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
  and b.status = 'Active'
on conflict (municipality_id, name) do nothing;

-- Sample residents for local/demo deployments. Stable IDs make this block
-- idempotent while the scope lookup keeps the records attached to San Isidro.
insert into public.residents (
  id, health_record_no, last_name, first_name, middle_name, birth_date,
  birth_place, sex, civil_status, religion, employment_status, father_name,
  mother_name, is_4ps_member, philhealth_no, current_address,
  permanent_address, cellphone_no, identity_no, zone, barangay,
  barangay_id, municipality_id, verification_status
)
select r.id, r.health_record_no, r.last_name, r.first_name, r.middle_name,
       r.birth_date, r.birth_place, r.sex, r.civil_status, r.religion,
       r.employment_status, r.father_name, r.mother_name, r.is_4ps_member,
       r.philhealth_no, r.current_address, r.permanent_address, r.cellphone_no,
       r.identity_no, r.zone, b.name, b.id, b.municipality_id, 'approved'
from (
  values
    ('RES-SI-0001', 'HRN-SI-0001', 'Dela Cruz', 'Maria', 'Santos', date '1988-04-17', 'Pili, Camarines Sur', 'Female', 'Married', 'Roman Catholic', 'Vendor', 'Ramon Dela Cruz', 'Lourdes Santos', false, '12-345678901-2', 'Zone 2, San Isidro, Pili, Camarines Sur', 'Zone 2, San Isidro, Pili, Camarines Sur', '0917-555-0142', 'PSN-SI-0001', 2),
    ('RES-SI-0002', 'HRN-SI-0002', 'Ramos', 'Joel', 'Garcia', date '1979-11-03', 'Naga City, Camarines Sur', 'Male', 'Married', 'Roman Catholic', 'Tricycle Driver', 'Antonio Ramos', 'Elena Garcia', true, '13-456789012-3', 'Zone 5, San Isidro, Pili, Camarines Sur', 'Zone 5, San Isidro, Pili, Camarines Sur', '0928-555-0186', 'PSN-SI-0002', 5),
    ('RES-SI-0003', 'HRN-SI-0003', 'Mendoza', 'Angela', 'Reyes', date '2002-08-26', 'Pili, Camarines Sur', 'Female', 'Single', 'Iglesia ni Cristo', 'Student', 'Eduardo Mendoza', 'Nena Reyes', false, '14-567890123-4', 'Zone 7, San Isidro, Pili, Camarines Sur', 'Zone 7, San Isidro, Pili, Camarines Sur', '0908-555-0217', 'PSN-SI-0003', 7)
) as r(id, health_record_no, last_name, first_name, middle_name, birth_date,
        birth_place, sex, civil_status, religion, employment_status, father_name,
        mother_name, is_4ps_member, philhealth_no, current_address,
        permanent_address, cellphone_no, identity_no, zone)
join public.barangays b on b.name = 'San Isidro' and b.status = 'Active'
join public.municipalities m on m.id = b.municipality_id
  and m.name = 'Pili' and m.province = 'Camarines Sur'
on conflict (id) do nothing;

commit;
