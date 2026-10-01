-- Protected staging only: pin the trigger function's resolution to catalog built-ins.
-- Reversible with: ALTER FUNCTION public.college_coverage_append_only() RESET search_path;
ALTER FUNCTION public.college_coverage_append_only() SET search_path = pg_catalog;
