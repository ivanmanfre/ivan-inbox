# Direction B - the Ask surface (S29, S30, S31, S15)

Files: `AskThread.tsx`, `Composer.tsx`, `AnswerBody.tsx`, `ToolGroup.tsx`,
`LinkPreview.tsx`, `AskPane.tsx`, `index.tsx`, `ask.css`.

Exports for the sibling contract: `AskThread` from `./AskThread` with exactly
the props the shipped one takes (`chat, job, about, mobile, focusTurn,
onFocused`), and `AskPane` (`BrainAskPaneProps`) from `./index.tsx`. Nothing
under `../mobile/` was created or edited; `AskPane` only READS `../mobile/Feed`.

The data layer is untouched. Every hook, its call order, every effect and its
dependency array, `chat.send` / `chat.retry` / `chat.abort` / `chat.newThread` /
`chat.openThread`, the `abortTurn` write, the attachment object-URL lifecycle
(both revoke paths), `doSend`'s `[attached: name]` join, `useStt`, `unfurl`,
`parseMarkdown`, `extractRecallNouns`, `brainMeta` and the deep-link scroll with
its `[data-answer][data-turn]` selectors are the source's, unchanged. Only JSX
and CSS changed.

---

## S29 - the thread

| Move | What changed | Reference |
|---|---|---|
| 10 | The streaming answer reveals WORD BY WORD. `Words` splits each plain-text run into one span per word; a span mounts once and fades once, so a stream tick never restarts a word that already played. A steady cursor rides the tail as `tail` on the last prose block. `chat.streamText` is rendered exactly as it arrives. | Response Stream, ibelick; AI Streaming Text |
| 11 | ONE status line, `.dirb-working[data-live]`, carrying the source's own sentence. It shimmers while the turn is live and goes flat the instant it resolves. Under the answer, `ToolGroup` collapses the runs behind one line. | Text Shimmer + Tool Group, serafimcloud |
| 12 | The sources chip became small numbered marks INLINE at the end of the last claim. Pressing one names the files. | AI Response, educalvolpz |
| bubbles | Only our turns are boxed: `.dirb-bubble[data-mine="true"][data-ours="true"]` for the operator's turn, `[data-mine="false"]` for Claude, which is plain left-aligned text with no box. | Agent Chat, serafimcloud |

Every S29 ledger row is kept (19/19). Notes on the three that moved:

- **S29-7** `ToolStrip` was copied into `ToolGroup.tsx` and rebuilt, because its
  LOOK is part of this screen. Same `groupRuns` / `summarizeTool` /
  `formatInput`, same per-run input panel, same "no output panel" reason. It now
  sits UNDER the answer, which is what move 11 asks for.
- **S29-13** the chip's collapsed label (`sourcesChipLabel`) is still printed:
  it is the marks group's spoken name, and it opens the expansion. The list is
  still memory files alone; envelope block ids still never reach the DOM.
- **S29-18** the 260ms `setTimeout` that owns `justLandedId` is kept verbatim;
  the CSS settle it drives runs at the contract's one duration (180ms) instead
  of 260ms. The contract wins over the old number.

## S30 - the composer

| Move | What changed | Reference |
|---|---|---|
| 13 | ONE round control in one seat: `IconButton round`, `send` filled accent the moment there is something to send, `solid` and disabled when there is not, `stop` while a turn is open. The tray and the bar are `motion.div layout` on the one spring, so the bar SPRINGS its height and no rule animates `height`. | Send Button, serafimcloud; Family Sign-in Drawer, stackingsu |
| 14 | Attachments are `Chip` with `onRemove`: the remove control is ON the chip. The kind badge is the kind's own mark (image thumbnail or `doc`) plus `data-kind`. | Claude Style AI Input, suraj-xd; File Attachment, serafimcloud |
| 15 | The mic becomes a recording state with the design system's `LevelMeter` and a mono timer; what was heard arrives word by word under it. Wired to the existing dictation path and to nothing else. | AI Voice Input, kokonutd; Voice Dictator, uicapsule |
| 16 | A detected URL is a nested INSET card (`dirb-inset`) inside the tray, prose first. | Social Card, kokonutd |

Every S30 ledger row is kept (12/12). Keyboard: Enter sends, Shift+Enter makes a
newline, byte-for-byte the source's handler. **There is no Escape binding and no
slash-command path in this composer** - neither exists in the source, and this
build did not invent one.

## S31 - the link card

- Nested inset inside the bubble, prose first.
- An imageless page: a mark, its source or its domain, and a bold title.
- A blocked link: a compact tinted card sized like a bubble, carrying
  `linkcards.ts`'s own sentence.
- The gate's DOM vocabulary is unchanged: `data-link-card`, `data-kind`,
  `data-state` with `card` / `loading` / `blocked`.

## S15 - the desktop pane

The same parts inside a `Peer`: a `Header`, the same `AskThread`, the same
composer. The wider measure is `ask.css`'s 768px block - a wider gutter, more
gap between turns, and the bubble measure raised from 34rem to 46rem.

---

## Motion table

| Rule | State change | Selector or animation | Property | Duration | Easing | Continuous |
|---|---|---|---|---|---|---|
| Word reveal | a word arrives in the stream | `.dirb-ask-w` / `@keyframes dirb-ask-word` | opacity | 180ms (`--ds-dur`) | `--ds-ease` | no |
| Stream cursor | a stream is open | `.dirb-ask-caret` | none, a steady mark | - | - | no |
| Status shimmer | a turn is running | `.dirb-working[data-live="true"]::after` (dir-b.css) | transform | 1400ms | `--ds-ease` | **YES, the one** |
| Composer springs | tray opens or closes, mode changes | `motion.div layout` on the tray and the bar | transform (layout) | spring 400/32 | spring | no |
| Tray presence | tray opens or closes | `AnimatePresence` + `fade` | opacity | 180ms | `--ds-ease` | no |
| Streaming turn presence | `chat.busy` toggles | `AnimatePresence` + `rise` | opacity, y | spring in, 180ms out | spring / `--ds-ease` | no |
| Running-elsewhere line presence | the banner appears or leaves | `AnimatePresence` + `rise` | opacity, y | spring in, 180ms out | spring / `--ds-ease` | no |
| Starters mount | the empty thread mounts | `list` + `rise` variants | opacity, y | 30ms stagger, spring | spring | no |
| Just landed | a turn resolves | `.dirb-ask-answer[data-settle="true"]` | background-color | 180ms | `--ds-ease` | no |
| Feed overlay | the feed opens or closes | `AnimatePresence` + `rise` | opacity, y | spring in, 180ms out | spring / `--ds-ease` | no |
| Hover on recall, cite, tool row, tool head | pointer | CSS `transition` | color, background-color, border-color | 120ms (`--ds-dur-hover`) | `--ds-ease` | no |
| Dictation level | `stt.elapsedMs` ticks | `LevelMeter` re-render (ds) | bar height per frame, no transition | - | - | no |

The status shimmer is this surface's ONE continuous loop, which is why the
running-elsewhere line hands `data-live` to the streaming turn when both are up,
why the cursor is a steady mark rather than a blink, and why `LiveDot` (whose
ripple is a second loop) is not used here.

---

## Kept, but changed in form

1. **The tool strip's unicode glyph column** became lucide marks through `Icon`.
   A unicode glyph typed into TSX is the thing the design system removed.
2. **`TurnMeta`** was rebuilt on tokens. The source drew its amber from a hex
   literal and its fill from `var(--accent)`; both are now `--ds-sev-attention`
   and `--ds-accent`. Same 10s scale, same 8s threshold, same strings.
3. **The 14 hand-rolled recording bars** are now the design system's
   `LevelMeter`, which is 14 bars and is deterministic from elapsed time for the
   same reason the source gave: there is no MediaStream to read, and drawing a
   level from `Math.random` would be inventing a number.
4. **`data-*` conventions on a `Chip`.** `Chip` does not spread unknown props, so
   `data-new-thread`, `data-kind` and `data-voice="landed"` are carried on a
   wrapper span. Every other convention attribute (`data-answer`, `data-turn`,
   `data-sources`, `data-recall`, `data-noun`, `data-ask`, `data-send`,
   `data-stop`, `data-mic`, `data-link-card`, `data-kind`, `data-state`,
   `data-running-elsewhere`, `data-tap`) sits where it sat.

## Could NOT keep, and why

1. **Move 15's "a sent note is a compact waveform bubble with play and
   duration."** There is no voice-note send path. `useStt` is batch dictation
   over a broker: it returns a transcript, keeps no blob, and the transcript is
   INSERTED into the composer and never auto-sent. Drawing a sent voice note
   would mean inventing a recording write, which the brief forbids. The move's
   dictation half is fully built.
2. **Move 15's "the transcript streams in under it."** `useStt` exposes no
   partial transcript, so there is no partial stream to read. The transcript
   lands once and is revealed word by word by the same `Words` component the
   answer uses, which is the same felt behaviour without a fabricated data path.
3. **Move 14's PASTED badge.** This composer has no paste handler. Adding one
   would be a new write path, not a view change, so only the two kinds the
   source knows (image, PDF) are badged.
4. **Move 16's "date" on an imageless card.** `LinkCardModel` carries no date
   and `unfurl` returns none. A stamp we would have to invent is worse than a
   stamp that is missing, so the card prints mark, source or domain, and title.
5. **Move 16's favicon.** Fetching one means a third-party request per link from
   a surface that currently makes none. The `link` mark stands in its place.
6. **A severity tint on the blocked-link card.** The token file reserves
   severity for live signals. A logged-out Instagram fetch is not one, so the
   card is tinted with `--ds-wash-strong` and marked with the `blocked` icon.

## Decisions taken without asking

- The `ToolGroup` summary line is built from the tool LABELS the strip already
  printed, with counts, rather than from a written sentence like "read 4 files,
  2 searches". The move wants one collapsed line that says what the answer
  touched; building it out of existing labels gives that with no invented copy.
- `AskPane` drops the old dock's `wb-pane-h` / `wb-back` / `wb-pane-x` classes.
  Direction B owns this pane's look; the aria-labels those controls carried are
  unchanged.
- `AskThread` calls `useDsBody()` itself as well as through `DirB`. The hook is
  ref-counted and idempotent, and it means the thread carries the reduced-motion
  half of the contract even when the phone chrome mounts it.

## Seam requests

None. `../mobile/Feed` already exports the props `AskPane` passes it; if that
component is renamed, one import line in `AskPane.tsx` moves with it.

`npx tsc -p tsconfig.app.json --noEmit` reports no error in any file in this
folder.
