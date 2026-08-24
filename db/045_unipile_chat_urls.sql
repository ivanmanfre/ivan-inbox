-- 045: the DM carries its CHAT url, not a profile url.
--
-- Ivan, 2026-08-24, rejecting 044: "I ask you for the chat URL, the chat URL, so Mattan
-- can directly open the chat. That's the fucking need."
--
-- 044 shipped the profile link on the premise that no thread URL was derivable. That was
-- wrong. `outreach_messages.unipile_chat_id` is a Unipile id (`j6k84xrlXBGSk4vs4Kcxkw`)
-- and resolves to nothing on linkedin.com — but the Unipile CHAT OBJECT behind that id
-- also carries `provider_id`, which is LinkedIn's own conversation id:
--
--   chat j6k84xrlXBGSk4vs4Kcxkw (Evan T.)
--     -> provider_id 2-YjU4NGNhZmYtNmIxYy00MTMzLWIzMGQtMTIxNmMxMGUyYzQ3XzEwMA==
--     -> https://www.linkedin.com/messaging/thread/2-YjU4NGNhZmYt…XzEwMA==/
--
-- unipile_chats mirrors that map so the inbox — a static site holding no API key — builds
-- the link with no network call at click time. Fed by the `sync-unipile-chats` edge
-- function (cron `sync-unipile-chats-hourly`, 17 * * * *), backfilled 2026-08-24 from
-- all three connected LinkedIn seats.
--
-- TWO WAYS IN, because one is not enough. `unipile_chat_id` is only stamped on the rows
-- that rode that chat — a pending draft has none, and Evan's newest row had none — so the
-- view ALSO matches on `attendee_provider_id` (the prospect's member urn), which recovers
-- 69 threads the chat id alone would have missed.
--
-- Coverage on the 2,556 inbox threads: 874 of the 909 that have a real conversation
-- resolve to a thread URL (96%). The other 1,647 are invite-only — no LinkedIn chat
-- exists yet — and fall back to the profile link, labelled "copy profile" so a fallback
-- is never handed over looking like a chat.

create table if not exists public.unipile_chats (
  chat_id text primary key,
  provider_id text not null,          -- LinkedIn conversation id, `2-<base64>==`
  account_id text,                    -- which seat holds the chat
  attendee_provider_id text,          -- the other party's member urn, `ACoAA…`
  resolved_at timestamptz not null default now()
);

-- RLS on from birth. The inbox view is security_invoker, so the app's own authenticated
-- role needs a read policy; service_role (n8n, the edge function) bypasses regardless.
alter table public.unipile_chats enable row level security;
grant select on public.unipile_chats to authenticated;
grant all on public.unipile_chats to service_role;
drop policy if exists authenticated_read on public.unipile_chats;
create policy authenticated_read on public.unipile_chats for select to authenticated using (true);
drop policy if exists service_role_all on public.unipile_chats;
create policy service_role_all on public.unipile_chats for all to service_role using (true) with check (true);

create index if not exists unipile_chats_provider_idx on public.unipile_chats (provider_id);
-- Load-bearing: the view's lateral joins on this column once per message row.
create index if not exists unipile_chats_attendee_idx on public.unipile_chats (attendee_provider_id);

-- Body identical to 044 except the appended final column. CREATE OR REPLACE keeps the
-- grants (anon + authenticated hold SELECT) and security_invoker=on, and the new column
-- goes LAST so every existing column keeps its name, type and position.
create or replace view public.inbox_messages_v with (security_invoker = on) as
 SELECT m.id,
    m.prospect_id,
    m.direction,
    m.message_text,
    m.message_type,
    COALESCE(m.channel, 'linkedin'::text) AS channel,
    m.sent_at,
    m.approved_at,
    m.read_at,
    m.created_at,
    m.send_blocked_at,
    m.send_blocked_reason,
    m.unipile_chat_id,
    m.ai_model,
    p.name AS prospect_name,
    p.company AS prospect_company,
    p.headline AS prospect_headline,
    p.stage AS prospect_stage,
    p.email AS prospect_email,
    p.profile_photo_url,
    c.name AS campaign_name,
    COALESCE(c.client_id, 'ivan'::text) AS client_id,
    m.snoozed_until,
    m.snoozed_at,
    p.linkedin_url AS prospect_linkedin_url,
    COALESCE(uc.provider_id, ua.provider_id) AS chat_provider_id
   FROM outreach_messages m
     JOIN outreach_prospects p ON p.id = m.prospect_id
     JOIN outreach_campaigns c ON c.id = p.campaign_id
     LEFT JOIN unipile_chats uc ON uc.chat_id = m.unipile_chat_id
     LEFT JOIN LATERAL (
       SELECT x.provider_id FROM unipile_chats x
       WHERE x.attendee_provider_id IS NOT NULL
         AND x.attendee_provider_id = p.linkedin_profile_id
       LIMIT 1
     ) ua ON true;
