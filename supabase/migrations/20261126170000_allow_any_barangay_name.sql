begin;

-- Barangay names are municipality master data. They must not be restricted to
-- a hardcoded approved-name list: administrators may create and activate any
-- name, while the normal municipality, uniqueness, and status constraints
-- remain authoritative.
drop trigger if exists barangays_approved_registry_guard on public.barangays;

-- Older deployments may have a differently named copy of the same guard.
drop trigger if exists approved_barangay_registry_guard on public.barangays;

commit;
