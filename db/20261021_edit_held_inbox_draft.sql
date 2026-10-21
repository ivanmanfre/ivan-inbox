-- 2026-10-21 · Edit a held message from the inbox (Ivan: "i want to edit this dm... it only allows me to
-- mark send anyway but i want to edit and send later..", Leighton Penrose held as duplicate_in_thread).
--
-- saveDraftText edits only rows with approved_at NULL and reason NULL / post_approval_race:* / lint_*, so a
-- gate-held row (duplicate_in_thread, send_failed_verified, arch_market_claim_unratified:*, ...) could only
-- be sent as it was or discarded. This RPC edits ONE held row's text and KEEPS IT HELD: the reason and the
-- hold time stay, nothing is queued. Sending stays on send_rejected_inbox_draft (unchanged), which then
-- sees the new text.
--
-- Guards: the same row shape send_rejected_inbox_draft accepts (outbound, unsent, no provider id, a gate
-- reason that is not a discard / supersede / schedule / native email failure / internal question), the
-- same SwishDM refusal (condition and words), plus optimistic checks on the text, reason, hold time,
-- approval and evidence the screen showed. An edit clears approved_at: the new words were never approved,
-- so Send anyway must approve them again. Every edit is appended to draft_evidence.operator_edits
-- (old / new text, when, who, the hold it was made under, the approval it cleared).
--
-- Additive: a new function, no existing function replaced, no table change.
-- Rollback: db/20261021_edit_held_inbox_draft_rollback.sql
CREATE OR REPLACE FUNCTION public.edit_held_inbox_draft(p_message_id uuid, p_text text, p_expected_text text, p_expected_reason text, p_expected_blocked_at timestamp with time zone, p_expected_approved_at timestamp with time zone, p_expected_evidence jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  m public.outreach_messages%rowtype;
  edited_time timestamptz := clock_timestamp();
  evidence jsonb;
begin
  select * into m from public.outreach_messages where id=p_message_id for update;
  -- SwishDM (Jonathan's seat) is sent only by its own n8n senders: same refusal as send_rejected_inbox_draft.
  if found and (m.draft_evidence->>'client' = 'swishdm'
    or coalesce(m.draft_evidence->>'lane','') like 'swishdm%'
    or exists (select 1 from public.outreach_prospects p join public.outreach_campaigns c on c.id=p.campaign_id
               where p.id=m.prospect_id and c.client_id='swishdm'))
  then raise exception 'SwishDM messages are sent only by the SwishDM senders. Nothing was sent.'; end if;
  if nullif(trim(coalesce(p_text,'')),'') is null or length(p_text)>8000
  then raise exception 'The message is empty or too long.'; end if;
  if not found or m.direction is distinct from 'outbound'
    or m.sent_at is not null or m.unipile_message_id is not null
    or m.message_text is distinct from p_expected_text
    or m.send_blocked_reason is distinct from p_expected_reason
    or m.send_blocked_at is distinct from p_expected_blocked_at
    or m.approved_at is distinct from p_expected_approved_at
    or m.draft_evidence is distinct from p_expected_evidence
    or m.send_blocked_reason is null or m.send_blocked_at is null
    or m.send_blocked_reason ~ '^(discarded|superseded|scheduled)(_|$)'
    or m.send_blocked_reason like 'native_email_send_failed:%'
    or m.send_blocked_reason in ('owner_confirmation','reply_retry_pending','owner_confirmation_superseded')
  then raise exception 'The held message changed. Refresh before editing.'; end if;
  if p_text = m.message_text then return; end if;
  evidence := coalesce(m.draft_evidence,'{}'::jsonb);
  evidence := evidence || jsonb_build_object('operator_edits',
    (case when jsonb_typeof(evidence->'operator_edits')='array' then evidence->'operator_edits' else '[]'::jsonb end)
    || jsonb_build_array(jsonb_build_object('source','inbox','old_text',m.message_text,'new_text',p_text,
      'at',edited_time,'operator_id',auth.uid(),'held_reason',m.send_blocked_reason,'held_at',m.send_blocked_at,
      'cleared_approved_at',m.approved_at)));
  update public.outreach_messages set message_text=p_text, approved_at=null, draft_evidence=evidence
  where id=m.id;
end $function$;

REVOKE ALL ON FUNCTION public.edit_held_inbox_draft(uuid, text, text, text, timestamp with time zone, timestamp with time zone, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_held_inbox_draft(uuid, text, text, text, timestamp with time zone, timestamp with time zone, jsonb) TO authenticated, service_role;
