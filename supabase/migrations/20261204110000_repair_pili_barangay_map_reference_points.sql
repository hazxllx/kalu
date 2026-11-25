-- Restore the approved Community Health Map reference points after barangay
-- records are created or reseeded after the original map migration ran.
--
-- These are the LGU-provided, barangay-level reference points established in
-- 20260926120000_map_geo_reference_and_zone.sql.  Keep an existing valid
-- coordinate intact: this migration repairs only missing or invalid values.

begin;

with approved_points (name, latitude, longitude) as (
  values
    ('San Isidro', 13.559700::numeric, 123.272000::numeric),
    ('San Antonio', 13.558100::numeric, 123.273000::numeric),
    ('Old San Roque', 13.553000::numeric, 123.274500::numeric)
)
update public.barangays as barangay
set
  latitude = point.latitude,
  longitude = point.longitude
from public.municipalities as municipality
cross join approved_points as point
where barangay.municipality_id = municipality.id
  and municipality.name = 'Pili'
  and point.name = barangay.name
  and (
    barangay.latitude is null
    or barangay.longitude is null
    or barangay.latitude not between -90 and 90
    or barangay.longitude not between -180 and 180
  );

commit;
