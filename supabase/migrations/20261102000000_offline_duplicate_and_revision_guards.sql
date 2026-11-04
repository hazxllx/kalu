-- Offline-first sync: make resident creation replay-safe at the database level.
--
-- A retried offline resident create (server committed the row but the response
-- was lost) carries the same Idempotency-Key. Persisting it in a unique partial
-- index lets the API return the already-created resident instead of inserting
-- a second one, even when two retries race.
--
-- Additive only: existing residents keep NULL keys and are unaffected. No unique
-- index is placed over resident / follow-up identity fields, because existing
-- data could already violate it; duplicate detection for those is enforced in
-- the API layer.

begin;

alter table public.residents
  add column if not exists client_operation_key text;

create unique index if not exists residents_client_operation_key_unique
  on public.residents (client_operation_key)
  where client_operation_key is not null;

comment on column public.residents.client_operation_key is
  'Idempotency-Key of an offline resident creation; unique so a retry cannot create a second resident.';

commit;

notify pgrst, 'reload schema';
