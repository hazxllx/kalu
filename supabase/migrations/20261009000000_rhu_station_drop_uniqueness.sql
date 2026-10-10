-- =============================================================================
-- KALUSAGAP — Remove ALL per-facility RHU personnel uniqueness
--
-- A facility must support MANY active RHU personnel and MANY per station:
--
--   RHU A ├── Juan  → Triage       → Active
--         ├── Maria → Triage       → Active
--         ├── Pedro → Consultation → Active
--         └── Ana   → Consultation → Active   (all simultaneously)
--
-- Earlier drafts enforced "one active RHU per facility" and later "one per
-- facility per station". Both are wrong for this system. This migration is the
-- authoritative, idempotent removal of every such index, so the rule holds no
-- matter which earlier draft was applied to a given database. Station access is
-- enforced per account via `profiles.rhu_stations` (see
-- 20261008000000_rhu_station_assignment.sql) and the API, never by a
-- database-level facility lock.
--
-- Additive + idempotent.
-- =============================================================================

begin;

drop index if exists public.one_active_rhu_per_facility;
drop index if exists public.one_active_rhu_triage_per_facility;
drop index if exists public.one_active_rhu_consultation_per_facility;

commit;
