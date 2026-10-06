-- Applied. Historical rows leave verification_submitted_by
-- NULL; new submissions populate it correctly.
-- §9 verification audit: retain the identity that submitted a resident
-- verification independently of the resident-row creator and reviewer.
-- No RLS policy changes are included; existing resident row policies continue
-- to govern access to the new column.

begin;

-- Supports §9 submitted_by audit attribution, distinct from completeness,
-- verification_status, and the reviewer/decision fields.
alter table public.residents
  add column if not exists verification_submitted_by uuid
  references auth.users(id) on delete set null;

create index if not exists residents_verification_submitted_by_idx
  on public.residents(verification_submitted_by);

commit;

-- ROLLBACK (run manually only after review)
-- begin;
--   drop index if exists public.residents_verification_submitted_by_idx;
--   alter table public.residents
--     drop column if exists verification_submitted_by;
-- commit;
