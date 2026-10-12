-- Add Neozep and Decolgen as brand aliases of the existing paracetamol +
-- phenylephrine + chlorphenamine combination.
--
-- Neozep Forte and Decolgen Forte share the SAME verified active ingredients
-- and strengths as Bioflu (Paracetamol 500 mg + Phenylephrine HCl 10 mg +
-- Chlorphenamine maleate 2 mg). To avoid duplicate catalog entries for the same
-- formulation (identity triple: generic + strength + form), they are recorded
-- as additional brand names on the single combination entry so brand searches
-- for "Neozep" or "Decolgen" resolve to it. Idempotent.

begin;

update public.medicines
  set brand_name = 'Bioflu, Neozep, Decolgen'
  where lower(generic_name) = 'paracetamol + phenylephrine + chlorphenamine'
    and lower(strength) = '500/10/2 mg'
    and lower(dosage_form) = 'tablet';

commit;
