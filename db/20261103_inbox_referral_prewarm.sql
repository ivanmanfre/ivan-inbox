-- Research a named referral ("you need to talk with Larissa Vieira") as soon as the reply lands,
-- so the inbox referral card is ready when it is opened instead of researching on open.
-- Case 2026-11-03: Núria/Wildlife referral arrived 20:50 UTC, research only ran at 22:17 when
-- Ivan opened the card, so he saw a spinner and the reply drafter's "still unclear" note.
--
-- The regex is a pre-filter mirroring referralCandidate(); inbox-dm-draft re-checks and returns
-- {referral:null} (no model call) for anything that is not a handoff. A finished research run is
-- cached on enrichment_data.inbox_referral (input_message_id + revision 3), so it runs once.
-- The 45-minute window bounds retries of a failed run to ~9; newest first, 20 per tick.
-- The card's own Retry still works.
-- Server door: x-inbox-secret = INBOX_PUSH_SECRET, referral mode only, never retry (index.ts).

-- Atomic save guard for the race between the warm-up and a card open on the same message.
-- With p_keep_verified, a non-verified result never replaces a verified revision-3 result for the
-- same message. The row lock makes the second writer re-check against the first writer's save.
-- The original 2-argument inbox_set_referral stays as is (the deployed function version uses it).
create or replace function public.inbox_set_referral_guarded(p_prospect uuid, p_referral jsonb, p_keep_verified boolean)
returns boolean language plpgsql security invoker set search_path = public as $f$
begin
  update outreach_prospects
     set enrichment_data = case
       when p_keep_verified and coalesce(p_referral ->> 'status', '') <> 'verified'
        and enrichment_data -> 'inbox_referral' ->> 'input_message_id' = p_referral ->> 'input_message_id'
        and enrichment_data -> 'inbox_referral' ->> 'revision' = '3'
        and enrichment_data -> 'inbox_referral' ->> 'status' = 'verified'
       then enrichment_data
       else coalesce(enrichment_data, '{}'::jsonb) || jsonb_build_object('inbox_referral', p_referral) end
   where id = p_prospect;
  return found;
end $f$;
revoke all on function public.inbox_set_referral_guarded(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.inbox_set_referral_guarded(uuid, jsonb, boolean) to service_role;

create or replace function public.inbox_referral_prewarm() returns integer
language plpgsql security definer set search_path = public as $$
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
      -- Skip only what the handler would serve from cache (same message, revision 3).
      and not coalesce((p.enrichment_data -> 'inbox_referral' ->> 'input_message_id') = l.id::text
                       and (p.enrichment_data -> 'inbox_referral' ->> 'revision') = '3', false)
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
end $$;

revoke all on function public.inbox_referral_prewarm() from public, anon, authenticated;

-- Off the quarter-hour so it never stacks on the heavy jobs (cron pile-up 2026-10-20).
select cron.schedule('inbox-referral-prewarm', '2-59/5 * * * *', 'select public.inbox_referral_prewarm()');
