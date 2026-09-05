# S12 — Ops board (Direction B, "surface")

Files: `index.tsx` (OpsBoard, the override entry point) · `PendingCard.tsx` (the
nine kinds) · `TaskList.tsx` (S36 checklist) · `ReactionDesk.tsx` · `util.ts`
(shared pure helpers) · `ops.css` (the only classes dir-b.css does not carry).

Sources copied: `src/exp/v2c/OpsBoard.tsx`, `src/screens/OpsScreen.tsx`
(`PendingCard` / `TaskList` / `ContextLine` / `Tick` / `TaskRow`),
`src/exp/v2c/ReactionDesk.tsx`, plus `relAge` from `src/exp/v2c/Surface.tsx`.
Every hook, write, guard, early return and keyboard-reachable control keeps its
original call order and its original string. The data layer is untouched:
`../../../lib/ops`, `../../../hooks/useCommentQueue`,
`../../../hooks/useReactions`, `../../../hooks/usePullToRefresh`,
`../../../components/ConfirmSheet`, `../../../components/PullIndicator`.

## What changed, per move

| Move | Where | Reference |
|---|---|---|
| The board is a DECK. Same-kind cards that pile up render as one `.dirb-deck`: peeked edges behind the front card ARE the count, and the front card advances as the one in front resolves and leaves. | `index.tsx` `Deck` | Sidebar News (dubinc) · Stacked Activity Cards (spydiecy) |
| A collapsed deck header names count AND kind ("4 replies", "3 weekly reports"); its children fade in under it on the 30ms stagger. | `index.tsx` `Deck`, `KIND_PLURAL` | Tool Group (serafimcloud) |
| Every one of the 9 kinds is a `Card`: kind `Chip`, context block, `Textarea` where the source has one, an action row, and post-state `Banner`s. **The nine per-kind hexes are GONE** — a kind is a LABEL, so every kind chip is the same neutral tone and only the word differs. | `PendingCard.tsx` | direction brief |
| Every action carries a ONE-LINE CONSEQUENCE CAPTION under its label, and the decline is a danger-OUTLINED button (`Button variant="danger"` is outline-only in the system). | `PendingCard.tsx` `Action` | AI Approval (educalvolpz) |
| A blocked / refused card shows its reason INLINE next to the action row, not as a paragraph under the card. | `PendingCard.tsx` `.opsb-inline` | AI Task List (educalvolpz) |
| The task list is a checklist card: `Icon name="checked"` for done, an empty circle for todo, and a row whose write is in flight wears `.dirb-working data-live="true"` and settles flat when the result lands. | `TaskList.tsx` | Card Status List (isaiahbjork) |
| A wait on an external party keeps a PERSISTENT status pill / strip, never a spinner glued to the card: the outbound queue line, the `queued` post-state, the clock refusal, and an over/now due chip. | `index.tsx`, `PendingCard.tsx`, `TaskList.tsx` | Push Approval Card (felipemenezes098) |
| The reaction desk is rebuilt on `Card` / `Chip` / `Button`; the approve tooltip is now also its caption so the refusal reason is readable without a hover a phone does not have. | `ReactionDesk.tsx` | direction brief |
| The emoji picker is UNCHANGED. Its twenty emoji stay emoji (S12-23: user-selected content, deliberately not lucide) and the insertion expression is byte-identical. Only the like and tag controls beside it moved onto `Chip`, and the inline hex/px styles became token classes. | `PendingCard.tsx` `.opsb-emoji-row` | S12-23 |
| Empty state: `EmptyState ghosts`, the source's line kept verbatim, with the freshness stamp under it. | `index.tsx` | Empty Notifications State (7ovr) |
| Error state is a real fork: retry, plus the source's own second sentence saying what he is looking at instead (stale rows, or an unread queue). | `index.tsx` | Error Empty State (7ovr) |
| Toasts: `ToastStack`, source-name + detail + relative-time anatomy, explicitly stacking, at most ONE follow-up action per success toast — and that action is always a link the card already carried. | `index.tsx` `pushToast` | Stacked Alerts (aghasisahakyan1) · Toast with Action Button (bundui) |

## Motion table

| Rule | State change | Selector or animation | Property | Duration | Easing | Continuous |
|---|---|---|---|---|---|---|
| One spring | Card mounts in the queue | `rise` variants on `CardShell` | opacity, transform:y | spring 400/32 | spring | no |
| One spring | Card resolves and leaves | `AnimatePresence` exit on `CardShell` | opacity, transform:y | 180ms | `cubic-bezier(.25,1,.5,1)` | no |
| One spring | Deck fans open / collapses | `layout` on the deck wrapper + its cards | transform | spring 400/32 | spring | no |
| 30ms stagger | Card column mounts | `list` variants on `.dirb-cards` | staggerChildren | 30ms step | — | no |
| 30ms stagger | "Done today" opens | `stagger(i)` delay on each done row | opacity, transform:y | spring 400/32 | spring | no |
| One duration | Task details expand / collapse | class swap to `.dirb-truncate` | opacity, colour | 180ms | `--ds-ease` | no |
| One duration | "Done today" strip fades in | inline `fadeT` | opacity | 180ms | `--ds-ease` | no |
| Hover is CSS | Card hover lift | `.dirb-lift` (dir-b.css) | background-color, border-color, transform | 120ms | `--ds-ease` | no |
| Hover is CSS | Deck header, tick, emoji hover | `.opsb-deckhead`, `.opsb-tick`, `.opsb-emoji` | color / opacity | 120ms | `--ds-ease` | no |
| One loop | A task row mid-dispatch | `.dirb-working[data-live="true"]::after` (dir-b.css) | transform:x | 1400ms | `--ds-ease` | YES — the only loop on this surface, and only while a write is in flight |
| One spring | Toast enters / leaves the stack | `ToastStack` (ds) | opacity, transform:y, layout | spring 400/32 | spring | no |

Nothing animates width, height, top, left, margin or padding. No
`transition: all`. `ops.css` carries no colour literal, no px font-size and no
px border-radius — census-clean (verified by grep).

## Ledger — every S12 item

Kept, live, on this surface: **S12-1, 2, 3, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15,
16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47** — 45 of 48. All nine pending
kinds (S12-19 to S12-27) are present with their own context block, their own
confirm copy, their own approve lane and their own discard sentence.

Not rebuilt, and why:

- **S12-4** (OpsScreen inline fail banner) and **S12-7** (OpsScreen's own empty
  variant) belong to `src/screens/OpsScreen.tsx`, the *production, non-board*
  host. `OpsBoard` never renders either one, and only `OpsBoard` is overridden,
  so both stay with their owner completely unchanged. `OpsBoard`'s own error
  fork (S12-3) carries the retry and the "what am I looking at" sentence.
- **S12-48** (OpsGroups Working/Done/Blocked) is flagged NOT-LIVE in the ledger:
  cut from OpsBoard at Ivan's word on 2026-08-31, exported and unmounted. It was
  deliberately removed, not orphaned, so it is not rebuilt here either. The
  component and its data hook still exist untouched in `OpsScreen.tsx`.
- **S12-5** kept as a state but drawn with the system's `SkeletonRows` instead of
  `components/Skeleton`'s `OpsSkeleton`: the loading shape is part of this
  screen's look, so it moved onto the primitive like everything else.

## Decisions logged (never asked)

1. **`Button variant="primary"` budget.** The system says one accent fill per
   screen. Ops is a queue of independent decisions with no screen-level single
   action, so the budget is read as one primary per DECISION UNIT: the approve on
   a card, and the approve on a reaction card. Everything else on the surface is
   `default` / `outline` / `danger` / `quiet`.
2. **Em dashes and arrows in TSX.** The copy rules ban them in prose; the ledger
   marks several source strings verbatim and they contain both ("Nothing waiting
   on you — and this is a live read, not a stall.", "Approve → Mattan's board",
   "Queued — the poster has it…"). Verbatim wins: not one user-visible string was
   re-punctuated. Every em dash and arrow in this folder is either inside a
   copied string or inside a comment.
3. **One new sentence, total.** Every consequence caption is the confirm sheet's
   own `message`, read once into `approveMessage` / `discardMessage` and used
   both places so they can never drift. The single exception is the "Draft it"
   caption — that action has no confirm sheet, so it gets one line built from the
   source's own comment: *"Nothing leaves the building. It fills the box above."*
4. **`KIND_PLURAL`.** A collapsed deck must name its kind as a plural noun, which
   the ALL-CAPS badge labels cannot do ("4 REPLY"). The nine plurals are the only
   other new words, and the badge itself still says `REPLY`, `WEEKLY`, `ESC` …
   exactly as before.
5. **The `manual_invite` caption names two database columns**
   ("…stamped in booking_attributions + call_booked_at"). That is the shipped
   confirm-sheet string, already on screen today. Moving it up to the caption
   keeps it verbatim rather than inventing a replacement; flagging it here rather
   than rewriting a string the ledger marks as a write's consequence. If the copy
   census objects, the fix is one string in one place.
6. **`flush` on `TaskList`** is kept in the signature (the host passes it) but is
   inert: the list is a `Card` inside a `Surface` that already owns the gutter, so
   there is no inline padding left to turn off.
7. **Emoji font-size.** `fontSize: 17` inline became `var(--ds-fs-title)`; the
   emoji themselves, their order and the append expression are untouched.

## Seam requests

1. **`Surface` should forward a ref** (or be typed
   `React.ComponentProps<'div'>`). `Surface` IS the scrolling element and
   `usePullToRefresh` has to hold it, but its props type is
   `{className, children} & HTMLAttributes<HTMLDivElement>`, which carries no
   `ref`. React 19 passes `ref` as an ordinary prop so this works at runtime;
   `index.tsx` bridges it with one contained cast (`scrollRef`, commented at the
   site). One line in `shell.tsx` removes the cast.
2. **Registering the override.** `src/wb/dir-b/index.tsx` is on the do-not-touch
   list, so this folder is not wired in yet. The lead needs:
   ```ts
   import { OpsBoard } from './ops'
   export const overrides: Overrides = { OpsBoard }
   ```
   `OpsBoard` has exactly the props `src/exp/v2c/Shell.tsx` mounts it with:
   `{ drafts, loading, error, loadedAt, refresh }`.

## Verification

`npx tsc -p tsconfig.app.json --noEmit` — this folder adds **zero** errors. (The
only errors in the tree are two pre-existing `dataTransfer` ones in
`src/wb/dir-b/content/calendar.tsx`, another builder's folder.)
