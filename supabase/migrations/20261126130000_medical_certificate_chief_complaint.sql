begin;

alter table public.medical_certificates
  add column if not exists chief_complaint text not null default '',
  add column if not exists signatory_position text not null default '',
  add column if not exists issued_at timestamptz,
  add column if not exists issued_by uuid references public.profiles(id) on delete set null;

comment on column public.medical_certificates.chief_complaint is
  'The patient''s chief complaint or reason for the medical certificate visit.';

comment on column public.medical_certificates.signatory_position is
  'Official position of the healthcare professional who signs the certificate.';

comment on column public.medical_certificates.issued_at is
  'Timestamp when the certificate became official.';

comment on column public.medical_certificates.issued_by is
  'Authenticated PHN or MHO account that finalized issuance.';

-- Ask PostgREST to discard a stale relation definition after the DDL commit.
notify pgrst, 'reload schema';

commit;
