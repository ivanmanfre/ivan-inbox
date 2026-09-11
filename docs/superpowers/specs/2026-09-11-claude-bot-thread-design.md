# Claude bot thread — agent-initiated turns in the inbox Ask pane

Date: 2026-09-11 · Status: design approved in chat (Ivan, option A "judged batches on a clock")

## Why

Ivan (2026-09-11): the system emits events (feed rows, pushes) but never a colleague's message —
"detected X, want me to do Y", "this lead needs a follow-up", "this run failed". He does NOT want
a morning triage and does NOT want new pushes: "stuff I'd like to receive I already receive (low
sends, relevant errors)". He wants the rest silent, in a chat, from a proper bot he can talk back to.
Feed and bell stay ("keep both").

## Non-goals

- No change to push policy (`_shared/notify.ts` PUSH_DEFAULT untouched).
- No feed or bell removal. No morning brief of any kind.
- The bot never sends anything external and never writes to prospect/client/content tables.

## Double-notification rules (hold in every part of this design)

1. A bot turn writes NO `inbox_notifications` row and NEVER pushes.
2. Every feed row the bot read is stamped `read_at` and `group_key = 'bot:<turn_id>'` on success.
   The bell drops by exactly those rows; the feed shows them folded under the bot message.
3. Existing event pushes (booking_notice, send_failed_alert, system_infra_alarm, lane_supply_alarm,
   the DB-trigger DM push) are not touched.

## 1. Data model (migration `db/060_bot_thread.sql`, new objects/columns only)

| object | change |
|---|---|
| `inbox_threads` | `kind text not null default 'ask' check (kind in ('ask','bot'))`; `bot_seen_at timestamptz` |
| `inbox_turns` | `origin text not null default 'operator' check (origin in ('operator','bot'))` |
| `inbox_notifications` | no schema change; `group_key` carries `bot:<turn_id>` |
| views | `inbox_threads_v` + `inbox_turns_v` expose the new columns (CREATE OR REPLACE, columns at the END) |
| grants | `authenticated` may UPDATE `inbox_threads.bot_seen_at` on its own rows — the third narrow browser write (after turn abort and notification read/dismiss). Nothing else. |
| `integration_config` | `bot_tick_enabled` (born-dead, `'false'`), `bot_daily_turn_cap` (`'24'`) |
| `content_prompts` | slug `inbox-bot-brief`, scope ivan — the bot's standing instruction (canonical home for prompts) |

One bot thread per user: the tick creates it on first run (`kind='bot'`, title "Claude"). Exactly one:
partial unique index on `(user_id) where kind='bot'`.

Thread unread = `last_turn_at > coalesce(bot_seen_at, 'epoch')` for the bot thread.

## 2. The tick (`supabase/functions/inbox-bot-tick`)

- Trigger: `cron.schedule('inbox-bot-tick', '*/30 * * * *', …)` → `net.http_post` with `x-inbox-secret`
  (same auth shape as `inbox-morning-push`). Deployed `--no-verify-jwt` for that reason.
- Gate: `bot_tick_enabled = 'true'` else log `{bot_tick:'disabled'}` and exit. Daily cap: count of
  bot-origin turns since 00:00 UTC ≥ cap → exit `{bot_tick:'capped'}`.
- Select: `inbox_notifications` where `read_at is null and dismissed_at is null and family not in
  (mute list)`, newest 200, ordered `created_at`. Mute list (constant in the function, one place):
  `chat`, `claude_turn`, `health_reminder`. Zero rows → exit `{bot_tick:'quiet'}`. No turn.
- A running bot turn on the thread → exit `{bot_tick:'busy'}` (the broker already answers 409
  `thread_busy`; check first so we never stamp rows for a turn that will not start).
- Mint `turn_id` (uuid). Stamp the selected rows `group_key = 'bot:<turn_id>'` BEFORE the turn
  starts. The select excludes any row whose `group_key` points at a bot turn still in
  (`queued`,`running`), so a slow turn cannot have its rows re-selected; rows whose turn ended in
  `error` are eligible again.
- Prompt = the bundle: one line per row `[family · severity · tenant · count×] title — body (url)`,
  plus the last bot answer's first 300 chars ("what you said last time", so it does not repeat).
  The standing instruction comes from `content_prompts` slug `inbox-bot-brief` and is passed as the
  container's `append_system_prompt` for this turn (the broker already passes one; the bot's is
  appended after it).
- Call the broker `inbox-claude` through a NEW server door: header `x-inbox-secret` instead of a JWT
  → user = `INBOX_CLAUDE_ALLOWED_USER_ID`, `thread_id` = bot thread, `turn_id` = minted,
  `origin:'bot'`, `allowed_tools` = read-only allowlist (see §3). Everything else in the broker is
  byte-identical: envelope/delta, session resume, row write, stream relay (the tick does not read the
  stream; it returns after the broker accepted the turn — the ROW is the truth, `inbox-turn-run`
  finishes it).
- `inbox-turn-run` on completion of an `origin='bot'` turn: (a) SKIP the `claude_turn` notify call
  (rule 1); (b) on `status='done'` stamp `read_at = now()` on rows with `group_key = 'bot:<turn_id>'`
  (rule 2); on `error`, leave `read_at` null → the next tick re-selects them (their group_key points
  at a finished turn, so the exclusion above does not hold them).

Cost: ≤ 1 Ask-sized turn per 30 min of activity; quiet hours cost nothing; hard cap 24/day.

## 3. What the bot may do

- Container call carries `allowed_tools: ["Read","Grep","Glob","Bash(curl:*)"]`; the container's
  `main.py` already forwards `allowed_tools` as `--allowedTools`. Write tools (Edit/Write/Agent) are
  off at the CLI boundary. `curl` is the DB read path and the allowlist cannot tell GET from POST,
  so the standing instruction forbids writes and week one reviews every bot turn's `tool_events`
  for a non-GET call; one observed write upgrades this to a dedicated read-only query helper.
- Actions block: the answer ENDS with a fenced block
  ```actions
  [{"label":"…","kind":"open|task|fold|reply","payload":{…}}]
  ```
  max 3 items. Kinds and what the app does on tap:
  - `open` `{url}` — navigate (relative `./#…` or https only, same validation as notify).
  - `task` `{title, body?}` — insert `ops_drafts kind='task'` (existing store contract; Ops is his
    task list). Never any other kind.
  - `fold` `{}` — dismiss the rows grouped under this turn (`dismissed_at`, stamped so Undo works).
  - `reply` `{prompt}` — prefill the composer on this thread; nothing runs until he sends.
  Unknown kind, bad url, >3 items, malformed JSON → the block is dropped and the message renders
  without pills (never an error to Ivan). The parser is unit-tested against those cases.
- Anything that touches a prospect, client, copy, or send happens only when Ivan replies and the
  normal operator turn runs it under the existing rules (no DM/outreach copy without his OK, etc.).

## 4. Message contract (`content_prompts` slug `inbox-bot-brief`)

- First person, plain words, addressed to Ivan. Under ~120 words unless a real decision is inside.
- Shape: what changed since last message (grouped by topic, not by row) → what needs him (each with
  a pill) → one line on what it is leaving alone and why. Silence-shaped answer ("Nothing needs you.
  N routine rows folded.") is valid and short.
- Judged against standing rules: decision vs report (reports stay one line), low sends on any seat =
  disaster, never queue him decisions (escalate only his-money / external send / new copy / taste),
  no internal codenames, no inanimate subjects doing actions, no fake precision.
- Never restates a row already folded into an earlier message (it gets the last answer's head).
- No morning ritual, no "good morning", no summary of things that did not happen.

## 5. UI (phone first; direction B "Ledger" stays the floor)

- Ask tab thread list: the bot thread pinned first, titled "Claude", lime unread dot when
  `last_turn_at > bot_seen_at`. Opening it stamps `bot_seen_at`.
- Bot turns render as INCOMING bubbles (left); the bundle (turn.prompt) collapses to an "N events"
  chip that expands to the rows (title + time, tap → the row's url). Action pills under the bubble.
  Operator turns on the same thread render as today.
- Feed: a row with `group_key like 'bot:%'` shows a small "in chat" mark; tap jumps to
  `#…/ask?thread=<bot>&turn=<id>`. Nothing else in the feed changes.
- The composer on the bot thread is the normal Ask composer (same model picker, same session).

## 6. Gates (real table, real container — never fixtures)

1. Seed 3 rows (`inbox-notify`, feed-only families) → run tick → exactly 1 bot turn, status done;
   the 3 rows have `read_at` + `group_key='bot:<id>'`; bell count −3; `inbox_notifications` row
   count unchanged by the turn; `push_subscriptions` deliveries = 0 (`push_result` null on all
   three, no `claude_turn` row).
2. Empty tick → `{bot_tick:'quiet'}`, no thread turn, no row change.
3. Forced-error turn (bad model id) → rows keep `read_at` null → next tick re-selects them.
4. Tick during a running bot turn → `busy`, rows untouched.
5. Actions parser: valid 3 / unknown kind / bad url / 4 items / broken JSON → only the first renders pills.
6. `bot_seen_at` write from the browser succeeds on own thread, fails on another user id (RLS).
7. Daily cap: 24 bot turns present → `capped`.
8. Watch-first on Ivan's iPhone for one day with the flag on: one bot message per active half hour at
   most, zero extra buzzes, feed rows folded. Then the flag stays on.
9. "Empty result over a known-non-empty set = failure" applies to every gate above.

## Risks named

- A cron-started turn with write tools is the one real hazard → write tools off at the container
  boundary; the residual (curl POST) is prompt-bound and audited in week one (see §3).
- Two ticks overlapping → group_key-on-running-turn exclusion + `busy` exit.
- The broker's new server door must fail closed exactly like the JWT door (missing secret, wrong
  operator id, unparseable body) — copy the runner-dispatch fail-closed checks.
- Chattiness → the 30-min clock plus "silence is valid" plus the cap; measure messages/day in the
  first week and mute families at the tick if a family is wallpaper.

## Files touched (expected)

`db/060_bot_thread.sql` · `supabase/functions/inbox-bot-tick/index.ts` (new) ·
`supabase/functions/inbox-claude/index.ts` (server door, origin, allowed_tools passthrough) ·
`supabase/functions/inbox-turn-run/index.ts` (bot-origin skip + read_at fold) ·
`src/lib/turns.ts` (types, bot_seen_at write, pinned thread query) · Ask thread list + bubble
renderer + actions parser under `src/exp/…/chat` · feed row "in chat" mark · `content_prompts`
row `inbox-bot-brief` · pg_cron schedule + `integration_config` flags.
