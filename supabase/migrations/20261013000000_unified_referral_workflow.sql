-- =============================================================================
-- KALUSAGAP — Unified referral workflow (barangay → RHU triage → consultation)
--
-- Bridges the barangay referral (public.health_referrals) to the clinical
-- encounter (public.visits) so ONE referral flows end to end:
--
--   health_referrals (barangay, primary record)
--     ├─ clinical detail: chief complaints / medical history / PPE findings /
--     │  impression (distinct from the referral reason)
--     ├─ scheduled_at: scheduled referral date & time (referral_date stays the
--     │  submission date)
--     ├─ treatment_visit_id: the originating barangay Treatment Record visit
--     └─ visits.referral_id → this referral (the RHU triage/consultation
--        encounter; triage + consultation are one visit advanced through the
--        existing status machine). Referral progress is DERIVED from that visit;
--        the original barangay fields are never overwritten.
--
-- RHU read access to health_referrals is already granted by the existing
-- health_referrals_select RLS policy (its municipality branch already lists
-- 'rhu_personnel'); only the service/route layer widening is needed in code, so
-- this migration changes NO policy. Writes continue through the service-role
-- backend.
--
-- Additive + idempotent.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- health_referrals: barangay clinical detail + scheduling + treatment link
-- ---------------------------------------------------------------------------
alter table public.health_referrals
  add column if not exists chief_complaints text not null default '',
  add column if not exists medical_history text not null default '',
  add column if not exists physical_exam_findings text not null default '',
  add column if not exists impression text not null default '',
  add column if not exists scheduled_at timestamptz,
  add column if not exists treatment_visit_id text
    references public.visits(id) on delete set null;

comment on column public.health_referrals.scheduled_at is
  'Scheduled referral date & time. Distinct from referral_date (the submission date).';
comment on column public.health_referrals.treatment_visit_id is
  'The originating barangay Treatment Record (visits row) this referral arose from, when applicable.';

-- ---------------------------------------------------------------------------
-- visits.referral_id: the RHU triage/consultation encounter → its barangay
-- referral. Nullable (walk-in visits have none). on delete set null so a
-- removed referral never deletes clinical history.
-- ---------------------------------------------------------------------------
alter table public.visits
  add column if not exists referral_id uuid
    references public.health_referrals(id) on delete set null;

create index if not exists visits_referral_id_idx
  on public.visits (referral_id) where referral_id is not null;

comment on column public.visits.referral_id is
  'The barangay health_referrals row this RHU triage/consultation encounter serves, when the patient arrived via a referral.';

commit;
