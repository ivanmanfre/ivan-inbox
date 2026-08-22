# Phase 1 - the design system this repo never had

Authored by the orchestrator from three inputs, all on disk:

- `evidence/system-audit.md` and `evidence/audit-tools/out-surface-pairs.json` - what is actually painted, measured off the running build
- `evidence/reference-study.md` - how Linear, Vercel Geist, Raycast, Amie, FullCalendar and Attio solve these exact five problems, with URLs
- `before/` - the ten baseline surfaces as Ivan sees them

## The diagnosis, in one measurement

A calendar chip and the day cell under it are both `rgb(31,31,31)`. Both have a 12px radius. The chip has no border and no shadow. Its only separation from its parent is a 3px coloured bar on its left edge.

```
div.cal-chip on div.cal-day :: rgb(31,31,31) border=none shadow=none r=12px 108x87
```

That is a rounded rectangle sitting inside a rounded rectangle of identical colour. The eye has no lightness cue, so it reads the inner shape's edge as a bevel. **That is the "ugly 3d". It is not a shadow that needs removing, it is a missing lightness step.** The run before this one removed the chip's fill and its ring precisely because they looked raised, which deleted the last cue and made it worse.

47 painted parent/child pairs across eight surfaces are the same colour as each other. The worst is Ops, where `div.dd-card` contains `div.dd-card` at identical `rgb(31,31,31)`.

Linear rebuilt its theme engine in LCH specifically so elevation could be a lightness progression instead of a shadow stack ([source](https://linear.app/now/how-we-redesigned-the-linear-ui)). Geist's rule is that a border or nothing carries static content and shadow is reserved for things that overlap other content ([source](https://vercel.com/geist/materials)). This app has tokens for neither. It has `--surface1-3` and then uses `--surface1` for both a container and its contents.

---

## 1. Elevation: a ladder, and one step per relationship

Five levels. Dark theme values first, light theme mirrored.

| Token | Dark | Light | What sits here |
|---|---|---|---|
| `--e0` | `#0C0C0B` | `#F7F7F4` | The plate. The ground under everything. |
| `--e1` | `#141414` | `#EFEFEC` | Recessed: input wells, progress tracks, an empty calendar cell, a scroll well. |
| `--e2` | `#1C1C1C` | `#FFFFFF` | Resting: panes, cards, a day cell with something in it, a list container. |
| `--e3` | `#272727` | `#FFFFFF` + hairline | Raised: a chip on a cell, a card on a pane, a secondary button, a hovered row. |
| `--e4` | `#323232` | `#FFFFFF` + shadow | Floating, overlay only: command palette, popover, menu, confirm sheet. |

Three rules, and they are the whole model:

1. **One step, never zero.** A child that must read as an object on its parent moves exactly one level up. Same level is banned wherever a relationship is intended. Two levels means it floats, and it had better actually float.
2. **Shadow is only for overlap.** `--e4` is the only level that may carry a shadow, and only because it covers content it does not belong to. A chip, a card, a button and a pane never get one. This is Geist's rule and it is the one that keeps the pistachio frame clean; a drop shadow bleeding onto `#C5E1A5` is exactly the 2013 artefact.
3. **Hairlines divide, they do not elevate.** `--hairline` drops from the current solid `rgb(48,48,48)` to `rgba(255,255,255,.07)` and is used for rules *inside* one surface. A border is no longer allowed to be the only thing separating two surfaces. Where a border currently does that job, the lightness step replaces it and the border is deleted rather than kept alongside.

`--surface1/2/3` stay defined, aliased onto `--e2/e3/e4`, so 7,674 lines of existing CSS inherit the ladder instead of being rewritten. The work is then to find every place a parent and child resolve to the same level and move the child up. `out-surface-pairs.json` is that worklist, and its re-run is the proof.

**Raised without a shadow.** Where something genuinely needs to read as tactile (the primary button at rest), use Raycast's move: a 1px interior top inset of `rgba(255,255,255,.10)` rather than any outer shadow ([source](https://oh-my-design.kr/design-systems/raycast), third-party extraction, flagged unofficial in the study). One inset, not a stack.

## 2. Radius: four values, and today there are seven

Measured in the running build: 6, 8, 10, 12, 16, 20, 40 and 999 are all live, frequently on elements doing the same job. Radius drift is half of why the surface reads as assembled rather than designed.

| Token | Value | Applies to |
|---|---|---|
| `--r-xs` | 6px | chips, tags, tiny controls, progress tracks |
| `--r-ctl` | 10px | buttons, inputs, tabs, day cells |
| `--r-card` | 14px | cards, panes, popovers, sheets |
| `--r-pill` | 999px | only where a pill is the deliberate form (lane jobs, counts) |

`--plate-r` stays separate; it is a ballot arm (§6).

Nothing else. A 20px card radius becomes 14. The chip's 12 becomes 6, which alone stops it reading as a lozenge.

## 3. Controls: one component, four variants, fixed geometry

Currently the draft window renders eight buttons across two rows: Approve (lime fill), then Edit, Schedule, Regenerate, Swap image, Back to idea as five identical grey rectangles, then Delete alone on a second row as a red-outlined box. Seven of the eight are the same weight to the eye. The brief said five; the measurement says six grey.

Geist ships Default / Secondary / Tertiary / Error at three sizes, and Linear's extracted values keep padding and radius **identical across tiers, varying only fill and border** ([Geist](https://vercel.com/geist/button), [Linear extraction](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1)). That constancy is what makes a row read as one family. Adopt it exactly.

```
.wb.wb.wb .wbb            32px tall, 0 14px, --r-ctl, 13px/1, weight 500, gap 6px
.wb.wb.wb .wbb-sm         26px tall, 0 10px, 12px
.wb.wb.wb .wbb-lg         38px tall, 0 18px, 14px
```

| Variant | Fill | Text | Edge | Used for |
|---|---|---|---|---|
| `.wbb-primary` | `--accent` | `--e0` | 1px inset `rgba(255,255,255,.10)` top | The one action the screen exists for. Exactly one per screen. |
| `.wbb-secondary` | `--e3` | `--text1` | none | Real actions that are not the point of the screen. |
| `.wbb-quiet` | transparent | `--text2` | none, hover fills `--e3` | Low-stakes and reversible. |
| `.wbb-danger` | transparent | `--sev-danger` | none, hover fills `rgba(danger,.12)` | Destructive, and it is set apart in the row rather than shouting in place. |

Geist's labelling rule comes with it: a destructive button says verb plus noun ("Delete draft"), and an icon-only button's accessible name states the action and its target, never the icon.

Minimum hit target 32px on pointer, 44px on touch. The audit lists every current control under 32px; all of them move.

## 4. The accent is a budget of one

Lime is currently spent, on the draft window alone, on: the Approve button, the "82" score meter, and eight of the nine QA dimension bars. Eleven accent-weighted elements on one screen. On the magnet window and the draft window the loudest object is a full-width lime "Post note" slab.

The rule, from Linear's discipline (one accent, one action per view - the *rule* is corroborated by two independent extractions even though they disagree on Linear's hex, so the study cites the rule and not the colour):

**Lime is allowed in exactly three roles.**
1. The single `.wbb-primary` on the screen.
2. The live/now state: the freshness dot, today's marker, an in-flight row.
3. The focus ring.

Everywhere else it is withdrawn. Specifically:

- The QA dimension bars stop using `--accent`. A score is a measurement, not a call to action. They take a neutral-to-positive semantic ramp (`--text3` track, `--sev-clear` fill, `--sev-attention` below threshold) which also makes the one low score readable instead of hiding among eight identical green bars.
- "Post note" becomes `.wbb-secondary`. Its screen's primary is Approve.
- Selected and active states use a lime *tint* at 10-14% alpha behind neutral text, not a lime fill. This is Raycast's low-alpha interactive tint, adapted: the app has one accent where Raycast has two, so the tint is how selection is expressed without spending the fill.

Before-count and after-count per screen go in the report. The DoD gate is exactly one accent-weighted primary action per screen.

## 5. Label and value: the box is deleted

The pattern is an ALL-CAPS label above or beside a value, inside a bordered box, stacked. The audit counts every instance; it appears in the draft inspector's four tabs, in QA, Source, Log, Fields, in Ops and in Settings. Linear's own docs describe the opposite model: the property value *is* the control, there is no bordered container anywhere in the interaction, and a keystroke reaches the field directly ([labels](https://linear.app/docs/labels), [priority](https://linear.app/docs/priority)).

One replacement pattern:

```
.wb.wb.wb .wbkv        display:grid; grid-template-columns:minmax(84px,26%) 1fr;
                       column-gap:16px; row-gap:6px; align-items:baseline
.wb.wb.wb .wbkv-k      13px, --text3, weight 400, NO uppercase, NO letter-spacing
.wb.wb.wb .wbkv-v      14px, --text1, weight 450, tabular-nums when numeric
```

No border, no fill, no box. Rows get a `--hairline` rule between them only past four rows. Sentence case labels, from `src/lib/labels.ts`, never a column name.

Density follows Linear's board-card decision: when a property list would overflow, show the two or three that matter at rest and defer the remainder to an expand, rather than shrinking everything to fit ([source](https://linear.app/now/how-we-redesigned-the-linear-ui)).

## 6. Frame geometry: built as a token, decided by ballot

`--plate-gap: 20px` and `--plate-r: 40px`. Measured cost at 1440: 40px of width, 2.8%.

**The orchestrator's finding, which the ballot must show honestly:** the frame is not where Ivan's space is going. On the calendar at 1440 the "Ready, no date" rail holds one sentence and occupies roughly 290px, seven times what the frame costs. The frame is what he can *see* taking space; the rail is what is actually taking it. Both get addressed, and the ballot renders the frame arms so the call is his either way.

Arms, rendered on his real calendar and his real draft window:

- **A** - as shipped: 20px gap, 40px radius.
- **B** - tightened: 10px gap, 22px radius. The pistachio stays, reads as a keyline rather than a mat.
- **C** - gap 0 on the work area, frame retained only as a 3px pistachio edge.

`--ground: #C5E1A5` does not change. Locked fork 2 permits the geometry to move and not the colour, and no arm proposes otherwise.

## 7. Motion, and only where it earns its place

The app has almost none, which is not automatically wrong, but state changes currently happen by teleport.

- Controls: 120ms `ease-out` on `background-color` and `color`. Nothing else.
- Overlays (palette, popover, menu, sheet): 160ms `cubic-bezier(.2,.8,.2,1)` on `transform` and `opacity` only.
- A row committing an action: a 200ms tint fade so the eye can follow what it just did.
- Never animate a layout property. `width`, `height`, `top` and `transition: all` are banned; they force reflow every frame and the perf census names offenders by selector.
- `@media (prefers-reduced-motion: reduce)` collapses all of it to 0ms.

## 8. How this gets applied without breaking the app

Every new selector carries three `.wb` classes. `faithful.css` contains `.wb.wb, .wb.wb *` which sets font-size on every descendant; a selector with fewer than three loses to it silently and renders at body size. This has cost this repo real time before, and it is not visible in review, only in computed style.

Order of work:

1. Tokens and primitives land in a new sheet, imported last, after `wb2026.css`.
2. The collision worklist from `out-surface-pairs.json` is walked surface by surface, and the file is re-run as the proof. The gate is zero same-level pairs where a relationship is intended.
3. Nothing is deleted from `faithful.css` in this phase. Overriding is reversible; deleting 4,210 lines of context is not.

## What this phase deliberately does not do

- It does not touch `--ground`, the rail structure, the lane model, or any prospect-facing string.
- It does not add a runtime dependency. The app has three and keeps three.
- It does not rewrite `faithful.css`.
- It does not decide the frame. That is Ivan's, and it is the ballot.
