-- =============================================================================
-- Add custom_location field to health_services
--
-- Allows health services to have custom facility/location names without
-- requiring them to be registered in the facilities table. Users can enter
-- ad-hoc venue names like "San Isidro Barangay Hall", "Municipal Gymnasium",
-- or other community locations.
--
-- When facility_id is set, custom_location is null (use registered facility).
-- When facility_id is null and custom_location is set, display the custom
-- location name instead.
-- When both are null, the service is municipality-wide/RHU-wide.
-- =============================================================================

begin;

alter table public.health_services add column if not exists custom_location text;

comment on column public.health_services.custom_location is
  'Custom facility or venue name when a location is not registered in the facilities table. When set, facility_id should be null.';

-- Index for efficient queries
create index if not exists health_services_custom_location_idx
  on public.health_services (municipality_id) where custom_location is not null;

commit;
