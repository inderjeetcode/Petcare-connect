BEGIN;

-- Harden deprecated legacy role helper functions.
-- Keep existing function bodies and EXECUTE permissions unchanged.

ALTER FUNCTION public.is_admin()
SET search_path = '';

ALTER FUNCTION public.is_doctor()
SET search_path = '';

COMMIT;
