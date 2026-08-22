# Port #2: the call transcript reader

Shipped 2026-08-22 on `wb/polish`, commits `43efa56`, `0758dbc`, `5150439`.

Port #2 of `evidence/dashboard-port-audit.md` §1, the one the audit calls "the
substance" and the one the URL Ivan sent (`?section=today&sub=meetings`) was
pointing at. The completeness critic recorded that 8 of the 10 ranked ports had
zero code (`completeness-critic.md:29,82`). This closes the highest-ranked of
the eight.

`/Users/ivanmanfredi/Desktop/personal-site` was read only. Nothing was built,
committed or deployed from it, and the two files this port reads for field
semantics are named in the source headers.

---

## The numbers, measured live on 2026-08-22

| | |
|---|---|
| Calls on record | **96** |
| In the last 7 days | **17** |
| Carrying action items | **12** |
| Mean length | **39 minutes** |
| Carrying a summary | 16 |
| Carrying extracted content topics | 17 |
| Carrying a follow-up draft | 15 |
| Carrying a brief (fit score, pain, objections) | **1** |
| Carrying `calendar_event_id` | **0** |

The audit's four headline numbers reproduce exactly. One of its implied claims
does not, and it matters: the audit says "Each card holds a fit score out of 5,
decision maker, pain list, stack, triggers, objections, proposal hook, next
step, action items with owner and due date, extracted content topics, and a
follow-up draft" (`dashboard-port-audit.md:44`). That is the SHAPE of the card.
On the live data **exactly one row of 96 carries a brief at all**, so fit score,
decision maker, pain, stack, triggers, objections and proposal hook are present
on 1 row and absent on 95. The reader is built for that reality rather than for
the shape: the brief is a disclosure that says in words why it is empty, and a
call with nothing extracted gets a written line saying so instead of eight
collapsed headings over nothing.

---

## Where it lives, and what that costs

**A takeover window, opened from a Calls section on Today. Not a third peer
type.** This is a departure from the audit's own recommendation and the
reasoning is written out in full at `src/exp/v2c/CallWindow.tsx:8-52`.

The audit priced the peer honestly: "a third peer type competes for the same 1
or 2 peer slots, so on the desktop canvas opening a transcript evicts the
thread or Claude" (`:61`). It then accepted that cost. The disagreement is with
the acceptance, not the reasoning.

1. **The cost is avoidable, and this repo already proved it.** A `draft` peer
   once existed and was deleted. `Takeover.tsx:5-11` carries Ivan's verbatim
   reason: "when i open a content idea or review do not just open it on the
   side its literally impossible to read... make it like before on the
   interface that opens a window so i can properly read". `Shell.tsx:614-616`
   records that the peer kind survives only so the pure layout functions stay
   general. A transcript averages 39 minutes of dialogue and the longest body
   this port rendered is 30,022 characters. It is longer than any draft in the
   app. Shipping it into the exact 420px column he rejected for shorter
   material would be porting the recommendation and reproducing a defect he
   has already named once.
2. **The audit's own fallback was a tenth rail job** (`:61`). The takeover is a
   third option it did not price, because the draft window shipped after the
   peer model was written down. It costs zero peer slots AND zero rail jobs.
3. **The audit's structural point is honoured whole.** It says the reader needs
   a way to reach transcripts that are not the next call, and that "the
   cheapest home is a section inside the Calls zone on Today". That is exactly
   where the door is, directly under the next-call card port #1 shipped.
4. **The one thing a peer would genuinely buy is worth nothing here.** A peer
   keeps the transcript beside the conversation it belongs to. The linking
   measurement below found that zero of the 96 transcripts resolve to an inbox
   prospect. There is no thread to keep beside it.

### The cost, stated rather than buried

- **The window is modal.** While a transcript is open the DMs list and Claude
  are both behind the scrim, so "ask Claude about this call" is not available
  from this surface. The draft window pays the identical price and has since it
  shipped. If that turns out to be the wrong trade, the fix is to give both
  windows a chat affordance at once, not to make this one a peer.
- **Today grows one section.** Measured on the shipped build at 1440: the
  Calls section renders 6 rows at rest with a "more in this list" row, in the
  second column beside Zone A. It sits below the next-call card, which is where
  the eye already is when the question is about a call. `875098f` cut the alert
  strip from 1485px to 157px, so the vertical budget on Today is real; this
  section is the first thing to spend some of it.
- **Two reads on Today instead of one**, both gated on the same
  `threads !== undefined` discriminator every other workbench-only prop uses,
  so `#exp/stock` fires neither.

---

## What shipped

### The read (`src/lib/transcripts.ts`)

One select on `transcripts` for the list, one per-row select for the body. No
write, no RPC, no migration, no n8n, no fourth dependency.

**The list never selects the body, and the measurement is the reason.** The old
dashboard's `useMeetings.ts:36-40` does `select('*')` at limit 200, which drags
every row's full `transcript_text`, its vector `embedding` and the raw provider
payload:

| query | bytes | time |
|---|---|---|
| `select('*')`, limit 200 (the source's own) | **16,038,082** | 2.9s |
| the 13 columns this port selects | **117,952** | 0.45s |

136x smaller, and the raw body becomes a second read that only fires when the
fold is opened.

### The extraction and the ranking (pure, 45 tests)

- `action_items` and `topics` are jsonb arrays whose elements are JSON
  **strings**, not objects. Parsed once, in one place, into a typed record,
  rather than the source's five-key guess at render time.
- **Owner attribution on a closed set.** The extractor writes exactly "Ivan" and
  "Client". `ownerIsMine` matches case-folded whole strings only, so an
  unrecognised owner renders verbatim and counts as not-mine. "What I owe" must
  never over-claim, and there is a test that `Ivanka Petrov` is not Ivan.
- **Google Calendar room resources are dropped from the attendee list.** Rows
  carry addresses like `c_1886b651hfvjsh7fi4o0fbvbe8baq@resource.calendar.google.com`.
  The source prints them at the reader. They are furniture, not people, and
  they are excluded by exact host, which is a rule and not a guess.
- **`callTitle` names a row that would otherwise render blank.** One row's title
  is nothing but the trailing separator a recorder left behind. The capture
  found it; the source strips the slash and then prints the empty remainder.
- **The ranking is the feature.** 96 rows sorted by date buries the 12 with
  unfinished business, and those 12 are the only rows with anything left to do
  in them. So it is two groups, in order, newest first inside each: rows
  carrying action items, then everything else. A weighted score was the
  alternative and was rejected because a score mixes "has open business" with
  "is recent" into one number nobody can read back off the screen.

### The door (`src/screens/TodayScreen.tsx`)

A Calls section under the next-call card. Three segments as `.wbb` controls:
**With action items 12** (the default whenever it is non-empty), **Last 7 days
17**, **All calls 96**. Six rows at rest, the rest one click away.

Each row carries: the call's name, a neutral chip reading "3 yours" or "16
open", one line of substance chosen by what would change what he does next
(next step, then an objection, then the item he owes, then the summary), and
the date, length and attendees.

**No new CSS on Today.** The rows are the `.td-qrow` / `.td-qmid` / `.td-qt` /
`.td-qs` / `.td-qmeta` / `.td-chev` primitive the work queue above already
uses. The count chip is the neutral `.td-qage`, deliberately not the
accent-painted `.td-qn`: `completeness-critic.md:57-69` found the accent budget
already violated on the busiest lane, and an accent-weighted count here would
spend a budget this screen has no primary action to spend.

### The next-call empty state, rewritten

It read: "No calls on the calendar this week / Upcoming calls surface here as
they land in calendar_events." It now reads: "No calls booked in the next seven
days / A booking shows up here the moment it lands. 96 earlier calls are on
record below, and 12 of them still carry something that was agreed."

Two reasons. First, the empty case is the COMMON case for the upcoming half:
his calendar was clear for seven days on the day of the audit and it is clear
most weeks, so this is the state he will actually read. It now carries the true
second half of the answer, which only became sayable once the archive was one
tap away. Second, the old copy named a database column at the reader, which is
the class of leak `phase2-labels.md` exists to close. The count is stated only
after the read has actually come back; before that the sentence stops early
rather than print an unverified zero.

### The reader (`src/exp/v2c/CallWindow.tsx`, `src/exp/v2c/wbcall.css`)

Three columns, all borrowed: `.dw-queue` (96 rows, j/k walks them, "1/12"),
`.dw-main` (what was extracted), `.dw-insp` (`.wbkv` metadata plus the brief
disclosure). Nothing here is a parallel primitive. `wbcall.css` defines only
three shapes the app does not already have: a promise, a bullet from an
agent-written list, and a block of dialogue. Every selector carries three `.wb`
classes, and every rule that sets type restates it on descendants because
`faithful.css:181` reaches `*`.

**It leads with what was extracted.** In order: what was promised, split into
"You said you would" and "They said they would" rather than an owner column in
a flat list; the next step; what they pushed back on; the hook; the follow-up
draft; the summary; the extracted content topics. The raw body is last and
folded, and it is not fetched at all until the fold is opened.

Elevation follows the phase-1 ladder: a promise is raised one step (`--e3` on
the reading surface) because it is an object on the page; a block of dialogue
is recessed (`--e1`) because it is a well you read into. No shadow does depth
work anywhere in the file.

---

## The linking decision: measured, and refused

The brief asked to connect transcripts to people if it is cheap and reliable,
and to refuse with a reason if it is fuzzy name matching. **It is fuzzy name
matching, so no link ships.** The measurement, live:

- `transcripts.calendar_event_id` is **NULL on all 96 rows**, so the structural
  join that would have been exact does not exist in the data.
- `participants` holds **215 tokens** across the 96 rows: **46 addresses, 169
  bare display names**.
- Of the **27 distinct addresses**, **zero** match `outreach_prospects.email`
  and **zero** match `prospect_email` on `inbox_messages_v`. Most are
  `@arch.agency` staff, who are a client's own team and not prospects.
- Exact, case-sensitive full-name equality on the **47 distinct display names**
  hits **7 names**, and **2 of those 7** ("Jacky Zeigen", "Chas Waters") each
  resolve to **two different prospect rows**. So even the strictest possible
  string match is ambiguous **29% of the times it fires at all**, before any
  fuzziness is introduced.

A wrong link between a call and a prospect is worse than no link: it would put
words in a stranger's mouth on the one surface whose entire job is telling him
what was agreed. What ships instead is the attendee list rendered as plain
text, which is what the row actually knows. The numbers are in the source file
at `src/lib/transcripts.ts` so a later run can re-measure rather than re-argue.

If this is worth fixing, the fix is upstream and structural, not in the UI:
have whatever writes `transcripts` stamp `calendar_event_id`, which Calendly
already has at write time.

---

## What was deliberately left in the old dashboard

Everything on the old Calls section that writes. The audit counts four things
Ivan does there and says three of the four mutate (`dashboard-port-audit.md:103`).
None travels, and none is essential:

| Left behind | Why |
|---|---|
| **Reclassify a meeting type** (`useUpcomingEvents.ts:62-65`) | A write, and it exists to paper over bug 1: Calendly stamps free text where a 5-key enum is expected. Port #1 already fixed the read side by validating the stored value against the real key set, so the manual correction has nothing left to correct. |
| **Edit the live sales script** (`useSalesScript.ts:58-63`, port #6) | A write to `sales_scripts.content_md` with a version bump. Port #6 is a separate ranked item; it is genuinely useful two minutes before a call and it is not this port. Reading it would be a defensible follow-on. Writing it from here would not. |
| **Mint a tokenised client intake link** (`IssueIntake.tsx:36-41`, RPC `issue_fractional_session`) | A write, and it mints a credential that reaches a client. Out of scope by two rules at once. |
| **Fire an n8n proposal build off a transcript** (`MeetingCard.tsx:153-179`) | A POST to `n8n.ivanmanfredi.com/webhook/proposal-upwork` carrying the full transcript. It is an n8n fire, it costs money and time, and it is untestable from this repo. |
| **Signed recording playback** (`call-recording-url` edge function) | Genuinely read-only and genuinely useful, and left out anyway: it puts a video element on a text surface, it is a per-row edge-function call on open, and the reading job the port exists for is answered by the text. The cheapest honest follow-on if he asks for it. |
| **"Create proposal" and "Copy summary" buttons** | The first is the n8n fire above. The second is trivial and reversible, but a clipboard button is chrome and the material is selectable. |

**Nothing on this surface can write to or contact a prospect.** The follow-up
draft that exists on 15 rows is rendered as text under a line that says so in
words: "Text on the row, nothing more. This app never sends it, never queues it
and has no approve button for it." There is no approve control, no send
control, and no queue write anywhere in the port. The inspector's footer states
the same thing for the whole surface.

If any of the six is judged essential, the honest answer is that nothing here
ships to cover it; it needs its own decision.

---

## The interaction count

**The question: "what did we agree with this person on the last call".**

**Before:** unanswerable inside the inbox. The inbox has never read
`transcripts`. The full path was: leave the app, open a browser, go to
`ivanmanfredi.com/dashboard`, enter the dashboard password, navigate to
`?section=calls`, wait out the settle (the audit needed 11 seconds before the
tallies were true), scroll a list of 96 sorted by date to find the call, expand
the card, and read past the recording player, the brief and the summary to
reach the action items. **Leaving the inbox entirely, plus roughly 8
interactions once there**, and the archive was reachable only through a
surface with four live write buttons on it.

**After: 2 interactions, without leaving the inbox.** Today is the boot-adjacent
surface; the Calls section is on it with the 12 open-business rows already
first. Click the row (1), read. The promises are the first thing in the
reading column, above the fold, at both viewports. If the call is not in the
default 6, one more click on a segment or on "more in this list" makes it 3.
Walking to the next call inside the reader is one keystroke (`j`), not a
re-navigation.

**Reachability: all 96 of the 96, and all 12 of the 12.** The 12 are the
default view, ranked first inside every segment. The other 84 are two clicks
away (segment, then expand).

---

## Verification

| Gate | Result |
|---|---|
| `npm run build` (`tsc -b` plus vite) | clean, exit 0 |
| `npx vitest run` | **1118 passing**, 55 files. One failure, `src/lib/calendarItems.test.ts:401`, the known pre-existing wall-clock time bomb, byte-identical on `main` |
| Tests added by this port | **45** on the extraction and the ranking, in `src/lib/transcripts.test.ts`. The fetch is not tested, by instruction |
| **Attempted writes, capture run** | **0** |
| **Attempted writes, no-leak run** | **0** |
| Internals scan on the four new states | **16 surface walks, 0 leaks**, and it fails closed |
| 401s | none. Session valid throughout |
| `src/styles.css` | untouched |
| `#exp/stock` | untouched. `onOpenCall` is undefined there, so the section does not render at all rather than render rows that do nothing when tapped |
| New runtime dependencies | 0 |
| Em dashes in the shipped diff | 0 |

### Screenshots

20, in `after/calls-*.jpg`, at 1440x900 and 390x844, dark and light, with the
manifest at `after/calls-capture.json`. Every shot records what it actually
reached, so a miss is a failed capture and not a silent pass:

| id | what it reaches |
|---|---|
| `calls-today` | the Calls area, 6 rows |
| `calls-empty` | "No calls booked in the next seven days", with the archive line under it |
| `calls-reader-actions` | chip "3 yours", **6 promises rendered** |
| `calls-reader-body` | the raw body unfolded, **30,022 characters** |
| `calls-reader-all` | the far side of the ranking, honest-empty block present |

### Instruments

- `evidence/calls-capture.mjs`, served on **port 4319** (4173 belongs to
  sibling agents), auth injected into `sb-bjbvqvzbzczjbatgmccb-auth-token`,
  write interceptor on `**/rest/v1/**` **and** `**/rest/v1/rpc/**` installed
  before every navigation.
- `evidence/calls-noleak.mjs`, the internals scan pointed at the four new
  states with the same patterns `no-internals.mjs` uses, plus the raw-column
  tooltip test. **It fails closed**: a surface that does not open, or renders
  under a plausible character floor, exits non-zero rather than printing a
  pass. Output at `evidence/audit-tools/out-calls-noleak.json`.

Both harnesses wait for the archive read to land rather than for a fixed delay.
The first two runs produced intermittent failures that were the harness losing
a race rather than the surface failing, which is the same degrade-open defect
the sibling agent is fixing in the shared scanner. The fix was to wait for the
real landmark.

---

## What this port does not claim

- **No timing measurement.** The interaction counts above are enumerations of
  the control path, the same basis every other Phase 4 item in this run used
  (`completeness-critic.md:74-76`). The before path was walked in the audit,
  not by me, and the audit discloses that it reached those pages through an
  authentication bypass. Nothing in this port depends on that: the numbers all
  come from the live database and the shipped build.
- **No judgment of the reader against the old card.** No blind panel was run.
- **The brief disclosure is nearly always empty**, and it says so. If the
  extractor starts writing briefs on more than 1 row in 96, the panel fills
  itself with no code change.
- **No 1024 capture.** 1024 is the canvas whose component output is genuinely
  distinct (`layout.ts:111-113`) and it has no coverage anywhere in this run.
  The reader is a takeover rather than a peer, so `MAX_PEERS` does not reach
  it, but that is an argument and not a measurement.
