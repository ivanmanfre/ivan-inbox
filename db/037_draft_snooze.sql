-- 037 — "push this draft to later", the third decision a DM draft needs.
--
-- Ivan, 2026-08-20: "some people just say 'I am travelling', or 'I will be back
-- soon'... I would like to have the option to push this for a few days or weeks."
--
-- Until now the card offered TWO terminal decisions — approve (sends in ~2 min)
-- and discard. Neither says "later", so a travelling prospect got discarded, and
-- 🔴 THAT IS PERMANENT ON THE BUMP LANE: `Outreach - Stalled Conversation Bump`
-- (qCCZhgogk549PP6v) is one-bump-per-prospect-EVER, and it adds a prospect to its
-- ever-skip set at DRAFT time, not at send time. A discarded follow-up is a
-- prospect the lane never touches again. "Later" had to become a real state.
--
-- Two columns, no new table:
--   snoozed_until — when the draft rejoins the pending queue. NULL = not pushed.
--   snoozed_at    — WHEN Ivan pushed it. Load-bearing, not bookkeeping: a snooze
--                   is only live while no inbound message has arrived since it
--                   was set, so a prospect who writes back mid-snooze wakes the
--                   thread immediately (lib/inbox.ts snoozeActive).
--
-- 🔴 THE DISPATCHER IS UNTOUCHED AND MUST STAY THAT WAY. `Outreach - Send
-- Messages` (kFYlfnWd98YaiErH) picks up on `approved_at NOT NULL AND sent_at
-- NULL` and reads neither column (docs/send-path-verification.md). A snoozed
-- draft still has approved_at NULL, so it is unsendable by construction — the
-- hiding is a UI concern only and no send path depends on it. This is why snooze
-- does NOT reuse send_blocked_at/send_blocked_reason: those mean "discarded, for
-- good" (lib/inbox.ts approveDraft refuses a row that carries a block reason),
-- and overloading them would make "later" indistinguishable from "never".
--
-- Triggers checked before writing (both are safe — neither sees these columns):
--   trg_dm_dupe_guard_upd — BEFORE UPDATE **OF sent_at**, only on NULL -> NOT NULL.
--   trg_inbox_push        — AFTER **INSERT**, and only for direction='inbound'.
-- Grants are table-level for `authenticated`, so no column grant is needed.
--
-- Rollback:
--   (re-run the view block below without the two m.snoozed_* lines, then)
--   alter table public.outreach_messages drop column if exists snoozed_until;
--   alter table public.outreach_messages drop column if exists snoozed_at;

alter table public.outreach_messages
  add column if not exists snoozed_until timestamptz,
  add column if not exists snoozed_at timestamptz;

comment on column public.outreach_messages.snoozed_until is
  'Operator pushed this pending draft to later; it rejoins the inbox queue at this time. NULL = not pushed. Never read by the dispatcher.';
comment on column public.outreach_messages.snoozed_at is
  'When the push was set. A snooze is void once an inbound message arrives after it.';

-- CREATE OR REPLACE (not drop+create) so the existing grants and the
-- security_invoker reloption survive untouched — a rebuilt view is the
-- authed-empty hazard (memory: authed-empty-storage-rls-post-stills). The body
-- below is the LIVE pg_get_viewdef output verbatim, with two columns appended.
create or replace view public.inbox_messages_v with (security_invoker = on) as
select
  m.id, m.prospect_id, m.direction, m.message_text, m.message_type,
  coalesce(m.channel, 'linkedin') as channel,
  m.sent_at, m.approved_at, m.read_at, m.created_at,
  m.send_blocked_at, m.send_blocked_reason, m.unipile_chat_id, m.ai_model,
  p.name as prospect_name, p.company as prospect_company,
  p.headline as prospect_headline, p.stage as prospect_stage,
  p.email as prospect_email, p.profile_photo_url,
  c.name as campaign_name,
  coalesce(c.client_id, 'ivan') as client_id,
  m.snoozed_until, m.snoozed_at
from outreach_messages m
join outreach_prospects p on p.id = m.prospect_id
join outreach_campaigns c on c.id = p.campaign_id;
