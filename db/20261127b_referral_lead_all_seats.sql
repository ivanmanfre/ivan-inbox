-- 2026-11-27 (Ivan, "inmail fixed in all lanes? ... i mean if its referral yeah"): the referral card's Create works on every
-- referral seat (ivan, arch, risedtc). The referred lead, its InMail lane (<seat>_referral_inmail) and its sender account
-- (<seat>_unipile_account_id) are the referrer's own seat. ARCH keeps the ARCH cold campaign. RISE and Ivan referred leads
-- get a dedicated campaign, inactive AND archived: the Campaign Rotator activates any inactive unarchived campaign, and no
-- harvester, scorer, invite sender or sequencer selects archived ones. Send Messages' queue reads every campaign.
-- Ivan's campaign has client_id NULL (Ivan's convention), so Ivan's reply drafter and classifier still see the thread.
-- Same signature as 20261126h (no DROP). Also: the prewarm skips cached referrals at REFERRAL_REVISION 23.
-- Apply seconds before the inbox-dm-draft deploy (a 22/23 mismatch re-researches every open referral each 5 minutes).
-- Rollback: 20261127b_referral_lead_all_seats_rollback.sql.
begin;
insert into public.outreach_campaigns (id, name, description, client_id, is_active, replenish_paused, archived, max_prospects)
values ('44fda815-2b0c-4928-a021-704e24e3d3f9', 'RiseDTC — Referred leads (inbox)', 'People a referrer pointed us to, from the inbox referral card. Inactive and archived on purpose: only the held first touch from the card goes out, through Send Messages.', 'risedtc', false, true, true, 0),
       ('246d63f6-b87a-44a8-9758-0c05975613f2', 'Ivan — Referred leads (inbox)', 'People a referrer pointed us to, from the inbox referral card. Inactive and archived on purpose: only the held first touch from the card goes out, through Send Messages.', null, false, true, true, 0)
on conflict (id) do nothing;
CREATE OR REPLACE FUNCTION public.inbox_referral_create_lead(p_referrer uuid, p_input_message uuid, p_revision integer, p_expected_url text, p_later_ids text[], p_read_at timestamp with time zone, p_discarded_ids text[], p_lead jsonb, p_text text, p_evidence jsonb, p_channel text DEFAULT 'connection_note'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  arch_cold constant uuid := '1a2701a0-931b-4949-95fb-9bbf2de16f09';
  -- 2026-11-27 (Ivan, "if its referral yeah"): RISE and Ivan referred leads go to their own campaign, inactive and
  -- archived, so no harvester, scorer, invite sender, sequencer or the Campaign Rotator picks it; the held first touch
  -- from the card is the only touch.
  rise_referred constant uuid := '44fda815-2b0c-4928-a021-704e24e3d3f9';
  ivan_referred constant uuid := '246d63f6-b87a-44a8-9758-0c05975613f2';
  lead_campaign uuid;
  lane text;
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
  -- Same seat rule as inbox_messages_v and the sender: a campaign with no client is Ivan's.
  select p.enrichment_data -> 'inbox_referral', coalesce(c.client_id, 'ivan') into ref, tenant
    from outreach_prospects p left join outreach_campaigns c on c.id = p.campaign_id
   where p.id = p_referrer for update of p;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'The referrer was not found.'); end if;
  -- The lead, its campaign, its InMail lane and its sender seat are all the referrer's own seat (no cross-seat send).
  lead_campaign := case tenant when 'arch' then arch_cold when 'risedtc' then rise_referred when 'ivan' then ivan_referred end;
  lane := tenant || '_referral_inmail';
  if lead_campaign is null or not exists (select 1 from outreach_campaigns where id = lead_campaign and coalesce(client_id, 'ivan') = tenant) then
    return jsonb_build_object('status', 'error', 'reason', 'Referred leads cannot be created for this seat.');
  end if;
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
  -- Sol r1 (2026-11-27): the seat the caller reviewed the copy on is the referrer's seat now, and the row names that
  -- seat's own account for either channel (Send Messages refuses a row whose seat or account no longer matches).
  if p_evidence ->> 'seat' is distinct from tenant
     or (p_channel = 'connection_note' and p_evidence ->> 'sender_account_id' is distinct from (select value from integration_config where key = tenant || '_unipile_account_id')) then
    return jsonb_build_object('status', 'error', 'reason', 'The referral changed seats. Refresh the conversation.');
  end if;
  -- 2026-11-26 (Ivan): the first touch goes as an InMail when one can go. The row carries what the Send Messages
  -- referral InMail lane checks: "Subject: ...", a blank line, the body; the ARCH seat; the one recipient.
  if p_channel = 'inmail' and (
       p_text is null
       or btrim(p_text) !~ '^Subject:[ \t]*[^[:space:]][^\r\n]{0,59}\n\n[ \t]*[^[:space:]]'
       or length(btrim(substring(btrim(p_text) from '^Subject:([^\r\n]*)'))) > 60
       or length(regexp_replace(btrim(p_text), '^Subject:[^\r\n]*\n\n', '')) > 1900
       or p_evidence ->> 'delivery_lane' is distinct from lane
       or p_evidence ->> 'inmail_api' is distinct from 'sales_navigator'
       or member is null or member !~ '^ACoAA'
       or p_evidence ->> 'inmail_provider_id' is distinct from member
       or nullif(p_evidence ->> 'sender_account_id', '') is null
       or p_evidence ->> 'sender_account_id' is distinct from (select value from integration_config where key = tenant || '_unipile_account_id')) then
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
   order by (coalesce(c.client_id, 'ivan') = tenant) desc, (c.client_id is null), p.created_at
   limit 1;
  if found then
    -- Same slug but a different known member id: not provably the same person.
    if member is not null and nullif(btrim(hit.linkedin_profile_id), '') is not null
       and li_member_key(hit.linkedin_profile_id) is distinct from li_member_key(member) then
      return jsonb_build_object('status', 'blocked', 'reason', 'An outreach row with this profile URL belongs to a different LinkedIn member. Check it by hand.');
    end if;
    if coalesce(hit.client_id, 'ivan') = tenant then
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
    values (lead, lead_campaign, 'https://www.linkedin.com/in/' || slug, member, p_lead ->> 'name', nullif(p_lead ->> 'headline', ''),
        nullif(p_lead ->> 'company', ''), nullif(p_lead ->> 'title', ''), nullif(p_lead ->> 'location', ''), nullif(p_lead ->> 'country', ''),
        nullif(p_lead ->> 'city', ''), nullif(p_lead ->> 'state', ''), 'identified',
        jsonb_build_object('source', 'inbox_referral_lead_v1', 'referral', jsonb_build_object(
          'at', now(), 'from_prospect_id', p_referrer, 'from_message_id', p_input_message, 'from_name', p_lead ->> 'referrer_name',
          'summary', ref -> 'summary', 'sources', ref -> 'sources')));
    -- The seat guards (client conflict, exclusions ledgers, vertical gates) may close the row on insert: then stage nothing.
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
      return jsonb_build_object('status', 'blocked', 'reason', case when tenant = 'arch' then 'An ARCH guard (client conflict or exclusion list) closes this person. Nothing was created.'
        else 'A seat guard (client conflict, exclusion list or vertical gate) closes this person. Nothing was created.' end);
  end;
  update outreach_prospects set enrichment_data = enrichment_data || jsonb_build_object('inbox_referral', ref || jsonb_build_object(
      'lead_prospect_id', lead, 'lead_message_id', msg, 'lead_created_at', now(), 'lead_result', 'created'))
   where id = p_referrer;
  return jsonb_build_object('status', 'created', 'lead_prospect_id', lead, 'message_id', msg, 'channel', p_channel);
end $function$;
revoke all on function public.inbox_referral_create_lead(uuid, uuid, integer, text, text[], timestamp with time zone, text[], jsonb, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.inbox_referral_create_lead(uuid, uuid, integer, text, text[], timestamp with time zone, text[], jsonb, text, jsonb, text) to service_role;
CREATE OR REPLACE FUNCTION public.inbox_referral_prewarm()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  n integer := 0;
  secret text := (select value from integration_config where key = 'inbox_push_secret');
begin
  if secret is null then return 0; end if;
  for r in
    with recent as (
      select m.id, m.prospect_id, m.message_text, coalesce(m.sent_at, m.created_at) as at
      from inbox_messages_v m
      where m.direction = 'inbound' and m.client_id in ('ivan', 'arch', 'risedtc')
        and nullif(btrim(m.message_text), '') is not null
        and coalesce(m.sent_at, m.created_at) > now() - interval '45 minutes'
    ), latest as (
      -- Same latest-inbound rule as the handler and the app: message time, then import order.
      select distinct on (m.prospect_id) m.prospect_id, m.id
      from inbox_messages_v m
      where m.direction = 'inbound' and m.prospect_id in (select prospect_id from recent)
        and nullif(btrim(m.message_text), '') is not null
      order by m.prospect_id, coalesce(m.sent_at, m.created_at) desc, m.created_at desc, m.id desc
    ), fresh as (
      select l.prospect_id, max(l.at) as at
      from recent l
      join outreach_prospects p on p.id = l.prospect_id
      left join latest x on x.prospect_id = l.prospect_id
      where not coalesce(p.blacklisted, false)
        and p.stage not in ('archived', 'skipped', 'disqualified', 'unsubscribed', 'blacklisted')
        -- Mirrors referralCandidate(): a cheap trigger only; the handler's model read decides.
        and (l.message_text ~* '\m(speak(ing)?|talk(ing)?|reach(ing)? out|connect(ing)?|check(ing)?)\s+(to|with)\s+(?!(me|us|you|him|her|them)\M)(?!\S*@\S+\.[a-z]{2,})\S|\mcontact(ing)?\s+(?!(me|us|you|him|her|them)\M)(?!\S*@\S+\.[a-z]{2,})\S'
          or exists (
            select 1 from regexp_matches(
              regexp_replace(regexp_replace(l.message_text, $title$,[[:space:]]*(our|my|the|their)[[:space:]]+[[:alpha:]][[:alpha:] &’'-]{0,80},$title$, ' ', 'gi'),
                $aux$\m(?:(?:(?:and|but|how much|when|where|why|what|how)\s+does)|does\s+(?:it|this|that)\s+(?:cost|work|include|require|mean|take|cover|apply))\M$aux$, '.', 'gi'),
              $owner$\m([[:alpha:]][[:alpha:]'-]*(?:\s+[[:alpha:]][[:alpha:]'-]*){0,3})\s+(?:handles?|does|manages?|runs?|looks after|is responsible for|is in charge of)\M$owner$, 'gi') as owners(parts)
            where parts[1] !~* '\m(i|we|you|he|she|they|it)\M'
          )
          or exists (
            select 1
            from regexp_matches(l.message_text, $url$https?://[^\s<>()\[\]"']+$url$, 'gi') as links(parts)
            where regexp_replace(parts[1], '[.,;:!?]+$', '') ~*
              '^https://([a-z]{2,3}\.)?linkedin\.com/in/[[:alnum:]_%-]+/?([?#].*)?$'
          ))
        -- Skip what the handler would serve from cache (same message, revision 23), and a thread whose
        -- open referral already read the newest reply.
        and not coalesce((p.enrichment_data -> 'inbox_referral' ->> 'input_message_id') = l.id::text
                         and (p.enrichment_data -> 'inbox_referral' ->> 'revision') = '23', false)
        and not coalesce((p.enrichment_data -> 'inbox_referral' -> 'later' ->> 'through_message_id') = x.id::text
                         and (p.enrichment_data -> 'inbox_referral' ->> 'revision') = '23', false)
      group by l.prospect_id
    ), open_ref as (
      select p.id as prospect_id, l.at
      from outreach_prospects p
      join outreach_campaigns c on c.id = p.campaign_id and c.client_id in ('ivan', 'arch', 'risedtc')
      join inbox_messages_v a on a.id::text = p.enrichment_data -> 'inbox_referral' ->> 'input_message_id' and a.prospect_id = p.id
      join lateral (
        select m.id, coalesce(m.sent_at, m.created_at) as at
        from inbox_messages_v m
        where m.prospect_id = p.id and m.direction = 'inbound' and nullif(btrim(m.message_text), '') is not null
        order by coalesce(m.sent_at, m.created_at) desc, m.created_at desc, m.id desc
        limit 1
      ) l on true
      where p.enrichment_data ? 'inbox_referral'
        and ((p.enrichment_data -> 'inbox_referral' ->> 'status') = 'verified'
             or jsonb_typeof(p.enrichment_data -> 'inbox_referral' -> 'email') = 'object')
        and (nullif(p.enrichment_data -> 'inbox_referral' ->> 'lead_prospect_id', '') is null
             or exists (select 1 from outreach_messages lm where lm.id::text = p.enrichment_data -> 'inbox_referral' ->> 'lead_message_id'
                          and lm.sent_at is null and (lm.send_blocked_at is null or lm.send_blocked_reason like 'referral_paused:%')))
        and p.enrichment_data -> 'inbox_referral' ->> 'dismissed_at' is null
        and not coalesce(p.blacklisted, false)
        and p.stage not in ('archived', 'skipped', 'disqualified', 'unsubscribed', 'blacklisted')
        and coalesce(a.sent_at, a.created_at) > now() - interval '60 days'
        and ((p.enrichment_data -> 'inbox_referral' ->> 'revision') is distinct from '23'
             or jsonb_typeof(p.enrichment_data -> 'inbox_referral' -> 'later' -> 'message_ids') is distinct from 'array'
             or (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(p.enrichment_data -> 'inbox_referral' -> 'later' -> 'message_ids') x)
                is distinct from inbox_referral_later_ids(p.id, a.id))
    )
    select prospect_id, max(at) as at from (select * from fresh union all select * from open_ref) q
    group by prospect_id
    order by max(at) desc
    -- Calls the handler rejects are cheap (no model call), so a wide batch keeps a real referral
    -- from being crowded out.
    limit 20
  loop
    perform net.http_post(
      url := 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/inbox-dm-draft',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', secret),
      body := jsonb_build_object('prospect_id', r.prospect_id, 'mode', 'referral'),
      timeout_milliseconds := 150000);
    n := n + 1;
  end loop;
  return n;
end $function$;
commit;
