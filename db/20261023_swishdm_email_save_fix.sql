-- Permit SwishDM held-email saves and a short DM when the reviewed email carries the report.
-- Keep research evidence out of URL filters when saving email recipients.
create or replace function public.save_inbox_draft_email_cc(
  p_message_id uuid, p_cc jsonb, p_expected_evidence jsonb
) returns void
language plpgsql security invoker
set search_path = public, pg_temp
as $function$
declare
  touched integer;
begin
  if p_cc is null or jsonb_typeof(p_cc) <> 'array' then
    raise exception 'Enter valid CC email addresses.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_cc) e
    where jsonb_typeof(e) <> 'string'
      or (e #>> '{}') !~ $email$^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$$email$
  ) then raise exception 'Enter valid CC email addresses.'; end if;

  update public.outreach_messages m set
    draft_evidence=coalesce(m.draft_evidence,'{}'::jsonb) || jsonb_build_object('email_cc',p_cc)
  where m.id=p_message_id and m.direction='outbound'
    and m.sent_at is null and m.approved_at is null and m.unipile_message_id is null
    and m.draft_evidence is not distinct from p_expected_evidence
    and (m.send_blocked_reason is null
      or starts_with(m.send_blocked_reason,'post_approval_race:')
      or starts_with(m.send_blocked_reason,'lint_')
      or (m.send_blocked_reason='awaiting_client_review'
        and m.ai_model like 'swishdm\_reply\_%' escape '\'
        and jsonb_array_length(p_cc)=0
        and not (m.draft_evidence ? 'stopped')
        and m.draft_evidence->>'lane' in ('swishdm_reply','swishdm_followup')
        and exists (select 1 from public.outreach_prospects p
          join public.outreach_campaigns c on c.id=p.campaign_id
          where p.id=m.prospect_id and c.client_id='swishdm')));
  get diagnostics touched = row_count;
  if touched<>1 then raise exception 'The draft changed. Refresh before approving.'; end if;
end;
$function$;
revoke all on function public.save_inbox_draft_email_cc(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.save_inbox_draft_email_cc(uuid,jsonb,jsonb) to authenticated, service_role;

-- Capture both email fields in the existing inbox approval receipt.
CREATE OR REPLACE FUNCTION public.approve_swishdm_reply_draft(p_message_id uuid, p_text text, p_expected_evidence jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  approved_time timestamptz := now();
  saved public.outreach_messages%rowtype;
  body text := btrim(coalesce(p_text, ''));
  page_url text;
  page_token text;
  newest_inbound uuid;
  lane text;
  anchor_at timestamptz;
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
     and m.draft_evidence->>'lane' in ('swishdm_reply', 'swishdm_followup')
     and m.sent_at is null and m.approved_at is null and m.unipile_message_id is null
     and m.send_blocked_reason = 'awaiting_client_review'
     and m.draft_evidence is not distinct from (p_expected_evidence - '_reviewed_email')
     and m.recipient_email is not distinct from p_expected_evidence->'_reviewed_email'->>'recipient_email'
     and m.email_mirror_text is not distinct from p_expected_evidence->'_reviewed_email'->>'email_mirror_text'
     and not (m.draft_evidence ? 'stopped')
   for update of m;
  if not found then
    raise exception 'The draft changed before approval. Refresh before approving.';
  end if;
  lane := saved.draft_evidence->>'lane';

  if lane = 'swishdm_followup' then
    -- A follow-up only goes to someone still silent since the touch it follows.
    anchor_at := nullif(saved.draft_evidence->'followup'->>'anchor_sent_at', '')::timestamptz;
    if anchor_at is null then
      raise exception 'This follow-up has no anchor message. Refresh before approving.';
    end if;
    if exists (select 1 from public.outreach_messages i
                where i.prospect_id = saved.prospect_id and i.direction = 'inbound'
                  and (i.sent_at is null or i.sent_at >= anchor_at)) then
      raise exception 'They wrote or reacted after our last message. Refresh and read the thread first.';
    end if;
    if exists (select 1 from public.outreach_prospects p where p.id = saved.prospect_id and (p.last_reply_at is not null or p.blacklisted)) then
      raise exception 'They replied or asked not to be contacted. This follow-up should not go out.';
    end if;
  else
    -- The sender only sends a reply that answers their NEWEST message; refuse the approval of one that does not.
    select i.id into newest_inbound
      from public.outreach_messages i
     where i.prospect_id = saved.prospect_id and i.direction = 'inbound'
     order by i.sent_at desc nulls last
     limit 1;
    if newest_inbound is null or newest_inbound::text is distinct from saved.draft_evidence->>'replies_to_inbound' then
      raise exception 'They wrote again after this draft. Refresh and read the thread first.';
    end if;
  end if;

  -- The report URL must stay in a reviewed delivery leg; the page must still exist.
  page_url := nullif(saved.draft_evidence->>'page_url', '');
  page_token := nullif(saved.draft_evidence->>'page_token', '');
  if page_url is not null then
    if position(page_url in body) = 0 and not (
      nullif(btrim(saved.recipient_email), '') is not null
      and position(page_url in coalesce(saved.email_mirror_text, '')) > 0
    ) then
      raise exception 'This reply carries the comparison page link. Keep the link in the DM or reviewed email, or discard the reply.';
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
           'source', 'inbox', 'lane', lane, 'text', body,
           'recipient_email', saved.recipient_email, 'email_mirror_text', saved.email_mirror_text,
           'approved_at', approved_time, 'approver', to_jsonb(auth.uid())))
   where m.id = p_message_id;
end;
$function$
;
