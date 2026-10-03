-- KALUSAGAP — Maternal delivery date + outcome fields (M1 derivation support)
--
-- Additive only. The FHSIS M1 intrapartum/delivery indicators (Section B2) are
-- DERIVED from the existing public.maternal_records case data instead of being
-- re-entered as separate reporting figures. To attribute a delivery to a
-- reporting month the case needs an actual delivery DATE, and to count live
-- births the case needs an explicit outcome. The pre-existing delivery
-- description columns (type_of_delivery / place_of_delivery / birth_attendant,
-- added in 20260924070000) stay as-is; this migration only adds the two fields
-- the derivation needs and does not rewrite any existing row.
--
-- These remain neutral documentation fields. No clinical rule or classification
-- is encoded in the database; the low-birth-weight / skilled-attendant /
-- facility-based groupings are computed by the reporting layer from the values
-- the health worker records.

begin;

alter table public.maternal_records
  -- Actual date the delivery occurred (null = not yet delivered / not recorded).
  -- This is the reporting-period key for every Section B2 delivery indicator.
  add column if not exists delivery_date date,
  -- Delivery outcome used to separate live births from fetal deaths. Free of a
  -- CHECK constraint so legacy/empty rows are preserved; the reporting layer
  -- only counts the canonical values the form writes ('Live Birth').
  add column if not exists delivery_outcome text not null default '';

create index if not exists maternal_records_delivery_date_idx
  on public.maternal_records(barangay_id, delivery_date);

commit;
