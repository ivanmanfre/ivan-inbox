# Phase 5 - the AI pass, and the one item in it that is not AI

Branch `polish/ai`, worktree `ivan-inbox-pw-ai`, merged from `wb/polish` at `b11f543` plus the
scheduling merge. Baseline before any of this: `npm run build` clean, **934 passing** with the one
known pre-existing `calendarItems.test.ts` failure. After: **968 passing**, same single failure,
build clean.

Ivan's ask: *"you are free to suggest other ai improvements that would make this even better i mean
the whole inbox experience"*. The defect that answers it was already on disk: the Claude pane is a
general chat sitting beside a workbench and knowing nothing about it. It knew one string, the
prospect name of whatever peer was docked (`Shell.tsx` `aboutLabel`), and shipped it as the sentence
*"The operator is looking at: X"*.

---

## Attempted writes: 0. Paid model calls that reached a vendor: 0.

`after/ai-probe.mjs`, run authed against real rows through Ivan's own session.

| gate | result |
|---|---|
| REST writes attempted (`PATCH`/`DELETE`/`PUT`/non-rpc `POST`) | **0** |
| RPC calls attempted | **0** |
| Model calls that reached a vendor | **0** |
| Model calls attempted and intercepted | 1, and only after a deliberate click |
| Model calls fired by rendering a list of 10 waiting conversations | **0** (`paidBeforeClick: 0`) |

Three interceptors are installed before the first navigation: the plain write route, the RPC route
registered second so playwright matches it first, and **the edge-function origin**
(`**/functions/v1/**`). The pre-read was therefore exercised end to end, through its real fetch, its
real SSE parser and its real sanitiser, against a canned Anthropic stream. Nothing was billed.

The canned stream deliberately carries a `<<ESCALATE: …>>` line, because the deployed `inbox-fast`
system prompt can emit one and the probe should prove the sanitiser strips it rather than assume it.
The rendered line came back as `Wants pricing for the done-for-you lane · not stated · Ivan owes them
a number`, with no machine token in it.

`no-internals.mjs` re-run against this build: **PASS, 0 hits**, unchanged from the label purge.

---

## THE SEND BOUNDARY, traced feature by feature

The boundary itself, from `docs/send-path-verification.md:5`: one dispatcher,
`Outreach - Send Messages`, polls every two minutes on the predicate
**`approved_at IS NOT NULL AND sent_at IS NULL`**. Exactly two functions in this app write
`approved_at` on an outbound row: `inbox.ts:632 approveDraft` and `inbox.ts:840 composeReply`. That
pair is the boundary. Everything below is traced to it.

`grep -n "approveDraft\|composeReply\|\.insert(\|\.update(\|\.upsert(\|\.delete(\|\.rpc(" ` over
every file this phase created returns **nothing**.

### 1. The context strip

```
ChatPane SeeStrip (render only)
  -> paneContext.buildSeeBlock()          pure string builder, opens no request
  -> chat.send(prompt, about, seeBlock)   useChat.ts
  -> buildContext()                        prose
  -> chat/transport.ts
  -> supabase/functions/inbox-claude       the existing broker, unchanged by this run
STOPS HERE. The block is an argument to a conversation. Nothing downstream of
buildSeeBlock touches outreach_messages, and the pane had this exact transport
before this phase; what changed is what rides in the prompt, not where it goes.
```

The strip reads `commandStore` and props. It writes React state and nothing else.

### 2. The thread pre-read

```
row chip onClick
  -> usePreRead.run()                      the ONLY caller; there is no effect in the file
  -> fetch(/functions/v1/inbox-fast)       existing function, undeployed and unmodified by this run
  -> Anthropic messages stream
  -> parsePreRead()                        strips <<...>> spans, one line, capped at 200 chars
  -> React state -> the row's own preview line
STOPS HERE. The line is never written to a row, never offered as a reply, and
never lands in a field that a send path reads. inbox-fast's own header comment
records that it "never touches Supabase data, never runs tools"; its only
Supabase call is auth.getUser on the caller's JWT.
```

Three spending guards, because the alternative is a bill: one call in flight at a time; a session
cap of 40; and a `done` result short-circuits, so a second click is free. The control is only offered
on threads whose newest message is inbound, which is the set the measurement is about.

### 3. Cross-object search

```
CommandLayer debounce
  -> crossSearch()                         three SELECTs, one lane, read only
  -> results rendered in the palette
  -> onPick -> window CustomEvent 'wb-open'
  -> Shell setLane / setJob / setOpenItem | openThread
STOPS HERE. Picking a result OPENS a window. It is the same navigation a click
on the row would have done, and the palette footer now says so in words:
"Opens, never acts".
```

### 4. The extra one, other-lane counts

```
crossSearchOtherLanes() -> head:true count queries -> a number in the palette footnote
STOPS HERE. No row, no id, no title, no body crosses a lane.
```

---

## 1. The pane knows what is on screen

`src/exp/v2c/chat/paneContext.ts` (new, pure, 12 tests), the strip in `ChatPane.tsx`, the subjects
built in `Shell.tsx`, styling in `wbsys.css` §7.

Three subjects, each a removable chip:

- **the lane**, always: *"He is on the DMs screen, in all lanes."*
- **the open conversation**, when a thread is docked beside the pane
- **the open draft**, when the reading window has one
- plus **the selection**, read straight off `commandStore` inside the pane so that pressing `x` on
  twelve rows does not re-render the shell

### What is attached, versus what is merely available

Shallow by default, and the chip says which.

A conversation's shallow form is *"Open conversation with Milan Savov at SmartClick (Ivan, 1b6a0f70,
LinkedIn, DM sent). 5 messages. He replied last. A reply draft is waiting for his approval."* plus
the sentence *"(the texts themselves were not attached)"*. Prospect message bodies travel only when
he switches that one chip to **full text**, and the strip's header sentence changes with it:
*"Claude can see 2 things, 1 with the full text"*.

The **selection has no deep form at all**, by construction. A selection can be fifty rows, and
"send me the bodies of fifty drafts" is not a question anyone asks by accident.

The **open draft is shallow only**, and this is a real limitation rather than a policy: `Shell` holds
the window's queue row (title, state, dates) and not the post body, which lives in the window's own
detail fetch. So the draft chip offers no full-text switch and the block says the text was not
attached rather than implying it was. Wiring the body through would mean editing `DraftPane.tsx`,
which another builder owns this run.

### Making it visible, and turnable off

- Every subject is a named chip with an `✕`. Removing one also forgets that it was opened, so
  re-attaching it comes back shallow rather than silently re-sending a body.
- **Detach all** in one click. The strip then reads *"Claude cannot see your screen"* and
  `buildSeeBlock` returns `undefined`, so nothing about the screen rides with the turn.
- **Show me** prints the exact string that will travel. Not a description of it, the string.
  Measured off the running build in `after/ai-probe.json` (`peekShallow` / `peekDeep` / `peekOff`).
- A retry re-sends the context the ORIGINAL turn carried, not whatever is attached now.

The block is rendered UI, so it obeys the label purge: lanes arrive already named through
`LANE_LABEL`, states go through `lib/labels`, and an id travels in the eight-character short form the
cards already print. `not.toContain('QA_BLOCKED')` is a unit test, not a convention.

The old `ASKING ABOUT Milan Savov` card is now **mobile only**. On desktop the strip says the same
thing and more; keeping both named the same person twice in two registers, one of them shouted.

Screenshots: `after/ai-context-1440.jpg`, `ai-context-full-1440.jpg`, `ai-context-off-1440.jpg`,
`ai-context-390.jpg`. At 390 the strip renders and the page does not scroll sideways
(`mobileStrip.overflow: false`).

## 2. Thread pre-read

`src/exp/v2c/chat/preread.ts` (pure, 9 tests), `usePreRead.ts`, two optional row slots on
`InboxScreen`, supplied by the v2c-only `DmsSurface`.

Measured need: 58 conversations waiting on a reply, median 22.9 days, **36 never opened in this app
at all**. The list gives a name, a company and the first few words of the newest message, which is
not enough to choose which to open.

The control is a `sum up` chip in the row's right-hand column. One click produces one line in three
parts, `what they want · what is blocking · what was promised`, with **"not stated"** for any part
the conversation does not actually say. The prompt forbids the guess in those words.

**Honest when it does not know** is enforced twice: the prompt asks for "not stated", and an empty
answer is reported as *"Nothing came back"* rather than as a confident blank.

**The row height does not move.** This is not cosmetic: `useRowWindow` maps a scroll offset onto a
fixed `ROW_H`, so anything ADDED to a row's vertical box breaks the windowing on a 139-row list. The
generated line therefore stands IN PLACE of the message preview, on the line it already occupies.
Measured: **107px before the click, 107px after**. The line is marked as generated (a lime `✳` and
italics) because a reader who cannot tell a summary from a real message will eventually quote one to
a prospect as the other.

**On demand means on demand.** `pre.run` is reachable from exactly one place, the click handler.
There is no effect, no prefetch, no scroll trigger. The probe asserts it: rendering the DMs list with
8 eligible rows fired **0** calls.

`#exp/stock` passes neither prop. Asserted in `after/ai-stock-parity.json`: 214 rows, **0** pre-read
chips, **0** generated notes, **0** context strips, **0** `data-wblane` attributes, `.snip` still
14.5px and `font-style: normal`.

## 3. Cross-object search

`src/lib/crossSearch.ts` (13 tests), the find section in `CommandPalette.tsx`, the debounce and lane
in `CommandLayer.tsx`, styling in `wbsys.css` §9.

⌘K already exists, so crossing objects went inside it rather than behind a second overlay with a
second shortcut. Two characters and the same query that filters the command list also asks the
database, debounced at 250ms, with a sequence guard so a slow three-letter search cannot repaint the
list over a finished five-letter one.

### Before and after, same counting rule as Step 3 of the evidence

The question: *what did we say to this person and what content have we made about their objection.*

| | interactions | refetches | surfaces |
|---|---|---|---|
| **before** (`usage-evidence.md` T5) | **6+** | 2 | 2, and the content box does not index `post_body`, so the phrase he remembers may not be there at all |
| **after** | **2** to see the answer (⌘K, type), **3** to open one (Enter) | 1, debounced | 1 |

Measured on the live build for the term `margin` on Ivan's lane: **15 results in one list**, 6
conversations, 5 drafts, 4 lead magnets, each with the matched words in context and a badge saying
which surface it came from.

And the one-line slice from the evidence shipped too: `ContentList.tsx` passed
`d => [d.title, d.topic]` to `applySearch` while `post_body` was already selected and already in
memory. On Ivan's lane, `margin` matched **1 draft by title or topic and 5 by body**. Four of five
were invisible to the search box.

### Tenancy, and the query that proves it

The lane is a **required argument with no default**, so there is no code path that runs a filterless
search. Fail-closed: an unrecognised `data-wblane` falls back to Ivan's own lane, never to "all".

The trap that would have made this silently wrong: **the two sides spell Ivan differently.**
`carousel_drafts` and `lm_drafts_v2` write him as `client_id IS NULL`; `inbox_messages_v` writes him
as the literal `'ivan'` (2,863 rows). Content goes through `laneFilter`, DMs through `dmLaneValue`,
and both are unit-tested against the live counts.

Every query the search actually put on the wire, captured by the probe:

```
inbox_messages_v ?client_id=eq.ivan    &or=(prospect_name.ilike.*margin*,prospect_company.ilike.*margin*,message_text.ilike.*margin*)
carousel_drafts  ?client_id=is.null    &or=(title.ilike.*margin*,topic.ilike.*margin*,post_body.ilike.*margin*)
lm_drafts_v2     ?client_id=is.null    &or=(topic.ilike.*margin*,description.ilike.*margin*,post_body.ilike.*margin*)
inbox_messages_v ?client_id=eq.risedtc &or=(...)
carousel_drafts  ?client_id=eq.risedtc &or=(...)
lm_drafts_v2     ?client_id=eq.risedtc &or=(...)
```

Every one carries a `client_id` predicate. The proof that the predicate is complete rather than just
present is that **the lanes partition the unfiltered result with nothing left over**
(GET probes, `evidence/ai-tools/tenancy-probe.md`, term `margin`):

| surface | no lane filter | ivan | risedtc | arch | sum |
|---|---|---|---|---|---|
| DMs | 10 | 9 | 1 | 0 | **10** |
| drafts | 30 | 5 | 25 | 0 | **30** |

9 + 1 + 0 = 10 and 5 + 25 + 0 = 30. There is no fourth bucket for a row to hide in and no leak for
one to arrive from.

A term cannot rewrite its own filter either: `safeTerm` drops `, ( ) " '` before they reach
PostgREST's `or=(…)` list, and strips `% _ * \` so a search for a literal stays a literal. A term
stripped to nothing falls under the two-character floor and never reaches a query.

Constraints honoured: the 1000-row select clamp is never approached (200 and 40), `not.eq` is never
used because it drops NULLs, and no `in()` filter is built, so the 16KB URL ceiling is never near.

## The one extra thing: other lanes answer with a count, never a row

Justified from the measurement, not from imagination. For `margin`, Ivan's lane holds 5 drafts and
Mattan's holds 25. A lane-scoped search that says "5" and stops is technically correct and
practically a dead end, because the 25 are invisible and unhinted, and `usage-evidence.md` 2.3
records the same shape structurally: *"no single screen in this app has ever displayed both piles at
once."*

So the other lanes return **a count and nothing else**: no title, no snippet, no id, no body. A
number and a lane name is a fact about how much work exists, not a row belonging to somebody else.
Clicking it switches the search into that lane, where the rows are then his to read under that lane's
own name. The rule stays intact and the dead end ends.

Live: searching Ivan's lane for `margin` renders *"Also written elsewhere: Mattan Danino has 25"*,
and the probe asserts **0** result rows inside that footnote. Cost: two `head: true` count requests
per search, which return a header and no rows.

---

## Rejected, with the reason

**AI clustering of the errored drafts. Rejected, and it was the obvious thing to build.**
The mission suggested it. It is already solved better without a model: the terminal `agent_log` entry
names the cause deterministically, another builder derives it from that entry, and all 55 rows were
read by hand with the clusters written down in `usage-evidence.md` 2.4 (E1 QA below floor 13, E6 log
says PASS while the row says error 13, E3 lint fail twice 10, E4 genuine stall 6, E2 generation never
returned 6, E7 other 6, E5 a quota refusal captured as content 1). An LLM guessing at what a log
already states is strictly worse: it costs money per row, it can be wrong, and it would replace a
fact with an opinion on the exact 28 rows that are already printing a wrong reason. **A count is not
a finding until you read the rows, and these rows have been read.**

**Anything that drafts a reply anywhere a human does not have to click.** Not built. The pre-read
deliberately produces a SUMMARY and not a draft, and it renders where the preview sits, which is a
read surface with no action on it.

**Bulk anything on the pre-read.** A "sum up all 58" button is one click away from a spending bug and
was never built; the hook refuses a second call while one is in flight.

**A new edge function.** Not added. The pre-read rides `inbox-fast` exactly as deployed, and no file
under `supabase/functions/` was modified by this phase.

**A bare-key shortcut for search.** Not bound. ⌘K already exists and the find section lives inside
it, so the standing ruling is untouched: navigation and selection keys only.

## Semantic search: the honest verdict, and it is a no

**It cannot be done under these constraints, and the keyword search shipped instead.** That is the
answer, not a placeholder.

The reasoning, in the order it kills the idea:

1. **There is no vector to search.** A `select=*&limit=1` column dump of `carousel_drafts`,
   `lm_drafts_v2`, `inbox_messages_v` and `outreach_prospects` (44, 31, 24 and 91 columns
   respectively, listed in `evidence/ai-tools/`) contains **no embedding column and no vector column
   on any of them**. Adding one is a schema change and an applied migration. Both are banned.
2. **Backfilling it is new spend, per row.** 465 drafts, 202 lead magnets and 4,263 messages is
   roughly 4,900 embedding calls before the first query ever runs, plus one call per keystroke-batch
   at query time. The constraint is no new spending.
3. **Doing it client-side is a new dependency.** The app has three and keeps three. There is no
   in-browser vector index without a fourth.
4. **The nearest existing thing is out of scope.** Ivan's wider system has a hybrid BM25-plus-vector
   retriever behind `claude-brain-query`, but it is not reachable from this app, its tenancy
   semantics for `carousel_drafts` are not established here, and wiring it would be a new
   integration on a phase whose rule is no new edge function.

What the keyword search gives up, stated rather than hidden: it finds "margin" and not "profit is
thin". Two things soften it and neither closes it. Searching `post_body` rather than titles is the
larger half of the gain in practice, because the objection he half-remembers is usually IN the post
rather than in its title, and the measurement bears that out (1 title match against 5 body matches
for `margin` on one lane). And the other-lane counts stop a narrow term reading as an empty archive.

If semantic search is ever wanted, the honest shape is a `tsvector` column and a GIN index, which is
a migration and postgres-native rather than a model: it would give stemming and ranking for zero
runtime spend. That is a migration this phase was not allowed to apply, so it is not shipped and no
migration file is left lying around pretending to be a plan.

---

## Files

New: `src/exp/v2c/chat/paneContext.ts` (+ test), `src/exp/v2c/chat/preread.ts` (+ test),
`src/exp/v2c/chat/usePreRead.ts`, `src/lib/crossSearch.ts` (+ test).
Changed: `ChatPane.tsx`, `useChat.ts`, `Shell.tsx`, `DmsSurface.tsx`, `CommandPalette.tsx`,
`CommandLayer.tsx`, `ContentList.tsx` (one line), `screens/InboxScreen.tsx` (two optional props),
`wbsys.css` (§7, §8, §9). `src/styles.css` untouched.
Evidence: `evidence/ai-tools/probe.py`, `evidence/ai-tools/tenancy-probe.md`,
`after/ai-probe.mjs`, `after/ai-probe.json`, `after/ai-stock-parity.mjs`,
`after/ai-stock-parity.json`, `after/ai-*.jpg`.

Every CSS selector added carries three `.wb` classes and every value was read back from
`getComputedStyle` rather than eyeballed (strip 12px, chip 12px on `rgb(39,39,39)` over
`rgb(28,28,28)`, which is `--e3` on `--e2`, one step, as the ladder requires).
