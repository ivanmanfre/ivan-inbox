-- 098: operator_escalate_rise_draft routes by the prospect's tenant (name kept: the inbox calls it).
-- Ivan 2026-09-18, on Serg Safonov's ARCH thread: "idk why it says mattan".

CREATE OR REPLACE FUNCTION public.operator_escalate_rise_draft(p_gate text, p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_pid uuid; v_name text; v_company text; v_url text; v_gap jsonb;
  v_inbound text; v_q text; v_why text; v_body text; v_exists uuid;
  v_tenant text; v_ops_client text; v_channel text; v_notes text; v_owner text;
begin
  if not operator_gate_ok(p_gate) then
    return jsonb_build_object('ok', false, 'error', 'bad_gate');
  end if;

  select p.id, p.name, p.company, p.linkedin_url, m.context_gap, c.client_id
    into v_pid, v_name, v_company, v_url, v_gap, v_tenant
  from outreach_messages m
  join outreach_prospects p on p.id = m.prospect_id
  left join outreach_campaigns c on c.id = p.campaign_id
  where m.id = p_message_id;

  if v_pid is null then
    return jsonb_build_object('ok', false, 'error', 'message_not_found');
  end if;

  -- 098: the route follows the PROSPECT'S tenant. Until 2026-09-18 every escalation went to client
  -- 'rise' and Mattan's Slack channel whatever the thread was, so the button on an ARCH thread (Serg
  -- Safonov, Savvy KID) would have queued Davorin's prospect question for Mattan. Unknown tenant or
  -- Ivan's own seat = no route, fail closed.
  if v_tenant = 'risedtc' then
    v_ops_client := 'rise'; v_channel := 'C0BJ72F58BY'; v_notes := 'RISE'; v_owner := 'Mattan';
  elsif v_tenant = 'arch' then
    v_ops_client := 'arch'; v_channel := 'C0BPJ0KHXV1'; v_notes := 'ARCH'; v_owner := 'Davorin';
  else
    return jsonb_build_object('ok', false, 'error', 'no client to ask on this seat');
  end if;

  select od.id into v_exists
  from ops_drafts od
  where od.kind = 'escalation'
    and od.context->>'prospect_id' = v_pid::text
    and od.sent_at is null
  limit 1;
  if v_exists is not null then
    return jsonb_build_object('ok', true, 'note', 'Already waiting in the Ops inbox.');
  end if;

  select im.message_text into v_inbound
  from outreach_messages im
  where im.prospect_id = v_pid and im.direction = 'inbound'
    and coalesce(im.is_reaction, false) = false
  order by coalesce(im.sent_at, im.created_at) desc
  limit 1;

  v_q   := coalesce(nullif(trim(v_gap->>'question'), ''), 'How do you want me to answer that?');
  v_why := coalesce(v_gap->>'why', '');

  v_body := coalesce(v_name, 'This lead')
          || coalesce(' (' || nullif(v_company, '') || ')', '')
          || ' asked something our ' || v_notes || ' notes do not cover:' || E'\n"'
          || left(coalesce(v_inbound, ''), 400) || '"' || E'\n\n'
          || v_q
          || coalesce(E'\n\n' || nullif(v_url, ''), '');

  insert into ops_drafts (client_id, kind, slack_channel, body, context)
  values (v_ops_client, 'escalation', v_channel, v_body,
          jsonb_build_object(
            'prospect_id',   v_pid,
            'prospect_name', v_name,
            'company',       v_company,
            'triggers',      jsonb_build_array('unanswerable_question'),
            'source',        'operator_escalate_from_inbox',
            'gap',           v_why,
            'chat_url',      v_url,
            'message_id',    p_message_id,
            'inbound',       left(coalesce(v_inbound, ''), 500)
          ));

  return jsonb_build_object('ok', true, 'note', 'Queued for ' || v_owner || ' in the Ops inbox.');
end;
$function$;
