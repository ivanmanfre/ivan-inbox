# thread-answer — 21st.dev curation

Surface: the Ask thread — the operator's turn, Claude's answer, the sources/grounded chips, inline
recall, markdown answers, and the chat message list.

Pool built: 24 candidates (by-surface.json `thread-answer` bucket checked as a sanity pass only, too
noisy — Table/Dialog/Button rank top by usage there and are not on point; own pool built via grep
over references.json on chat / message / bubble / ai / streaming / reasoning / markdown / citation /
tool-call / thinking, then cross-checked against the composer-attachments-voice keyword set to drop
input-only components). Previews opened and judged: all 24 (batches of 6, verdicts logged to
`notes-thread-answer.md` before each next batch).

What the current build does wrong (from `../../brain-b-design-elevation-2026-09-04-out/01-build/b/shots/ask-thread.png`):
the answer is one flat undifferentiated paragraph with no heading/list/code hierarchy, it appears as
an instant block rather than settling in; the only grounding signal is two identical grey pills
("read 1 memory file ›", "grounded on 2026-09-02") that carry no detail and cannot be told apart from
across the room.

---

## Picks

### 1. Tool Group · serafimcloud · usage 8
- **Move:** a collapsible header — "Exploring 7 files, 5 searches" with a caret — expands into a
  per-action list where each row carries its own icon, a bold verb (Grep, Glob, Read) and a mono
  argument.
- **Lands in the inbox:** replaces the flat "read 1 memory file ›" pill. Ivan sees a one-line summary
  at rest and can tap to see exactly which file, which search, which recall got pulled, instead of a
  pill that means nothing until pressed.
- **Risk:** the expanded list is dense; if every turn defaults open it turns one answer into a wall of
  file paths. Keep it collapsed by default and cap the row count before it needs its own scroll.
- **Preview:** `../01-refs/previews/serafimcloud__tool-group.png`
- **Video:** https://cdn.21st.dev/21st.dev/tool-group/streaming/video.1777646307311.mp4

### 2. AI Response · educalvolpz · usage 8
- **Move:** numbered citation markers sit inline, immediately after the exact claim they support,
  inside the flowing answer text, rather than as a separate list underneath.
- **Lands in the inbox:** a second, complementary grounding surface to pick 1. "Content Radar reads
  recent sessions" gets a small "1" right after "recent sessions" instead of Ivan having to guess
  which sentence a bottom chip was backing.
- **Risk:** superscript markers can look like footnotes in a paper (an AI-slop tell) if styled too
  literally; keep the marker small, lime-tinted and clearly tappable, never a plain grey number.
- **Preview:** `../01-refs/previews/educalvolpz__ai-response.png`
- **Video:** none

### 3. Markdown · serafimcloud · usage 8
- **Move:** the answer body renders real heading weight, bullet lists and a bordered monospace block
  for code/data, plus a quiet "Streaming..." label and a "Replay" affordance sitting above the body.
- **Lands in the inbox:** fixes the single biggest flatness problem in ask-thread.png — right now a
  multi-part answer (a fact, then a recommendation, then a caveat) reads as one grey paragraph. This
  gives Claude's answer the same typographic hierarchy a written answer would get.
- **Risk:** headings and code fences are rare in Ivan's actual answers (mostly short prose); if the
  renderer adds visual weight nothing needs, plain answers will look like they are missing something.
  Hierarchy should only appear when the answer actually has structure.
- **Preview:** `../01-refs/previews/serafimcloud__markdown.png`
- **Video:** https://cdn.21st.dev/21st.dev/markdown/streaming/video.1777450883241.mp4

### 4. Response Stream · ibelick · usage 253
- **Move:** the answer reveals word by word as a fade-in (each word ramps from transparent to full
  opacity in sequence), not an instant block-append and not a blinking-caret typewriter.
- **Lands in the inbox:** directly answers Ivan's "smooth motion" ask for the one moment in the app
  that currently has none — the answer just appears. A short, low-amplitude fade as words settle in
  reads as alive without being busy.
- **Risk:** demo is on a white ground; on dark ground a fade that is too slow reads as lag, and if the
  fade window is too long on a long answer Ivan will start reading before it finishes and get
  distracted by words still resolving ahead of his eye.
- **Preview:** `../01-refs/previews/ibelick__response-stream.png`
- **Video:** https://cdn.21st.dev/user_2rkgEMvkQ7I2oxalLXELCy8NObN/response-stream/default/video.mp4?v=1

### 5. Text Shimmer · serafimcloud · usage 10
- **Move:** a single line of status text carries a slow shimmer sweep while work is in flight, then
  goes flat and static the instant it resolves — the animation is a property of "not done yet," not a
  decoration.
- **Lands in the inbox:** the moment between Ivan sending a question and the grounded/recall chips
  from pick 1 appearing currently has no state at all. A shimmering "Checking memory..." label there,
  going still the moment the tool-group chip lands, tells Ivan something is actually happening.
- **Risk:** a shimmer on a dark ground is one style choice away from neon or glassmorphism; keep it a
  single low-alpha lime pass, one at a time, and never let it run longer than the actual wait or it
  reads as fake busywork.
- **Preview:** `../01-refs/previews/serafimcloud__text-shimmer.png`
- **Video:** https://cdn.21st.dev/21st.dev/text-shimmer/fast/video.1778242532087.mp4

---

## Runners-up

- **Agent Chat · serafimcloud · 55** — the reference chat shell (bubble top-right, plain answer,
  composer bottom); confirms the current layout is already close to right, no standalone move to
  port. `../01-refs/previews/serafimcloud__agent-chat.png`
- **Thinking Tool · serafimcloud · 0** — a quiet "Thinking ⌄" collapsible label above the draft;
  overlaps pick 1's collapsible-card idea too closely to need both. `../01-refs/previews/serafimcloud__thinking-tool.png`
- **Subagent Tool · serafimcloud · 0** — one dense status line ("Completed Subagent · Collect
  previews · 6s") combining task name and elapsed time; thinner version of pick 1. `../01-refs/previews/serafimcloud__subagent-tool.png`
- **MCP Tool · serafimcloud · 0** — same collapsible-card family as pick 1, showing a raw JSON result
  body instead of a file/search list; redundant with pick 1's move. `../01-refs/previews/serafimcloud__mcp-tool.png`
- **Error Message · serafimcloud · 0** — compact red-tinted "Something went wrong" card; the right
  shape for the turn-error surface, not this one. `../01-refs/previews/serafimcloud__error-message.png`
