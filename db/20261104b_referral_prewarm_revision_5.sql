-- Referral drafts moved to revision 5 (short, question-led first touch; no offer line). The warm-up
-- skips only what the handler serves from cache, so it must match the handler revision.
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
    with last_in as (
      -- Same latest-inbound rule as the handler and the app: message time, then import order.
      select distinct on (m.prospect_id) m.id, m.prospect_id, m.message_text, coalesce(m.sent_at, m.created_at) as at
      from inbox_messages_v m
      where m.direction = 'inbound' and m.client_id in ('ivan', 'arch', 'risedtc')
        and nullif(btrim(m.message_text), '') is not null
        and coalesce(m.sent_at, m.created_at) > now() - interval '7 days'
      order by m.prospect_id, coalesce(m.sent_at, m.created_at) desc, m.created_at desc, m.id desc
    )
    select l.prospect_id
    from last_in l
    join outreach_prospects p on p.id = l.prospect_id
    where l.at > now() - interval '45 minutes'
      and not coalesce(p.blacklisted, false)
      and p.stage not in ('archived', 'skipped', 'disqualified', 'unsubscribed', 'blacklisted')
      -- Mirrors referralCandidate(): a handoff to someone other than the two people in the thread
      -- and not an email address, or "<Name> handles ..." with no pronoun in the subject words.
      -- So "talk to you soon", "contact larissa@x.com" and "she already handles it" never take a slot.
      and (l.message_text ~* '\m(speak(ing)?|talk(ing)?|reach(ing)? out|connect(ing)?|check(ing)?)\s+(to|with)\s+(?!(me|us|you|him|her|them)\M)(?!\S*@\S+\.[a-z]{2,})\S|\mcontact(ing)?\s+(?!(me|us|you|him|her|them)\M)(?!\S*@\S+\.[a-z]{2,})\S'
        or substring(l.message_text from '(?i)([[:alpha:]][[:alpha:]''-]*(?:\s+[[:alpha:]][[:alpha:]''-]*){0,3})\s+(?:handles?|does|manages?|runs?|looks after|is responsible for|is in charge of)\M')
           !~* '\m(i|we|you|he|she|they|it)\M')
      -- Skip only what the handler would serve from cache (same message, revision 5: short question-led drafts, 2026-11-04).
      and not coalesce((p.enrichment_data -> 'inbox_referral' ->> 'input_message_id') = l.id::text
                       and (p.enrichment_data -> 'inbox_referral' ->> 'revision') = '5', false)
    order by l.at desc
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
