-- 2026-11-26 (Ivan): a referred ARCH lead's first touch goes as an InMail when one can go (Sales Navigator credits,
-- or an open profile), else the invite note as before. New p_channel parameter (default 'connection_note', so the
-- old caller keeps working). A parameter change needs DROP + CREATE. Rollback: 20261126h_referral_inmail_lead_rollback.sql.
begin;
drop function if exists public.inbox_referral_create_lead(uuid, uuid, integer, text, text[], timestamp with time zone, text[], jsonb, text, jsonb);
CREATE OR REPLACE FUNCTION public.inbox_referral_create_lead(p_referrer uuid, p_input_message uuid, p_revision integer, p_expected_url text, p_later_ids text[], p_read_at timestamp with time zone, p_discarded_ids text[], p_lead jsonb, p_text text, p_evidence jsonb, p_channel text DEFAULT 'connection_note'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  arch_cold constant uuid := '1a2701a0-931b-4949-95fb-9bbf2de16f09';
  ref jsonb;
  tenant text;
  slug text := li_slug(p_lead ->> 'linkedin_url');
  member text := nullif(btrim(p_lead ->> 'provider_id'), '');
  hit record;
  lead uuid := gen_random_uuid();
  msg uuid := gen_random_uuid();
  held record;
begin
  -- Serialize creates for the same person (two referrers naming them at once).
  perform pg_advisory_xact_lock(hashtext('inbox_referral_lead:' || coalesce(slug, '')));
  select p.enrichment_data -> 'inbox_referral', c.client_id into ref, tenant
    from outreach_prospects p join outreach_campaigns c on c.id = p.campaign_id
   where p.id = p_referrer for update of p;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'The referrer was not found.'); end if;
  if tenant is distinct from 'arch' or not exists (select 1 from outreach_campaigns where id = arch_cold and client_id = 'arch') then return jsonb_build_object('status', 'error', 'reason', 'Referred leads are ARCH only.'); end if;
  if nullif(ref ->> 'lead_prospect_id', '') is not null then
    return jsonb_build_object('status', 'exists', 'lead_prospect_id', ref ->> 'lead_prospect_id');
  end if;
  if ref ->> 'dismissed_at' is not null then return jsonb_build_object('status', 'error', 'reason', 'This referral was dismissed.'); end if;
  if ref ->> 'status' is distinct from 'verified' or ref ->> 'input_message_id' is distinct from p_input_message::text
     or ref ->> 'revision' is distinct from p_revision::text or ref ->> 'linkedin_url' is distinct from p_expected_url then
    return jsonb_build_object('status', 'error', 'reason', 'The referral changed. Refresh the conversation.');
  end if;
  -- Every reply after the handoff was read (a "hold off" imported late with an earlier time included) and said go.
  if not inbox_referral_later_ok(p_referrer, ref)
     or (select coalesce(array_agg(x order by x), '{}') from unnest(p_later_ids) x) is distinct from inbox_referral_later_ids(p_referrer, p_input_message) then
    return jsonb_build_object('status', 'error', 'reason', 'A reply after the handoff is not read yet, or it pauses the referral. Refresh the conversation.');
  end if;
  -- Nothing was written, sent or discarded on the referrer's thread since the caller's last read of it.
  if p_read_at is null or exists (select 1 from outreach_messages m where m.prospect_id = p_referrer
       and (m.created_at > p_read_at or m.sent_at > p_read_at or m.send_blocked_at > p_read_at)) then
    return jsonb_build_object('status', 'error', 'reason', 'The conversation changed. Refresh to see the current draft.');
  end if;
  -- The discarded drafts the note was written around are still discarded (an Undo clears the block time).
  if (select coalesce(array_agg(x order by x), '{}') from unnest(p_discarded_ids) x) is distinct from
     (select coalesce(array_agg(m.id::text order by m.id::text), '{}') from outreach_messages m, outreach_messages h
       where h.id = p_input_message and m.prospect_id = p_referrer and m.direction = 'outbound' and m.sent_at is null
         and nullif(btrim(m.message_text), '') is not null and m.send_blocked_reason like 'discarded%' and m.created_at >= h.created_at) then
    return jsonb_build_object('status', 'error', 'reason', 'The conversation changed. Refresh to see the current draft.');
  end if;
  if slug is null or li_slug(ref ->> 'linkedin_url') is distinct from slug then
    return jsonb_build_object('status', 'error', 'reason', 'The LinkedIn profile does not match the referral.');
  end if;
  -- The member id verified for this person is the one reviewed. An InMail needs it; a note, when it is known.
  -- Sol r4: the pin is the identity's member_id, recorded only when the handoff was researched (never by a redraft).
  if (p_channel = 'inmail' and nullif(ref ->> 'member_id', '') is null)
     or (nullif(ref ->> 'member_id', '') is not null
         -- Exact compare: li_member_key() is null for a short or odd id.
         and (member is null or btrim(ref ->> 'member_id') is distinct from member)) then
    return jsonb_build_object('status', 'error', 'reason', 'That LinkedIn profile is not the member the draft was checked against. Refresh the conversation.');
  end if;
  if p_channel is distinct from 'connection_note' and p_channel is distinct from 'inmail' then
    return jsonb_build_object('status', 'error', 'reason', 'The first touch is an invite note or an InMail.');
  end if;
  if p_channel = 'connection_note' and (nullif(btrim(p_text), '') is null or length(btrim(p_text)) > 300) then
    return jsonb_build_object('status', 'error', 'reason', 'The invite note must be 1 to 300 characters.');
  end if;
  -- 2026-11-26 (Ivan): the first touch goes as an InMail when one can go. The row carries what the Send Messages
  -- referral InMail lane checks: "Subject: ...", a blank line, the body; the ARCH seat; the one recipient.
  if p_channel = 'inmail' and (
       p_text is null
       or btrim(p_text) !~ '^Subject:[ \t]*[^[:space:]][^\r\n]{0,59}\n\n[ \t]*[^[:space:]]'
       or length(btrim(substring(btrim(p_text) from '^Subject:([^\r\n]*)'))) > 60
       or length(regexp_replace(btrim(p_text), '^Subject:[^\r\n]*\n\n', '')) > 1900
       or p_evidence ->> 'delivery_lane' is distinct from 'arch_referral_inmail'
       or p_evidence ->> 'inmail_api' is distinct from 'sales_navigator'
       or member is null or member !~ '^ACoAA'
       or p_evidence ->> 'inmail_provider_id' is distinct from member
       or nullif(p_evidence ->> 'sender_account_id', '') is null
       or p_evidence ->> 'sender_account_id' is distinct from (select value from integration_config where key = 'arch_unipile_account_id')) then
    return jsonb_build_object('status', 'error', 'reason', 'The InMail is not ready to stage (subject, body, seat or recipient). Refresh and try again.');
  end if;

  -- Same person already in outreach (any tenant), by normalized profile.
  select p.id, p.stage, c.client_id, p.linkedin_profile_id,
         (select count(*) from outreach_messages m where m.prospect_id = p.id and m.direction = 'outbound' and m.sent_at is not null) sent,
         (select count(*) from outreach_messages m where m.prospect_id = p.id and m.direction = 'outbound' and m.sent_at is null and m.approved_at is null and m.send_blocked_at is null) drafts
    into hit
    from outreach_prospects p left join outreach_campaigns c on c.id = p.campaign_id
   where li_slug(p.linkedin_url) = slug
      or (member is not null and (li_member_key(p.linkedin_profile_id) = li_member_key(member) or li_member_key(p.linkedin_url) = li_member_key(member)))
   order by (c.client_id = 'arch') desc nulls last, p.created_at
   limit 1;
  if found then
    -- Same slug but a different known member id: not provably the same person.
    if member is not null and nullif(btrim(hit.linkedin_profile_id), '') is not null
       and li_member_key(hit.linkedin_profile_id) is distinct from li_member_key(member) then
      return jsonb_build_object('status', 'blocked', 'reason', 'An outreach row with this profile URL belongs to a different LinkedIn member. Check it by hand.');
    end if;
    if hit.client_id = 'arch' then
      update outreach_prospects set enrichment_data = enrichment_data || jsonb_build_object('inbox_referral', ref || jsonb_build_object(
          'lead_prospect_id', hit.id, 'lead_created_at', now(), 'lead_result', 'linked_existing'))
       where id = p_referrer;
      return jsonb_build_object('status', 'linked_existing', 'lead_prospect_id', hit.id, 'stage', hit.stage, 'sent', hit.sent, 'drafts', hit.drafts);
    end if;
    return jsonb_build_object('status', 'blocked', 'reason', format('This person is already a %s prospect (stage %s). Nothing was created.', coalesce(hit.client_id, 'ivan'), hit.stage));
  end if;

  -- A probable namesake row: same name at the same company, under another profile URL.
  select p.id, c.client_id, p.stage into hit
    from outreach_prospects p left join outreach_campaigns c on c.id = p.campaign_id
   where lower(btrim(p.name)) = lower(btrim(p_lead ->> 'name'))
     and nullif(btrim(p_lead ->> 'company'), '') is not null
     and lower(btrim(coalesce(p.company, ''))) = lower(btrim(p_lead ->> 'company'))
   limit 1;
  if found then
    return jsonb_build_object('status', 'blocked', 'reason', format('A %s prospect with the same name and company exists (stage %s). Check it before creating another.', coalesce(hit.client_id, 'ivan'), hit.stage));
  end if;

  -- Already emailed or drafted from the referrer's thread (the referral email leg, the ARCH drafter's email).
  select m.id, m.sent_at into held
    from outreach_messages m
   where m.direction = 'outbound'
     and ((m.draft_evidence ->> 'referral_input_message_id') = p_input_message::text
          or (nullif(p_lead ->> 'email', '') is not null and lower(m.recipient_email) = lower(p_lead ->> 'email')))
     and m.ai_model is distinct from 'inbox_referral_lead_v1'
     and (m.sent_at is not null or m.approved_at is not null or m.send_blocked_at is null)
   limit 1;
  if found then
    return jsonb_build_object('status', 'blocked', 'reason', case when held.sent_at is not null
      then 'An email to this person was already sent from the referrer''s thread. Nothing was created.'
      else 'An email to this person is already drafted on the referrer''s thread. Nothing was created.' end);
  end if;

  begin
    insert into outreach_prospects (id, campaign_id, linkedin_url, linkedin_profile_id, name, headline, company, title,
        location, country, city, state, stage, enrichment_data)
    values (lead, arch_cold, 'https://www.linkedin.com/in/' || slug, member, p_lead ->> 'name', nullif(p_lead ->> 'headline', ''),
        nullif(p_lead ->> 'company', ''), nullif(p_lead ->> 'title', ''), nullif(p_lead ->> 'location', ''), nullif(p_lead ->> 'country', ''),
        nullif(p_lead ->> 'city', ''), nullif(p_lead ->> 'state', ''), 'identified',
        jsonb_build_object('source', 'inbox_referral_lead_v1', 'referral', jsonb_build_object(
          'at', now(), 'from_prospect_id', p_referrer, 'from_message_id', p_input_message, 'from_name', p_lead ->> 'referrer_name',
          'summary', ref -> 'summary', 'sources', ref -> 'sources')));
    -- The ARCH guards (client conflict, exclusions ledger) may close the row on insert: then stage nothing.
    if exists (select 1 from outreach_prospects where id = lead and (blacklisted or skip_state is not null)) then
      raise exception using errcode = 'P0001', message = 'guard_closed';
    end if;
    insert into outreach_messages (id, prospect_id, direction, channel, message_type, message_text, ai_model, sequence_step,
        sent_at, approved_at, draft_evidence)
    -- An InMail first touch is a manual_reply on channel linkedin_inmail, the shape the DM reservation and the
    -- referral InMail lane take for a message with no chat yet (RISE referral InMails since 10-12).
    values (msg, lead, 'outbound', case when p_channel = 'inmail' then 'linkedin_inmail' else 'linkedin' end,
        case when p_channel = 'inmail' then 'manual_reply' else 'connection_note' end, btrim(p_text), 'inbox_referral_lead_v1', null,
        -- sent_at defaults to now() at the column level: null keeps this a held draft.
        null, null, p_evidence || jsonb_build_object('v', 'inbox_referral_lead_v1', 'referrer_prospect_id', p_referrer,
          'referral_input_message_id', p_input_message, 'referral_revision', p_revision, 'sent_as', p_channel));
  exception
    when unique_violation then
      return jsonb_build_object('status', 'blocked', 'reason', 'This LinkedIn profile is already in outreach. Refresh and try again.');
    when raise_exception then
      if sqlerrm <> 'guard_closed' then raise; end if;
      return jsonb_build_object('status', 'blocked', 'reason', 'An ARCH guard (client conflict or exclusion list) closes this person. Nothing was created.');
  end;
  update outreach_prospects set enrichment_data = enrichment_data || jsonb_build_object('inbox_referral', ref || jsonb_build_object(
      'lead_prospect_id', lead, 'lead_message_id', msg, 'lead_created_at', now(), 'lead_result', 'created'))
   where id = p_referrer;
  return jsonb_build_object('status', 'created', 'lead_prospect_id', lead, 'message_id', msg, 'channel', p_channel);
end $function$;
revoke all on function public.inbox_referral_create_lead(uuid, uuid, integer, text, text[], timestamp with time zone, text[], jsonb, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.inbox_referral_create_lead(uuid, uuid, integer, text, text[], timestamp with time zone, text[], jsonb, text, jsonb, text) to service_role;

-- Sol r4/r5: inbox_set_referral_v2 as live (2026-11-26), plus: a same-handoff save that conflicts with a verified pin is
-- refused (returns false; the caller answers "changed, try again"), so the pin, the profile URL and the copy never split.
CREATE OR REPLACE FUNCTION public.inbox_set_referral_v2(p_prospect uuid, p_referral jsonb, p_keep_verified boolean, p_expected_input text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  cur jsonb;
  acted jsonb;
begin
  select enrichment_data -> 'inbox_referral' into cur from outreach_prospects where id = p_prospect for update;
  if not found then return false; end if;
  -- The run started from another handoff than the one stored now: a newer handoff (maybe already dismissed or
  -- turned into a lead) was saved meanwhile, so this older answer is dropped.
  if cur ->> 'input_message_id' is distinct from p_expected_input
     and cur ->> 'input_message_id' is distinct from p_referral ->> 'input_message_id' then
    return false;
  end if;
  if p_keep_verified and coalesce(p_referral ->> 'status', '') <> 'verified'
     and cur ->> 'input_message_id' = p_referral ->> 'input_message_id'
     and cur ->> 'revision' = p_referral ->> 'revision'
     and cur ->> 'status' = 'verified' then
    return true;
  end if;
  acted := case when cur ->> 'input_message_id' = p_referral ->> 'input_message_id'
    then jsonb_strip_nulls(jsonb_build_object(
      'lead_prospect_id', cur -> 'lead_prospect_id', 'lead_message_id', cur -> 'lead_message_id',
      'lead_created_at', cur -> 'lead_created_at', 'lead_result', cur -> 'lead_result', 'dismissed_at', cur -> 'dismissed_at'))
    else '{}'::jsonb end;
  -- The verified member pinned for this handoff: a same-handoff save that drops, changes or downgrades it, or points at
  -- another profile URL, is refused under this row lock (a redraft carries the same identity and passes).
  if cur ->> 'input_message_id' = p_referral ->> 'input_message_id' and cur ->> 'status' = 'verified'
     and nullif(cur ->> 'member_id', '') is not null
     and (p_referral ->> 'status' is distinct from 'verified'
          or p_referral ->> 'member_id' is distinct from cur ->> 'member_id'
          or li_slug(p_referral ->> 'linkedin_url') is distinct from li_slug(cur ->> 'linkedin_url')) then
    return false;
  end if;
  -- A newer handoff replaces this one while its staged invite waits for Send: the invite goes back to review.
  if cur ->> 'input_message_id' is distinct from p_referral ->> 'input_message_id' and nullif(cur ->> 'lead_message_id', '') is not null then
    update outreach_messages set approved_at = null, send_blocked_at = now(), send_blocked_reason = 'referral_paused: a newer handoff replaced this referral'
     where id = (cur ->> 'lead_message_id')::uuid and ai_model = 'inbox_referral_lead_v1' and sent_at is null
       and (send_blocked_at is null or send_blocked_reason like 'referral_paused:%');
  end if;
  update outreach_prospects
     set enrichment_data = coalesce(enrichment_data, '{}'::jsonb) || jsonb_build_object('inbox_referral', p_referral || acted)
   where id = p_prospect;
  return true;
end $function$;

-- Sol r2: the Send Messages final check for a referral lead row, read-only. It answers {ok:true} only when the row as
-- stored now still carries this run's claim and an approval, has no block or delivery id, and the referral hold read
-- (on the row's current evidence) is clear. Anything else, or no answer, stops the send.
create or replace function public.inbox_referral_send_check(p_message_id uuid, p_claimed_at timestamp with time zone, p_approved_at timestamp with time zone, p_text text)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare m outreach_messages%rowtype; why text;
begin
  select * into m from outreach_messages where id = p_message_id;
  if not found then return jsonb_build_object('ok', false, 'why', 'row_missing'); end if;
  if m.ai_model is distinct from 'inbox_referral_lead_v1' then return jsonb_build_object('ok', false, 'why', 'not_a_referral_lead'); end if;
  -- Sol r3: the approval and the text this run is about to send are the ones stored now (a re-approval with edited copy
  -- between the queue read and the claim stops it).
  if p_claimed_at is null or p_approved_at is null or p_text is null
     or m.sent_at is distinct from p_claimed_at or m.approved_at is distinct from p_approved_at or m.message_text is distinct from p_text
     or m.send_blocked_at is not null or m.send_blocked_reason is not null or m.unipile_message_id is not null then
    return jsonb_build_object('ok', false, 'why', 'row_changed');
  end if;
  why := inbox_referral_hold_reason(m.ai_model, m.prospect_id, m.draft_evidence, m.recipient_email);
  if why is not null then return jsonb_build_object('ok', false, 'why', why); end if;
  return jsonb_build_object('ok', true);
end $function$;
revoke all on function public.inbox_referral_send_check(uuid, timestamp with time zone, timestamp with time zone, text) from public, anon, authenticated;
grant execute on function public.inbox_referral_send_check(uuid, timestamp with time zone, timestamp with time zone, text) to service_role;
commit;
