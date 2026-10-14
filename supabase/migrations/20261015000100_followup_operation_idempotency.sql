-- Prevent a retried offline follow-up create from inserting a duplicate after
-- the server committed the row but its response was lost.
--
-- Additive only: existing follow-ups are preserved and receive NULL keys.
-- The unique partial index applies only to client-generated operation keys.

begin;

alter table public.follow_ups
  add column if not exists client_operation_key text;

create unique index if not exists follow_ups_client_operation_key_unique
  on public.follow_ups (client_operation_key)
  where client_operation_key is not null;

comment on column public.follow_ups.client_operation_key is
  'Idempotency-Key of an offline follow-up creation; unique so a retry cannot create a second follow-up.';

commit;
