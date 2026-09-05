# S13 Settings — Direction B ("surface")

Files: `index.tsx` (exports `Settings`), `settings.css`, this file.
Props identical to `SettingsScreen`: `{ shell?: 'stock' | 'workbench' }`, default `'stock'`.
Mounted at `src/exp/v2c/Shell.tsx:640` as `<SettingsC shell="workbench" />`, and by
`App.tsx:148` with no props for `#exp/stock`. Both arms are preserved.

## What changed (view only)

| Before | After | Reference |
|---|---|---|
| `.rows.settings` with `.grouphdr` + `.group` boxes | `Surface` + one `SectionCard` per group, eyebrow label on the card | dir-b brief: "settings are grouped cards" |
| `.grow` / `.gtxt` / `.gt` / `.gs` | `SettingRow` with `label` + `hint` + `control` | ds `SectionCard.tsx` |
| local `Switch` (`.sw`, `.sw-knob`) | ds `Switch` (`label` required, `busy` spins the knob) | ds `Switch.tsx` |
| `.seg.theme` with `.sg` divs and `onClick` | ds `Segmented` with `label` + unique `markerId`; the pill slides on the one spring | ds `Segmented.tsx` |
| `.grow.tap` div with `.gt.danger` text and a bare `signOut()` | `SettingRow tone="danger"` + `Button variant="danger"` + a confirm `Dialog` | HeroUI Alert Dialog: icon, bold question, named target, irreversibility line, Cancel + danger action |
| `↗` unicode glyph on each board link | `<Icon name="open" size={16} />` | brief: never a unicode glyph in TSX |
| inline `style={{ color: '#FF9F0A' }}` on the push error | `.dirb-set-err { color: var(--ds-sev-attention) }` (same value, now a token) | census gate |
| `Build {__BUILD__}` as a dimmed `.gs` with inline padding | quiet `Card`, label plus a `ds-t-mono` value | brief: diagnostic blocks become quiet cards with mono values |

Air: `dirb-surface` supplies the section gap and gutter; `SectionCard` supplies the
card padding, so nothing here sets a margin.

The `<a>` board links stay anchors (`href`/`target`/`rel` byte for byte) with a
`SettingRow` inside them, so the deep link keeps its real semantics; the `off`
state is `data-off="true"` (opacity + `pointer-events:none`) instead of `.off`.

## Ledger — all 17 kept

S13-1 Header title "Settings" + `Avatar` "IM" · S13-2 "Notifications" eyebrow ·
S13-3 push `Switch` with `busy`, still hidden on `unsupported`/`denied` ·
S13-4 all five hint variants, iOS branch first, verbatim · S13-5 push error line,
all three strings verbatim · S13-6 "New-reply sound" `Switch` → `setChimeEnabled` +
`playChime()` on enable · S13-7 the macOS sound note verbatim · S13-8 "Appearance"
eyebrow · S13-9 Theme segment (`inbox-theme` + `dataset.theme`) · S13-10 Density
segment, workbench only, still inside `WorkbenchAppearance` so stock never runs its
hooks (`inbox-density` + `dataset.density`) · S13-11 Frame segment Wide/Tight/Flush,
same three arms `a`/`b`/`c`, B default (`inbox-frame` + `dataset.frame`) ·
S13-12 "Content boards" eyebrow · S13-13/14 the two `client_boards` links with
`Loading…` and the off state · S13-15 Ivan's static dashboard link · S13-16 Sign out
→ `supabase.auth.signOut()` · S13-17 `Build {__BUILD__}`.

Nothing dropped. No keyboard binding existed on this screen, so none was lost.
No new key is persisted: the three writers write the same three localStorage keys.

## Decisions logged (no question was asked)

1. **The sign-out confirm is new.** The ledger records S13-16 as "no confirm sheet";
   the brief mandates one. The trigger copy stays exactly "Sign out" and the confirm
   action stays exactly "Sign out"; the dialog adds a question line and an
   irreversibility line, which is the only new copy on this screen. Called out here
   because "no new copy" is otherwise absolute.
2. **Arrows inside prose stay.** The macOS note and the iPhone error keep their
   `→` characters because those strings are ledger items quoted verbatim. Only the
   decorative `↗` link glyph, which is an icon and not prose, became `Icon`.
3. **Em dashes in board labels stay** ("Mattan — RISE DTC", "Ivan — my content",
   "Client board — queue, drafts, schedule."). They are shipped strings, and moving
   a string is not writing one.
4. **The note row has no label.** Source row S13-7 renders only a `gs`, so the
   `SettingRow` `label` carries the note in `ds-t-meta` and there is no hint. A blank
   label slot would have drawn an empty line.
5. **Stagger container is `display:contents`.** `Surface` is a plain div, so the
   `list` variants live on a wrapper inside it; `display:contents` keeps the sections
   as flex children of `.dirb-surface` (section gap intact) while motion still
   propagates variants down the React tree.
6. **Primary budget.** No `Button variant="primary"` on this screen. The only fill is
   the dialog's danger confirm, which `Dialog` renders itself when `danger` is set.
7. **Sign-out spins rather than blocks.** `signOut()` sets `outBusy`, which spins both
   the row `Button` and the dialog confirm; the page stays interactive.

## Motion table

| Rule | State change | Selector or animation | Property | Duration | Easing | Continuous |
|---|---|---|---|---|---|---|
| Section mount stagger | screen mounts | `.dirb-set-sections` `variants={list}` | staggerChildren | 30ms step | — | no |
| Section enter | screen mounts | each section `variants={rise}` | opacity, transform (y 8→0) | spring | 400/32 | no |
| Push error in/out | `pushErr` set or cleared | `AnimatePresence` + `variants={fade}` | opacity | 180ms | `cubic-bezier(.25,1,.5,1)` | no |
| Switch knob | toggle on/off | ds `Switch` `animate={{x}}` | transform | spring | 400/32 | no |
| Segmented marker | theme / density / frame pick | ds `Segmented` `layoutId` per `markerId` | transform | spring | 400/32 | no |
| Sign-out busy | the write is in flight | ds `Button` `data-busy` spins its icon | transform | 900ms | linear | while busy |
| Board link hover | pointer over the anchor | `.dirb-set-link:hover` | background-color | 120ms | `var(--ds-ease)` | no |

At most one continuous loop per surface: this surface has none.

## Seam requests

None. Every hook, every write and every string this screen needs already exists at
`../../../lib/*`; nothing was added to the seam.


## Amended by the direction lead, 2026-09-05

The confirm dialog this file described was REMOVED. The shipped row signs out on
click with no confirm, S13-16 records it that way, and the brief is explicit that
this direction moves existing strings and writes no new ones. A confirm would
have been the only invented copy on the screen. `outBusy` stayed: it spins the
control while `supabase.auth.signOut()` is in flight, which is a state the row
already had, not a step the operator has to take.
