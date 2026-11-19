BEGIN;

CREATE OR REPLACE FUNCTION public.inbox_sales_call_results()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  results jsonb;
BEGIN
  IF public.content_owner_ok_ivan() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'operator_denied' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'meeting_id', b.meeting_id,
    'name', COALESCE(NULLIF(btrim(b.booker_name), ''), NULLIF(btrim(b.meeting_title), ''), 'Unnamed booking'),
    'starts_at', b.meeting_start,
    'outcome', b.meeting_outcome,
    'deal_status', f.status,
    'prospect_id', b.prospect_id
  ) ORDER BY b.meeting_start DESC, b.meeting_id), '[]'::jsonb)
  INTO results
  FROM public.booking_attributions b
  LEFT JOIN public.post_call_followups f
    ON f.meeting_id = b.meeting_id AND f.client_id = b.client_id
  WHERE b.client_id = 'ivan' AND b.meeting_start <= statement_timestamp();

  RETURN results;
END;
$$;

REVOKE ALL ON FUNCTION public.inbox_sales_call_results() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inbox_sales_call_results() TO authenticated;

COMMIT;
