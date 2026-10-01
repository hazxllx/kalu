-- Consultation personnel (name & designation) who performed the assessment at
-- the RHU Consultation Station / PHN check-up.
--
-- This is distinct from:
--   * recorded_by_name  — the TRIAGE personnel who recorded the encounter, and
--   * recorded_by_id     — the authenticated actor (audit trail, unchanged).
--
-- Stored alongside the other PHN clinical outputs (phn_assessment / phn_notes)
-- and written only through the consultation workbench. Additive, nullable-safe
-- (defaults to '') so existing visits are unaffected.

alter table public.visits
  add column if not exists phn_personnel text not null default '';
