-- Keep the four-tier community cluster assignment separate from the household's
-- three-tier environmental assessment stored on public.households.risk_level.
begin;

alter table public.household_risk_workflow
  add column if not exists risk_cluster_level text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.household_risk_workflow'::regclass
      and conname = 'household_risk_workflow_cluster_level_check'
  ) then
    alter table public.household_risk_workflow
      add constraint household_risk_workflow_cluster_level_check
      check (risk_cluster_level is null or risk_cluster_level in ('priority', 'intervention', 'monitor', 'stable'));
  end if;
end;
$$;

comment on column public.household_risk_workflow.risk_cluster_level is
  'Explicit four-tier community household cluster assignment; NULL means unassessed. Separate from households.risk_level environmental assessment.';

commit;

notify pgrst, 'reload schema';
