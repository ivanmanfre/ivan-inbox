---
name: Phase 1/1B — false-verification skeptic
description: Independent re-derivation of the 14 most load-bearing claims in PARITY-SPEC / DEPTH-SPEC / INJECTION-SAFETY / IA / DECISION-TABLE / FIELD-DIFF / AFFORDANCES, against live Supabase (bjbvqvzbzczjbatgmccb, service-role read via main.py:46 key), local code (claude-code-railway, ~/.claude, ivan-inbox @ exp/brain), and the entrypoint.sh restore path.
type: reference
---

# SKEPTIC — false-verification pass

All probes are SELECT/HEAD, read-only. No file edited, no row written. Repo used for
content.ts/styles.ts/DraftPane.tsx: `/Users/ivanmanfredi/Desktop/ivan-inbox` on branch
`exp/brain` (confirmed `git diff exp/v2 -- <content files>` empty, matching the docs' claim).

**Verdict counts: 10 CONFIRMED · 1 REFUTED · 2 flagged UNPROVEN-AS-CITED (mechanism holds,
literal evidence-string doesn't reproduce) · 1 CONFIRMED-WITH-CORRECTION.**

---

### a) PARITY-SPEC full-parity size ~34.1k chars / ~8.5k tokens
**CONFIRMED**, independently rebuilt. Live probes today: P15 `project/MEMORY.md` = **19,162
chars** (byte-exact match, same `updated_at` 2026-08-01T10:40:18Z); P16 `~/.claude/CLAUDE.md`
= **611 chars / 6 lines** (`wc -c`/`wc -l`, exact match); B5 `compiled_context` for "Ivan
System" = **4,596 chars raw** (exact match, same `compiled_at`); B4 — rebuilt
`fetch_supabase_summaries()`'s exact format (header + summary + Topics + Actions, `;`-joined
actions) over the live last-2 `n8nclaw_daily_summaries` rows = **871 chars, exact match**; B10
global/shared row counts (28→26 kept, 29→27 kept after `_`-prefix skip) match exactly. Five
independent reproductions, all exact. High confidence in the ~34.1k/~8.5k total.

### b) Entrypoint restore caps at 1000 rows, shared-tech gets zero
**REFUTED as currently stated** (mechanism confirmed, specific breakdown is not). The cap
itself: confirmed — `claude_memory` total is 1886 rows today (was 1885), and the exact restore
query (`select=client_id,file_path,content`, no filter, no limit) returns exactly 1000, every
time (ran 3x, byte-identical distribution each run — **deterministic today**, not the random
draw the doc implies). But the distribution I get is **not** the one PARITY-SPEC quotes:
mine = `{ivan: 793, unscoped: 96, proswppp: 47, shared-tech: 29, global: 28, risedtc: 4,
-workspaces-ivan: 2, agencyops: 1}` — **shared-tech: 29 (all of them), unscoped: 96 present**.
The doc claims `{ivan: 963, global: 28, agencyops: 7, -workspaces-ivan: 2}` with **shared-tech:
zero** and **unscoped: zero**. Both can't be live-accurate simultaneously. The doc itself
half-admits this ("undefined ordering... changes silently between boots") but then reports the
specific numbers as if they were a stable fact rather than a one-instant snapshot — same shape
as the incident this run is hunting for. **The design conclusion (per-tier queries are
mandatory, F5) is unaffected** — F5's own reproduction (see below) held exactly.

### c) MEMORY.md is 56% of the payload
**CONFIRMED**, follows directly from (a): 19,162 / 34,100 = 56.2%.

### d) normalizeAgentLog discards `agent` on 2999/2999 entries
**CONFIRMED**, code + live count. `content.ts:422-450` — function body reads
`o.body ?? o.message ?? o.text ?? o.note` and `o.ts ?? o.at ?? o.created_at`, returns only
`{ts, body}`; no `agent`, no `source`, no `comment_id` anywhere in the function. Live count
over all 282 `carousel_drafts` rows: 267 rows carry ≥1 entry, **2999 total entries**, `agent`
key present on **2999/2999**, `ts`/`body`/`source` present on 2996/2999 (3 stragglers) — exact
match to the cited figures.

### e) source_detail is an object on 71 rows and crashes React
**CONFIRMED**, count and full code trace (this is exactly the incident-shape the task named —
verified rather than generalized). Live: **71/282** rows have `source_detail` as a JSON object
(**63 in Mattan's/`risedtc` lane, 8 in Ivan's**), 3 as a bare string — matches the doc exactly.
Traced the render path: `content.ts:373` types `source_detail: string | null` (a lie at
runtime — TS doesn't check it); `DraftPane.tsx:83` does
`if (d.source_detail) source.push(['Detail', d.source_detail])`, an untyped-at-runtime array of
`[string, ReactNode]`; that array feeds `<Rows items={source} />` at line 134; `Rows` (line
25-37) renders `<div className="dd-v">{v}</div>` — **`v` reaches JSX with zero stringify/guard
in between**. Confirmed: this is a real crash path, not an inferred one — the object is never
coerced anywhere on the way from the DB column to the JSX child.

### f) style_id NULL on all 282; taxonomy structure_used 112 / image_style 207
**CONFIRMED** exactly. Live: `style_id` non-null count = **0/282**. `taxonomy.structure_used`
present on **112** rows, `taxonomy.image_style` present on **207** rows.

### g) lm_drafts_v2 split 121/5/1, bb07706c invisible to fetchResources()
**CONFIRMED** exactly. Live tenancy split: `{None: 121, risedtc: 5, _r1atest: 1}` = 127 total.
`bb07706c-afdf-45ef-ac03-59b1cd8c512f` is `client_id='risedtc', status='approved',
landing_url=null` — in Mattan's lane. `styles.ts:222-233` `fetchResources()` is hardcoded
`.is('client_id', null)` — confirmed this excludes bb07706c regardless of its resource_url.

### h) scheduled_posts / queue read by nothing in the shipped app
**CONFIRMED**. `grep -rn "fetchScheduledQueue" src/` returns exactly one hit: the function's
own definition at `content.ts:185`. Zero call sites anywhere in `ContentList.tsx`,
`DraftPane.tsx`, `useContent.ts`, or any other consumer file.

### i) /chat and /chat/stream have no --strict-mcp-config (fork EAGAIN risk)
**CONFIRMED**, read directly. `main.py` `/chat` (617-771) and `/chat/stream` (773-865) build
their `cmd` list with no `--strict-mcp-config`/`--mcp-config` anywhere. `/v1/messages`
(~1496-1497) and `/v1/vision-qa` (~1928-1929) both do carry
`"--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'`. The asymmetry is real and exactly
as described.

### j) recall.py:411-413 uses allowlist ('ivan','global','shared-tech')
**CONFIRMED, but only for the correct file.** The container-bundled copy at
`claude-code-railway/skills/recall/recall.py` is only 223 lines (this logic sits at 186-188
there). The citation is accurate for `~/.claude/skills/recall/recall.py` — Ivan's **local, live**
copy (471 lines) — which is what PARITY-SPEC's F6/§2 is actually talking about ("unreachable
from Ivan's local tooling"). Read lines 411-413 there directly:
```
411: semantic_client_ids = ["global", "shared-tech"]
412: if project_label:
413:     semantic_client_ids.append(project_label)
```
Byte-exact match to the citation. Not a citation error once the two `recall.py` files
(container-bundled vs. Ivan's local) are told apart — worth naming so a future reader doesn't
"fix" the wrong file.

### Extra — carousel_drafts tenancy split 198 Ivan / 84 Mattan
**CONFIRMED** exactly via `count=exact` HEAD probes: `client_id is null` → 198,
`client_id=eq.risedtc` → 84.

### Extra — n8nclaw_proactive_alerts: 20 rows, all pipeline_stall, all unsent, newest 68 days old
**CONFIRMED** exactly. Live: 20/20 `alert_type='pipeline_stall'`, 20/20 `sent=false`, newest
`created_at` = 2026-05-25T04:00:17Z. May 25 → Aug 1 = 68 days, exact.

### Flagged UNPROVEN-AS-CITED — F2's "grep -n '^cd ' → lines 475, 598"
Ran the literal command. **Zero matches** — neither line is anchored at column 0 (line 475 is
`        cd "$REPO_DIR" && ...`, 8 spaces of indent; line 598 is `cd` inside a Python f-string
message, not a shell command at all). The underlying conclusion (no directory change happens
before the memory restore at entrypoint.sh:282) still holds on inspection, but the specific
grep-and-line-numbers evidence offered doesn't reproduce as literally described — it's an
imprecise repro command, not a false conclusion.

### Flagged — F1's line citation drift
F1 cites `entrypoint.sh:276` for the restore query; it is actually at **line 282** in the
current file (confirmed via grep). Six-line drift, non-substantive, but worth noting since (b)
above already shows this exact block's *quoted numbers* don't hold up either — two separate
soft spots in the same citation.

---

## Numbers in the four 1B files with no reproducible query shown inline
Structural note, not a per-number accusation: `PARITY-SPEC.md`/`DEPTH-SPEC.md` show the exact
curl/probe for nearly every figure. `IA.md`/`DECISION-TABLE.md`/`FIELD-DIFF.md`/`AFFORDANCES.md`
instead assert "counted 2026-08-01 by direct PostgREST read" once at the top and then state
dozens of per-field breakdowns (hook-type spellings, funnel_stage splits, pillar counts,
image_urls-empty counts, QA key coverage, `agent_log` name roster frequencies) with no inline
query per number. Every one I spot-checked against live data matched exactly (agent_log
counts, source_detail counts, style_id/taxonomy counts, tenancy splits, alert counts) — so I
have no positive evidence any of the unchecked ones are wrong — but the citation discipline
itself is thinner in these four files than in the Phase 1 pair, and a reader shouldn't mistake
"stated as counted" for "shown how."
