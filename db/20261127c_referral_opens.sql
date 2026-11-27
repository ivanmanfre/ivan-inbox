-- 2026-11-27 referral opens (after #232). Two changes, nothing else:
-- 1. inbox_referral_prewarm(): an open referral's seat uses the inbox rule coalesce(c.client_id, 'ivan') (inbox_messages_v),
--    so referrals on Ivan campaigns with a NULL client_id are re-researched like ARCH/RISE ones. Revision literal stays '23'.
-- 2. inbox_referral_send_waits: why Send Messages released an approved referral invite note unsent (RISE invite limit),
--    one row per message, upserted by the sender, read by the referral card. Nothing here sends or approves anything.
begin;
create table if not exists public.inbox_referral_send_waits (
  message_id uuid primary key references public.outreach_messages(id) on delete cascade,
  reason text not null check (length(reason) between 1 and 80),
  detail jsonb,
  seen_at timestamptz not null default now()
);
alter table public.inbox_referral_send_waits enable row level security;
drop policy if exists inbox_referral_send_waits_read on public.inbox_referral_send_waits;
create policy inbox_referral_send_waits_read on public.inbox_referral_send_waits for select to authenticated using (true);
revoke all on public.inbox_referral_send_waits from anon, authenticated;
grant select on public.inbox_referral_send_waits to authenticated;
grant all on public.inbox_referral_send_waits to service_role;

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
      join outreach_campaigns c on c.id = p.campaign_id and coalesce(c.client_id, 'ivan') in ('ivan', 'arch', 'risedtc') -- the inbox_messages_v seat rule (2026-11-27)
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
end $function$

;
commit;
