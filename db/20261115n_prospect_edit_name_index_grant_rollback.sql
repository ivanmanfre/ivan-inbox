-- Rollback of 20261115n_prospect_edit_name_index_grant.sql: authenticated loses EXECUTE on the two name functions again
-- (proacl was postgres=X, service_role=X on both). A signed-in prospect edit that changes the name fails again.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.detector_name_key(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.detector_name_norm(text) FROM authenticated;

COMMIT;
