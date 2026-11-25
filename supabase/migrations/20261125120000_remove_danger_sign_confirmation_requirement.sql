
-- Remove the obsolete administrative danger-sign confirmation requirement.
-- Actual clinical findings remain required.
-- Preserve all other clinical-integrity constraints and historical records.

BEGIN;

DO $$
DECLARE
  definition TEXT;
  original_definition TEXT;
  function_oid REGPROCEDURE;
BEGIN
  -- Resolve the existing zero-argument PostgreSQL function.
  function_oid :=
    'public.guard_consultation_clinical_integrity()'::regprocedure;

  -- Retrieve the complete deployed function definition.
  original_definition := pg_get_functiondef(function_oid);

  definition := original_definition;

  -- Remove only the obsolete danger-sign confirmation condition.
  definition := replace(
    definition,
    $q$      or new.consultation_details#>'{clinicalIndicators,dangerSignsReviewed}' is distinct from 'true'::jsonb$q$,
    ''
  );

  -- Update the obsolete validation error message.
  definition := replace(
    definition,
    'raise exception ''Clinical findings and confirmed danger-sign review are required''',
    'raise exception ''Clinical findings are required'''
  );

  -- Ensure that the migration actually changed the function.
  IF definition = original_definition THEN
    RAISE EXCEPTION
      'No changes made. The expected obsolete danger-sign condition was not found. Inspect the deployed function definition.';
  END IF;

  -- Ensure that the obsolete requirement is no longer present.
  IF definition LIKE '%confirmed danger-sign review%'
     OR definition LIKE '%dangerSignsReviewed%' THEN
    RAISE EXCEPTION
      'The obsolete danger-sign confirmation requirement remains in the function.';
  END IF;

  -- Replace the existing function while preserving its other logic.
  EXECUTE definition;

  RAISE NOTICE
    'Successfully removed the obsolete danger-sign confirmation requirement.';
END;
$$;

COMMIT;
