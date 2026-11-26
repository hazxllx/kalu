-- supabase/migrations/20261121080000_strict_resident_mobile_format.sql
-- Resident contact numbers are optional, but supplied values must be the
-- canonical Philippine mobile format used by the API and registration forms.
alter table public.residents drop constraint if exists residents_cellphone_no_format;

alter table public.residents
  add constraint residents_cellphone_no_format check (
    length(btrim(cellphone_no)) = 0
    or btrim(cellphone_no) ~ '^09[0-9]{9}$'
  ) not valid;
