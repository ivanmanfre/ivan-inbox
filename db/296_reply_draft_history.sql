-- 296: read-only "how did drafts like this one go" counts for a pending reply draft card (test signal).
-- Category = seat (outreach_campaigns.client_id via the prospect's campaign) x ai_model x the triggering
-- inbound's reply_intent (latest inbound at or before the draft) x draft_evidence.move (RISE only).
-- Window 45 days. A decision = approved more than 2 minutes after the draft was written (engine-stamped
-- approvals are not decisions) and then sent, or discarded in the inbox. Unchanged = the sent text equals
-- draft_evidence.generated_text after whitespace normalisation; a sent row with no generated_text is not counted.
-- Only a reply draft gets a row (their latest inbound is newer than our last send before the draft).
-- Additive only: no table changes, no writes. Called once per opened thread, not per refresh.
BEGIN;
CREATE OR REPLACE FUNCTION public.reply_draft_history(p_message_id uuid)
 RETURNS TABLE(message_id uuid, seat text, ai_model text, reply_intent text, move text,
               n integer, unchanged integer, edited integer, discarded integer, window_days integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  d record;
BEGIN
  IF auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT m.id, m.ai_model, m.created_at, m.prospect_id, coalesce(c.client_id,'ivan') AS seat,
         m.draft_evidence->>'move' AS move,
         (SELECT i.reply_intent FROM outreach_messages i
           WHERE i.prospect_id=m.prospect_id AND i.direction='inbound' AND i.created_at<=m.created_at
           ORDER BY i.created_at DESC LIMIT 1) AS intent,
         -- a reply draft: their latest inbound is newer than anything we sent before the draft was written
         (SELECT max(i.created_at) FROM outreach_messages i
           WHERE i.prospect_id=m.prospect_id AND i.direction='inbound' AND i.created_at<=m.created_at)
         > coalesce((SELECT max(o.sent_at) FROM outreach_messages o
           WHERE o.prospect_id=m.prospect_id AND o.direction='outbound' AND o.id<>m.id AND o.sent_at<=m.created_at),'-infinity') AS has_inbound
    INTO d
    FROM outreach_messages m
    JOIN outreach_prospects p ON p.id=m.prospect_id
    LEFT JOIN outreach_campaigns c ON c.id=p.campaign_id
   WHERE m.id=p_message_id AND m.direction='outbound';
  IF d.id IS NULL OR NOT coalesce(d.has_inbound,false) OR d.ai_model IS NULL THEN RETURN; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.cb34_p2_operator_lane_allowed(d.seat) THEN RETURN; END IF;
  RETURN QUERY
  WITH cand AS (
    SELECT h.message_text, h.sent_at, h.approved_at, h.created_at, h.send_blocked_reason,
           h.draft_evidence->>'generated_text' AS gen,
           (SELECT i.reply_intent FROM outreach_messages i
             WHERE i.prospect_id=h.prospect_id AND i.direction='inbound' AND i.created_at<=h.created_at
             ORDER BY i.created_at DESC LIMIT 1) AS intent
      FROM outreach_messages h
      JOIN outreach_prospects hp ON hp.id=h.prospect_id
      LEFT JOIN outreach_campaigns hc ON hc.id=hp.campaign_id
     WHERE h.direction='outbound' AND h.ai_model=d.ai_model AND h.id<>d.id
       AND h.created_at>=now()-interval '45 days'
       AND coalesce(hc.client_id,'ivan')=d.seat
       AND (d.seat<>'risedtc' OR (h.draft_evidence->>'move') IS NOT DISTINCT FROM d.move)
  ), lab AS (
    SELECT CASE
             WHEN send_blocked_reason='discarded_in_inbox' THEN 'discarded'
             WHEN sent_at IS NOT NULL AND approved_at IS NOT NULL AND approved_at-created_at>interval '2 minutes' AND gen IS NOT NULL THEN
               CASE WHEN regexp_replace(btrim(message_text),'\s+',' ','g')=regexp_replace(btrim(gen),'\s+',' ','g')
                    THEN 'unchanged' ELSE 'edited' END
           END AS outcome
      FROM cand WHERE intent IS NOT DISTINCT FROM d.intent
  )
  SELECT d.id, d.seat, d.ai_model, d.intent, d.move,
         count(outcome)::int, count(*) FILTER (WHERE outcome='unchanged')::int,
         count(*) FILTER (WHERE outcome='edited')::int, count(*) FILTER (WHERE outcome='discarded')::int, 45
    FROM lab;
END
$function$;
REVOKE ALL ON FUNCTION public.reply_draft_history(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reply_draft_history(uuid) TO authenticated, service_role;
COMMIT;
