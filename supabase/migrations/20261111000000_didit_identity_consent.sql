-- Record that a resident agreed to Didit's identity-check processing before
-- a session was created. Existing manual registration approval is unchanged.
begin;

alter table public.identity_verifications
  add column if not exists consented_at timestamptz,
  add column if not exists consent_version text;

comment on column public.identity_verifications.consented_at is
  'Timestamp of the resident''s explicit consent to the Didit identity verification flow.';
comment on column public.identity_verifications.consent_version is
  'Version of the consent notice shown when the Didit session was created.';

commit;
