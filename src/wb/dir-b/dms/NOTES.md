# Direction B · S02 DMs list + S14 DM thread peer

Folder: `src/wb/dir-b/dms/`. Two exports, same props as the components they
replace (`Shell.tsx:93-94`, `Shell.tsx:525`, `Shell.tsx:686`):

| export | replaces | props |
|---|---|---|
| `Dms` | `src/exp/v2c/DmsSurface.tsx` | `threads filter setFilter status refresh onOpenThread loadedAt` |
| `ThreadPeer` | `src/exp/v2c/ThreadPeer.tsx` | `thread refresh onClose onAsk mobile` |

Files: `index.tsx` · `Dms.tsx` · `InboxList.tsx` (S02/S33) · `DraftCard.tsx`
(S35 DraftCard/StaleBar/PushedBar) · `DmHistory.tsx` · `PreReadNote.tsx` ·
`ThreadPeer.tsx` · `Thread.tsx` (S34) · `RestoreStrip.tsx` · `dms.css`.

Imported, never copied (the data layer and the shared sheets are untouched):
`lib/inbox`, `lib/labels`, `lib/today`, `hooks/usePullToRefresh`,
`hooks/useSectionState`, `components/{Linkified,ConfirmSheet,PushLaterSheet,PullIndicator,CopyChatLink,ContextSheet}`,
`exp/v2c/{RowSelect,CalPopover,fmt,stage,chat/preread,chat/usePreRead}`.

---

## 1 · What changed, screen by screen

### S02 · the list (`InboxList.tsx`, `Dms.tsx`)

| Move | Reference |
|---|---|
| A conversation is a **card**, not a hairline row: `Card` + `.dirb-lift`, `Avatar` with `live` on any unread thread, the last message in `.dirb-quote`, the time in `ds-t-mono`. | dir-b brief |
| The **state chip** is the app's own bucket word — `STATUS_LABEL[threadBucket(t)]` ("To answer" / "Draft ready" / "Waiting on them"). That is the actor-verb-object headline built with **zero new copy**: the avatar and name are the actor, this chip is the verb, the quote is the object. | dir-b brief + `lib/inbox.ts:487` |
| The row's **one action** (Discard, only on a row carrying a pending draft) is inline in the tail, `opacity:0` until hover, focus-within or `data-wbfocus`. CSS only, 120ms. The box never moves, so windowing stays exact. | dir-b brief |
| The card carries a **`layoutId`** and on the phone GROWS into the thread peer's header, which carries the same id. | Morphing Dialog (ibelick); Shared Element Gallery (jahed) |
| A thread with **more than one unread** is a **deck**: two inert `.dirb-dmpeek` edges behind the front card make the count visible; the count chip beside the time fans them on the one spring. The card's own tap still opens the conversation. | Sidebar News (dubinc); Stacked Activity Cards (spydiecy) |
| **Sticky day headers** with the live row count in the tail, grouped on `last.created_at` (the key `groupThreads` sorts by, so a group is contiguous). | dir-b brief |
| **Filters** are `Chip`s in a `.dirb-scroll-x` row; the "All" chip carries `inboxWaitingCount` as its `count`. | dir-b brief |
| The **swipe** on the draft card reveals the action UNDER the card, draws a tick in place once past the 72px threshold, and travels on `spring` instead of a 200ms ease. | BeUI Swipeable List; Todo List Item (uiverse) |
| The **pre-read** loading state is a shape-matched skeleton line beside "Reading it…" instead of four words alone. | Chat Thread Skeleton (cnippet.dev) |
| One **toast**, raised only by the row's Discard. Its action is "Open", which lands on the thread where `RestoreStrip`'s "Bring it back" already lives. | dir-b brief |

### S14 · the thread (`Thread.tsx`, `ThreadPeer.tsx`, `RestoreStrip.tsx`)

| Move | Reference |
|---|---|
| Only OUR words are boxed (`.dirb-bubble[data-mine="true"]`); the other party is plain left-aligned text. A hand-typed mirror keeps its own mark (`data-ours` + accent hairline). | Agent Chat (serafimcloud) |
| Day **dividers** are `Divider` + an eyebrow, not a pill. | dir-b brief |
| The stage ladder is `Stepper` (done steps take the lime fill). Archived and unknown stages still refuse to draw a position and say so in words. | originui/stepper |
| On the phone a **vertical drag off the header** takes the thread back to the list on `springSoft`, through `useDragControls` so the message column still scrolls normally. | dir-b brief |
| The composer is `Composer`; the two compose-off states render their existing sentence and no input, exactly as today. | dir-b brief |

---

## 2 · Motion table

| Rule | State change | Selector or animation | Property | Duration | Easing | Continuous |
|---|---|---|---|---|---|---|
| Card mount | a row enters the list | `motion.div variants={rise}` | opacity, transform | spring 400/32 | spring | no |
| List stagger | many rows mount | `variants={list}` (history) | delay only | 30ms step | — | no |
| Card leave | a row leaves | `AnimatePresence` + `rise.exit` | opacity, transform | 180ms | `cubic-bezier(.25,1,.5,1)` | no |
| Shared element | phone: card to thread header | `layoutId="dirb-dm-<id>"` | transform | spring 400/32 | spring | no |
| Deck fan | count chip tapped | `motion.span animate={{y}}` | transform | spring 400/32 | spring | no |
| Swipe track | pointer drags the draft card | `motion.div animate={{x}}` | transform | 0 while dragging | — | no |
| Swipe settle | pointer released short of 72px | same node | transform | spring 400/32 | spring | no |
| Under-action | a swipe starts / ends | `AnimatePresence` + `fadeT` | opacity | 180ms | `cubic-bezier(.25,1,.5,1)` | no |
| Tick | swipe passes threshold | `@keyframes dirb-draw` | `stroke-dashoffset` | 320ms | `var(--ds-ease)` | no |
| Thread dismiss | phone drag on the header | `drag="y"` + `dragSnapToOrigin` | transform | springSoft 300/34 | spring | no |
| Card lift | hover / active | `.dirb-lift` | background, border, transform | 120ms | `var(--ds-ease)` | no |
| Row action reveal | hover / focus-within | `.dirb-dmact` | opacity | 120ms | `var(--ds-ease)` | no |
| Day header condense | scroller moves off 0 | `.dirb-dayhead[data-stuck]` | border-color | 180ms | `var(--ds-ease)` | no |
| Toast in/out | a discard runs | `ToastStack` (ds) | opacity, transform | spring / 180ms | spring | no |

At most one continuous loop on the surface: none. Nothing animates width,
height, top, left, margin or padding. No `transition: all`. `dms.css` carries no
colour literal, no px font-size and no px radius.

---

## 3 · Ledger

**S02 — every row kept**, except three that belong to a host this override does
not replace:

* **S02-15 (OpsPending), S02-33 (swipe-hint footer), S02-40 (Drafts segment
  tabs)** — all three are rendered by `DraftsScreen`, not by `DmsSurface`; the
  ledger says so itself. The brief's source list names only `DraftCard`,
  `StaleBar` and `PushedBar` from that file, so `DraftsScreen` ships unchanged
  and keeps all three. **Consequence:** the direction's `Segmented` has no
  control to convert on this surface, so the lane filters stay `Chip`s (which is
  what the brief asks for) and no `Segmented` is rendered.

Kept with a noted deviation:

* **S02-29 (windowing)** — kept, with the arithmetic widened. The stock window
  divides a scroll offset by a fixed 73px row. This list has two item shapes (a
  day header and a card), so `useRowWindow` sums exact item offsets once per
  render instead. Same contract: opt-in via `windowed`, a visible slice, two
  spacer divs holding the remainder open, off whenever `renderRow` is supplied.
  Heights are pinned in both places: `CARD_H = 96` / `DAY_H = 32` in the module,
  `height:calc(var(--ds-s11) + var(--ds-s8))` and `var(--ds-s8)` plus an
  `--ds-s3` margin in `dms.css`. **A change to either must change both.**
* **S02-3 (search)** — the field is `Input type="search"`. The command layer
  finds it by `.wb-work input.search-in, .wb-work input[type=search]`
  (`CommandLayer.tsx:82`), so `/` still focuses it; `Input` does not put a class
  on the inner element, and `type=search` is the seam that already exists. The
  browser's own cancel button is hidden so the ledger's own ✕ is the only one.
* **Glyphs → lucide icons.** `✦` `🔍` `✕` `‹` `↑` `⌄` `›` `ⓘ` `✓` are decoration,
  and a unicode glyph in TSX is banned by the copy rules. Each is now an
  `<Icon>`; every WORD around them is verbatim, including `Draft:`, `You:`,
  `Asked`, `Show N more` and `N older still folded`.

**S14 — every row kept.** One structural decision:

* **S14-28…S14-39 (S21 Context Sheet, S20 Push-later sheet)** — kept by
  importing `components/ContextSheet` and `components/PushLaterSheet`
  unchanged. `PushLaterSheet` is reached through `usePushLater()`, a provider
  mounted at the app root, so a builder working inside this folder cannot repaint
  it at all; `ContextSheet` is shared with surfaces outside this screen group.
  All twelve items work exactly as today, in their current paint.
* **S14-26** — `Composer` has no `disabled`, so its textarea is not visually
  disabled while a write is in flight. The refusal is unchanged and still the
  real gate: `onSend` returns early on `busy`.
* **S14-12/19/21** — the three edit boxes are raw `<textarea class="ds-textarea">`
  rather than the `Textarea` primitive, because the primitive forwards no ref and
  S14-12's auto-grow measures `scrollHeight` off the element itself. Same class,
  same look.

Data writes: **untouched**. `approveDraft`, `discardDraft` (both guards, both
false-is-not-success branches), `snoozeDraft`, `unsnoozeDraft`, `saveDraftText`,
`saveDraftEmail`, `restoreDraft`, `escalateDraftToClient`, `composeReply`,
`markThreadRead` are called from the same handlers, in the same order, behind the
same confirm sheets, with the same strings. Nothing new writes anything.

Keyboard: **untouched**. `RowSelect` is imported as-is and the card keeps the
class `r`, which is what `closest('.ct-card, .r')` walks to stamp `data-wbrow`,
`data-wbsel` and `data-wbfocus`; `j`/`k` walk it, `x` selects it, Enter clicks it
(the card is the `onClick` node), `/` focuses the search field, `⌘K` is the
layer's. `.r` is also what `PreReadNote`'s `avoidEl` anchors against and what the
S14 screenshot recipe clicks, and `client rowlink` is still on the copy-chat
chip. `dms.css` restates the card's box at `.dirb.dirb.dirb .dirb-dmcard.r` so it
outranks faithful.css / wbsys.css rather than hoping to be imported last.

---

## 4 · Decisions taken without asking

1. **`layoutId` only on the phone.** `planWorkbench` unmounts the work surface
   when a peer takes the screen on mobile (`layout.ts:140`, `work: 'hidden'`), so
   there the card and the peer header are never both live and the grow is a real
   shared element. On desktop both are on screen at once; two live nodes on one
   `layoutId` is a fight, not a shared element, so desktop shares nothing.
2. **The deck fans from the count chip, not from the card.** Tapping the card has
   opened the conversation since S02-16 existed, and that is not a thing to take
   away for a flourish. The fan is transform-only and changes no height, so the
   window's offsets hold.
3. **The undo toast offers "Open", not "Undo".** There is no undo write for a
   discard that is safe to call from a list — `restoreDraft` is gated by
   `canRestore`, which needs the thread. "Open" is a real route to the real
   control. A button that could not undo would be a lie.
4. **No `Segmented` on this surface.** See S02-40 above.
5. **No loading skeleton in the thread.** `ThreadScreen` receives a fully
   hydrated `Thread`; there is no fetch to be pending. The shape-matched skeleton
   went where a real load exists: the pre-read.

## 5 · Seam requests

None. Everything this screen group needs is already reachable from the folder.
