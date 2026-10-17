-- SwishDM reply drafts: Ivan approves them from the inbox (DMs page), one row at a time.
--
-- Why a separate RPC: the shared approve_inbox_pipeline_draft refuses any row whose send_blocked_reason is not
-- null / post_approval_race: / lint_. SwishDM reply drafts (lane swishdm_reply, written by the lane-2 reply
-- triage and the comparison-page builder) are inserted with send_blocked_reason 'awaiting_client_review' and
-- send_blocked_at set, so no shared drafter, reminder or dispatcher that filters on send_blocked_at IS NULL
-- ever touches them. This function approves exactly ONE such row and clears ITS hold. Nothing else changes:
-- the SwishDM DM sender keeps every rule it has (switches, hours, newest-inbound check, live page check).
--
-- It is NOT a send and NOT a publish. It stamps approved_at, clears the hold on the row and writes the receipt
-- (draft_evidence.operator_copy_approval, source 'inbox') that the page publisher requires.
-- Rollback: db/20261017_swishdm_reply_approval_rollback.sql
create or replace function public.approve_swishdm_reply_draft(
  p_message_id uuid, p_text text, p_expected_evidence jsonb
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  approved_time timestamptz := now();
  saved public.outreach_messages%rowtype;
  body text := btrim(coalesce(p_text, ''));
  page_url text;
  page_token text;
  newest_inbound uuid;
begin
  if not public.cb34_p2_operator_lane_allowed('ivan') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if body = '' or char_length(body) > 1900 then
    raise exception 'The reply must be between 1 and 1900 characters.';
  end if;

  select m.* into saved
    from public.outreach_messages m
    join public.outreach_prospects p on p.id = m.prospect_id
    join public.outreach_campaigns c on c.id = p.campaign_id
   where m.id = p_message_id
     and c.client_id = 'swishdm'
     and m.direction = 'outbound' and m.message_type = 'dm'
     and coalesce(m.channel, 'linkedin') = 'linkedin'
     and m.ai_model like 'swishdm\_reply\_%' escape '\'
     and m.draft_evidence->>'lane' = 'swishdm_reply'
     and m.sent_at is null and m.approved_at is null and m.unipile_message_id is null
     and m.send_blocked_reason = 'awaiting_client_review'
     and m.draft_evidence is not distinct from p_expected_evidence
     and not (m.draft_evidence ? 'stopped')
   for update of m;
  if not found then
    raise exception 'The draft changed before approval. Refresh before approving.';
  end if;

  -- The sender only sends a reply that answers their NEWEST message; refuse the approval of one that does not.
  select i.id into newest_inbound
    from public.outreach_messages i
   where i.prospect_id = saved.prospect_id and i.direction = 'inbound'
   order by i.sent_at desc nulls last
   limit 1;
  if newest_inbound is null or newest_inbound::text is distinct from saved.draft_evidence->>'replies_to_inbound' then
    raise exception 'They wrote again after this draft. Refresh and read the thread first.';
  end if;

  -- A page-link reply: the link must stay in the text, and the page must exist unpublished or published.
  page_url := nullif(saved.draft_evidence->>'page_url', '');
  page_token := nullif(saved.draft_evidence->>'page_token', '');
  if page_url is not null then
    if position(page_url in body) = 0 then
      raise exception 'This reply carries the comparison page link. Keep the link in the text, or discard the reply.';
    end if;
    if not exists (select 1 from public.swishdm_comparison_pages g
                    where g.token = page_token and g.prospect_id = saved.prospect_id and g.url = page_url
                      and g.status in ('held', 'published')) then
      raise exception 'The comparison page for this reply is missing. Refresh before approving.';
    end if;
  end if;

  update public.outreach_messages m set
    message_text = body,
    approved_at = approved_time,
    send_blocked_reason = null,
    send_blocked_at = null,
    draft_evidence = coalesce(m.draft_evidence, '{}'::jsonb)
      || case when body is distinct from btrim(saved.message_text)
              then jsonb_build_object('original_text', coalesce(m.draft_evidence->'original_text', to_jsonb(saved.message_text)))
              else '{}'::jsonb end
      || jsonb_build_object('operator_copy_approval', jsonb_build_object(
           'source', 'inbox', 'lane', 'swishdm_reply', 'text', body,
           'approved_at', approved_time, 'approver', to_jsonb(auth.uid())))
   where m.id = p_message_id;
end;
$function$;

revoke all on function public.approve_swishdm_reply_draft(uuid, text, jsonb) from public, anon;
grant execute on function public.approve_swishdm_reply_draft(uuid, text, jsonb) to authenticated, service_role;
