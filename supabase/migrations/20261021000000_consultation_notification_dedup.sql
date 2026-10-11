-- =============================================================================
-- KALUSAGAP — consultation "new record" notification idempotency
--
-- When authorized health personnel save a consultation (a `visits` row), the
-- resident receives one in-app notification created via the shared
-- notifications infrastructure (notifications.service.notifyResidentOnce) with
--   related_type = 'consultation'
--   related_id   = <visit id>
--
-- This partial unique index is the authoritative guard that a given
-- consultation produces AT MOST ONE notification per resident, even under
-- retries, repeated save requests, page refreshes, or a rare concurrent race.
-- The application also pre-checks before inserting; this index closes the race
-- window. A duplicate insert then fails harmlessly (the notify helper swallows
-- and logs the error) and the consultation save itself is never affected.
--
-- Scope is restricted to related_type = 'consultation' so other notification
-- types that may legitimately repeat for the same related_id (e.g. verification
-- decisions, follow-up changes) are completely unaffected.
--
-- Idempotent: safe to re-run.
-- =============================================================================

create unique index if not exists notifications_consultation_once_idx
  on public.notifications (recipient_id, related_id)
  where related_type = 'consultation';
