-- supabase/migrations/20261126160000_reconcile_seeded_personnel_lifecycle.sql
begin;

-- Seeded and legacy personnel profiles predate the personnel lifecycle table.
-- They are valid active staff identities, but delegated management RPCs require
-- an approved lifecycle row before a PHN or Health Supervisor can create a
-- scoped personnel account. Reconcile only the already-trusted identities
-- accepted by `reconcile_provisioned_personnel`; it never creates access for a
-- resident-linked identity or an incomplete managed-personnel operation.
select public.reconcile_provisioned_personnel();

commit;
