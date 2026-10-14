-- =============================================================================
-- KALUSAGAP — consultation <-> health service link
--
-- Connects the existing Health Services catalog
-- (public.health_services, migration 20260928180000_health_services.sql) to the
-- consultation workflow (public.visits). Previously a consultation recorded
-- which treatment was given as free text only, with no relationship to the
-- health service it belonged to, so service records stayed isolated from
-- consultation records.
--
-- WHAT IT ADDS (additive only — no existing data is touched):
--   public.visits.health_service_id  nullable FK to public.health_services
--   index visits_health_service_id_idx for service-filtered listing
--
-- WHY NULLABLE + ON DELETE SET NULL: a consultation is valid without a service
-- (legacy rows and general consultations), and deactivating/deleting a service
-- must never delete or invalidate the historical consultations that referenced
-- it. The service association on historical records is preserved; when the
-- referenced service row itself is removed, the link drops to NULL while the
-- consultation keeps every clinical field.
--
-- Also record the service NAME at save time (health_service_name). The catalog
-- row can later be renamed or deactivated; the consultation keeps displaying
-- the service as it was recorded, the same snapshot approach the rest of the
-- clinical record uses (bp_classification, medications, patient_snapshot).
--
-- Barangay Active/Inactive status already exists on public.barangays
-- (status text default 'Active' check in ('Active','Inactive'),
-- migration 20260915100000), so no barangay change is needed here.
--
-- RLS NOTE (resident Consultation History security): the existing
-- visits_select policy already restricts resident-token reads to rows where
-- `residents.auth_user_id = auth.uid()` (migration
-- 20260915100100_accounts_documents_and_clinical_scope.sql), so a resident can
-- never read another resident's consultations by changing URL/API parameters —
-- the new health_service_id / health_service_name columns inherit exactly the
-- same row-level boundary and no policy change is required. The Express API
-- additionally resolves the resident from the session (never a request id).
-- =============================================================================

begin;

alter table public.visits
  add column if not exists health_service_id uuid references public.health_services(id)
    on delete set null;

alter table public.visits
  add column if not exists health_service_name text not null default '';

create index if not exists visits_health_service_id_idx
  on public.visits (health_service_id);

commit;
