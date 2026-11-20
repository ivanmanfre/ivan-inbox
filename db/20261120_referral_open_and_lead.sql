-- Referral card: verified handoffs stay open after later replies, and a referred person can become an
-- ARCH lead with a held first touch (2026-11-20). Keep the cache revision aligned with REFERRAL_REVISION
-- in supabase/functions/inbox-dm-draft/research.ts (13).

-- Finds open verified referrals without reading every prospect's enrichment JSON (1.7 s seq scan before).
create index if not exists outreach_prospects_inbox_referral_status_idx
  on public.outreach_prospects ((enrichment_data -> 'inbox_referral' ->> 'status'))
  where enrichment_data ? 'inbox_referral';

-- Same guard as inbox_set_referral_guarded, plus: a save for the same handoff keeps what the operator did
-- (the referred lead link, a dismissal). A research run that started before the operator acted must not
-- erase the link and offer the person again.
create or replace function public.inbox_set_referral_v2(p_prospect uuid, p_referral jsonb, p_keep_verified boolean, p_expected_input text)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
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
revoke all on function public.inbox_set_referral_v2(uuid, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.inbox_set_referral_v2(uuid, jsonb, boolean, text) to service_role;

-- Inbound replies after the handoff (same set the app and handler read: text present, later than the handoff).
create or replace function public.inbox_referral_later_ids(p_referrer uuid, p_input_message uuid)
returns text[]
language sql stable
set search_path to 'public'
as $function$
  select coalesce(array_agg(m.id::text order by m.id::text), '{}')
  from inbox_messages_v m, inbox_messages_v h
  where h.id = p_input_message and h.prospect_id = p_referrer
    and m.prospect_id = p_referrer and m.direction = 'inbound' and m.id <> h.id
    and nullif(btrim(m.message_text), '') is not null
    and (coalesce(m.sent_at, m.created_at), m.created_at) >= (coalesce(h.sent_at, h.created_at), h.created_at)
$function$;
revoke all on function public.inbox_referral_later_ids(uuid, uuid) from public, anon, authenticated;
grant execute on function public.inbox_referral_later_ids(uuid, uuid) to service_role;

-- The stored check read exactly the replies there are now, and it said go.
create or replace function public.inbox_referral_later_ok(p_referrer uuid, ref jsonb)
returns boolean
language sql stable
set search_path to 'public'
as $function$
  select coalesce(ref -> 'later' ->> 'verdict' = 'go'
    and (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(ref -> 'later' -> 'message_ids') x)
        = inbox_referral_later_ids(p_referrer, (ref ->> 'input_message_id')::uuid), false)
$function$;
revoke all on function public.inbox_referral_later_ok(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.inbox_referral_later_ok(uuid, jsonb) to service_role;

-- The operator chose not to contact the referred person. Closes the card for good.
create or replace function public.inbox_referral_dismiss(p_referrer uuid, p_input_message uuid)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
begin
  -- inbox_referral_dismissed keeps every dismissed handoff, so a later save of another handoff cannot revive it.
  update outreach_prospects
     set enrichment_data = enrichment_data || jsonb_build_object(
           'inbox_referral', (enrichment_data -> 'inbox_referral') || jsonb_build_object('dismissed_at', now()),
           'inbox_referral_dismissed', coalesce(enrichment_data -> 'inbox_referral_dismissed', '[]'::jsonb) || to_jsonb(p_input_message::text))
   where id = p_referrer
     and enrichment_data -> 'inbox_referral' ->> 'input_message_id' = p_input_message::text
     and nullif(enrichment_data -> 'inbox_referral' ->> 'lead_prospect_id', '') is null;
  return found;
end $function$;
revoke all on function public.inbox_referral_dismiss(uuid, uuid) from public, anon, authenticated;
grant execute on function public.inbox_referral_dismiss(uuid, uuid) to service_role;

-- "Create referred lead": one ARCH prospect for the referred person plus ONE held LinkedIn first touch
-- (approved_at null, sent_at null; the column default would stamp a fake send). Dedupes on the normalized
-- profile (li_slug / member id) across every tenant first, because linkedin_url UNIQUE compares raw strings.
-- An existing ARCH row is linked instead of copied. Another tenant's row, an earlier email to the person, a
-- probable namesake row or a reply newer than the one the caller checked stops it. Never approves or sends.
create or replace function public.inbox_referral_create_lead(p_referrer uuid, p_input_message uuid, p_revision integer, p_expected_url text, p_later_ids text[], p_lead jsonb, p_text text, p_evidence jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
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
  if slug is null or li_slug(ref ->> 'linkedin_url') is distinct from slug then
    return jsonb_build_object('status', 'error', 'reason', 'The LinkedIn profile does not match the referral.');
  end if;
  if nullif(btrim(p_text), '') is null or length(btrim(p_text)) > 300 then
    return jsonb_build_object('status', 'error', 'reason', 'The invite note must be 1 to 300 characters.');
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
    values (msg, lead, 'outbound', 'linkedin', 'connection_note', btrim(p_text), 'inbox_referral_lead_v1', null,
        -- sent_at defaults to now() at the column level: null keeps this a held draft.
        null, null, p_evidence || jsonb_build_object('v', 'inbox_referral_lead_v1', 'referrer_prospect_id', p_referrer,
          'referral_input_message_id', p_input_message, 'referral_revision', p_revision));
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
  return jsonb_build_object('status', 'created', 'lead_prospect_id', lead, 'message_id', msg);
end $function$;
revoke all on function public.inbox_referral_create_lead(uuid, uuid, integer, text, text[], jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.inbox_referral_create_lead(uuid, uuid, integer, text, text[], jsonb, text, jsonb) to service_role;

-- The referrer wrote again while the staged invite waits for Send: store the model's read, and on a hold or
-- redirect take the invite back to review (never once it is sent).
create or replace function public.inbox_referral_lead_later(p_referrer uuid, p_input_message uuid, p_later jsonb)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
declare ref jsonb;
begin
  select enrichment_data -> 'inbox_referral' into ref from outreach_prospects where id = p_referrer for update;
  if ref ->> 'input_message_id' is distinct from p_input_message::text or nullif(ref ->> 'lead_message_id', '') is null then return false; end if;
  -- A read of an older set of replies is stale: the next run reads the current set.
  if (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(p_later -> 'message_ids') x)
     is distinct from inbox_referral_later_ids(p_referrer, p_input_message) then return false; end if;
  update outreach_prospects set enrichment_data = enrichment_data || jsonb_build_object('inbox_referral', ref || jsonb_build_object('later', p_later))
   where id = p_referrer;
  if p_later ->> 'verdict' = 'go' then
    -- "Go ahead after all": a hold this check put on the invite is lifted back to an unapproved draft (Send still decides).
    update outreach_messages set send_blocked_at = null, send_blocked_reason = null
     where id = (ref ->> 'lead_message_id')::uuid and ai_model = 'inbox_referral_lead_v1' and sent_at is null
       and send_blocked_reason like 'referral_paused:%' and send_blocked_reason <> 'referral_paused: a newer handoff replaced this referral';
  else
    update outreach_messages
       set approved_at = null, send_blocked_at = now(),
           send_blocked_reason = left('referral_paused: ' || coalesce(p_later ->> 'quote', 'the referrer wrote again'), 300)
     where id = (ref ->> 'lead_message_id')::uuid and ai_model = 'inbox_referral_lead_v1' and sent_at is null
       -- Never over an operator's discard or another hold.
       and (send_blocked_at is null or send_blocked_reason like 'referral_paused:%');
  end if;
  return true;
end $function$;
revoke all on function public.inbox_referral_lead_later(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.inbox_referral_lead_later(uuid, uuid, jsonb) to service_role;

-- Guard for anything that reaches a referred person (the staged invite, the referral email): approval AND the
-- sender's claim (sent_at stamped) are refused while a reply from the referrer after the handoff is unread, the read
-- says hold or redirect, the referral was dismissed, or the stored referral is now a different handoff. A refused
-- claim makes the sender skip the row (its claim catch continues); a hold read later takes approval back.
create or replace function public.inbox_referral_send_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ref jsonb;
  referrer uuid;
  handoff text;
begin
  if new.direction is distinct from 'outbound' then return new; end if;
  -- A claim needs the row as approved and unheld right now: another sender run may hold a cached copy of a row
  -- whose approval was withdrawn meanwhile.
  if tg_op = 'UPDATE' and old.sent_at is null and new.sent_at is not null
     and (old.approved_at is null or old.send_blocked_at is not null or old.send_blocked_reason is not null) then
    raise exception 'This referral draft is not approved any more.';
  end if;
  if new.ai_model = 'inbox_referral_lead_v1' then
    referrer := nullif(new.draft_evidence ->> 'referrer_prospect_id', '')::uuid;
  elsif new.ai_model = 'inbox_referral_email_v1' then
    referrer := new.prospect_id;
  else
    return new;
  end if;
  handoff := new.draft_evidence ->> 'referral_input_message_id';
  select enrichment_data -> 'inbox_referral' into ref from outreach_prospects where id = referrer;
  if ref is null or handoff is null or ref ->> 'input_message_id' is distinct from handoff then
    raise exception 'This referral changed since the draft was made. Open the referrer''s conversation first.';
  end if;
  if ref ->> 'dismissed_at' is not null then
    raise exception 'This referral was dismissed.';
  end if;
  if not inbox_referral_later_ok(referrer, ref) then
    raise exception 'The referrer wrote again after this referral and it is not read yet, or it pauses the referral. Open their conversation, then try again.';
  end if;
  return new;
end $function$;
create trigger inbox_referral_send_guard_approve before update of approved_at on public.outreach_messages
  for each row when (new.ai_model in ('inbox_referral_lead_v1', 'inbox_referral_email_v1') and new.approved_at is not null and old.approved_at is null and new.sent_at is null)
  execute function public.inbox_referral_send_guard();
create trigger inbox_referral_send_guard_claim before update of sent_at on public.outreach_messages
  for each row when (new.ai_model in ('inbox_referral_lead_v1', 'inbox_referral_email_v1') and old.sent_at is null and new.sent_at is not null)
  execute function public.inbox_referral_send_guard();

-- Warm-up: new handoff-like replies (any inbound of the last 45 minutes, not only the newest), and open
-- verified referrals that need a redraft (older revision) or a read of a reply that came after them.
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
          or substring(regexp_replace(l.message_text, $title$,[[:space:]]*(our|my|the|their)[[:space:]]+[[:alpha:]][[:alpha:] &’'-]{0,80},$title$, ' ', 'gi') from '(?i)([[:alpha:]][[:alpha:]''-]*(?:\s+[[:alpha:]][[:alpha:]''-]*){0,3})\s+(?:handles?|does|manages?|runs?|looks after|is responsible for|is in charge of)\M')
             !~* '\m(i|we|you|he|she|they|it)\M'
          or exists (
            select 1
            from regexp_matches(l.message_text, $url$https?://[^\s<>()\[\]"']+$url$, 'gi') as links(parts)
            where regexp_replace(parts[1], '[.,;:!?]+$', '') ~*
              '^https://([a-z]{2,3}\.)?linkedin\.com/in/[[:alnum:]_%-]+/?([?#].*)?$'
          ))
        -- Skip what the handler would serve from cache (same message, revision 13), and a thread whose
        -- open referral already read the newest reply.
        and not coalesce((p.enrichment_data -> 'inbox_referral' ->> 'input_message_id') = l.id::text
                         and (p.enrichment_data -> 'inbox_referral' ->> 'revision') = '13', false)
        and not coalesce((p.enrichment_data -> 'inbox_referral' -> 'later' ->> 'through_message_id') = x.id::text
                         and (p.enrichment_data -> 'inbox_referral' ->> 'revision') = '13', false)
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
        and (p.enrichment_data -> 'inbox_referral' ->> 'status') = 'verified'
        and (nullif(p.enrichment_data -> 'inbox_referral' ->> 'lead_prospect_id', '') is null
             or exists (select 1 from outreach_messages lm where lm.id::text = p.enrichment_data -> 'inbox_referral' ->> 'lead_message_id'
                          and lm.sent_at is null and (lm.send_blocked_at is null or lm.send_blocked_reason like 'referral_paused:%')))
        and p.enrichment_data -> 'inbox_referral' ->> 'dismissed_at' is null
        and not coalesce(p.blacklisted, false)
        and p.stage not in ('archived', 'skipped', 'disqualified', 'unsubscribed', 'blacklisted')
        and coalesce(a.sent_at, a.created_at) > now() - interval '60 days'
        and ((p.enrichment_data -> 'inbox_referral' ->> 'revision') is distinct from '13'
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
