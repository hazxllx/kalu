-- =============================================================================
-- KALUSAGAP — persist an immutable snapshot of the submitted report content
--
-- PROBLEM: public.reports only stored submission METADATA (report_type,
-- report_period, title, remarks) and the routing/status columns. The actual
-- generated report — the summary totals and the per-record rows the sender
-- reviewed — never reached the database, so a recipient opening a report could
-- only ever see metadata, and historical reports could not reproduce what was
-- originally submitted.
--
-- FIX (additive, backward-compatible):
--   * add `content` (jsonb) — the versioned, self-contained report snapshot,
--   * add `content_schema_version` (int) — which snapshot shape `content` uses.
--
-- Both columns are NULLABLE. Existing report rows keep NULL content; the
-- application renders an explicit "legacy content unavailable" state for them
-- rather than reconstructing an old report from current records.
--
-- The snapshot lives ON public.reports (1 row = 1 submission) so a submission
-- and its content are written in a single, atomic INSERT — a report can never
-- be marked Submitted while its content is missing. Row visibility is already
-- governed by the existing reports_select RLS policy, so the snapshot inherits
-- the same sender / routed-recipient / in-scope-oversight / admin boundary with
-- no new policy required.
--
-- Idempotent: safe to re-run.
-- =============================================================================

begin;

alter table public.reports
  add column if not exists content jsonb,
  add column if not exists content_schema_version integer;

comment on column public.reports.content is
  'Immutable snapshot of the submitted report (summary, columns, rows, metadata). NULL for legacy rows submitted before snapshotting.';
comment on column public.reports.content_schema_version is
  'Schema version of the content snapshot (NULL when no snapshot was captured).';

-- Content, when present, must be a JSON object (never a bare array/scalar).
alter table public.reports
  drop constraint if exists reports_content_is_object;
alter table public.reports
  add constraint reports_content_is_object
  check (content is null or jsonb_typeof(content) = 'object');

-- The snapshot and its routing details are immutable after submission. Extend
-- the existing recipient-review guard so a review (Received/Reviewed/Rejected)
-- can never rewrite the submitted content or its schema version. Admins and the
-- service-role path are intentionally exempt (same as the original guard).
create or replace function public.guard_report_review_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.created_by is distinct from old.created_by
       or new.sender_role is distinct from old.sender_role
       or new.recipient_role is distinct from old.recipient_role
       or new.municipality_id is distinct from old.municipality_id
       or new.barangay_id is distinct from old.barangay_id
       or new.report_type is distinct from old.report_type
       or new.report_period is distinct from old.report_period
       or new.title is distinct from old.title
       or new.content is distinct from old.content
       or new.content_schema_version is distinct from old.content_schema_version
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'reports: routing and submitted report details are immutable';
    end if;
    if new.reviewed_by is distinct from auth.uid() then
      raise exception 'reports: review actor must match the authenticated user';
    end if;
    if old.status = 'Draft' or new.status not in ('Received', 'Reviewed', 'Rejected') then
      raise exception 'reports: invalid recipient status';
    end if;
    if new.status = 'Rejected' and nullif(btrim(new.remarks), '') is null then
      raise exception 'reports: rejection requires a reason';
    end if;
  end if;
  return new;
end;
$$;

commit;
