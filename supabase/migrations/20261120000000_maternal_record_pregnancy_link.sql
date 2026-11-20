-- Reconcile the legacy maternal case table with the encounter-based pregnancy workflow.
-- This is additive: existing maternal records remain intact and may continue to
-- operate independently until explicitly linked to an encounter-based pregnancy.

begin;

alter table public.maternal_records
  add column if not exists pregnancy_id uuid
  references public.maternal_pregnancies(id) on delete set null;

create index if not exists maternal_records_pregnancy_id_idx
  on public.maternal_records(pregnancy_id);

commit;
