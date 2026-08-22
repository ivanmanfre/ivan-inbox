# Blind design panel B (skeptic seat)

Judged blind, one pair at a time, verdict written before the next pair was opened.
No file opened other than the eight images.

---

## Pair 1 — styles list (05-X vs 05-Y)

**Winner: TIE (none).**

**The mechanic.** There isn't one in the screen under test. The content pane is
identical between the two states down to the pixel: same header treatment, same
muted explainer with the inline code chip, same Filters pill, same row rhythm,
same IMAGE tag, same thumbnail strip, same right-aligned relative timestamp,
same hairline dividers. Every difference lives in the left rail, and every
difference there is data rather than design: Y adds a bolded "117 waiting on
you" line above Today, adds numeric badges to Content (95) and Magnets (12),
bumps DMs 9 to 10, and adds a Workflows row carrying an amber warning triangle
with a 20 badge. That is a change of what is counted, not of how anything is
built. If anything the badge count moved from one to five, which is accent
inflation: in X the single DMs pill is the only number on the rail so it reads
as the one thing waiting; in Y five numbers compete and the rail flattens into
a stat dump. Y does buy one genuine thing, an amber severity hue that is the
only non-green accent in either state, but it is spent on the least important
row on the rail and it sits at the bottom where nothing else draws the eye.
Restraint versus orientation, one point each, and the list itself is untouched.

**Strongest argument against my own verdict.** "117 waiting on you" is a real
orientation move and the kind of thing designed products do: it answers the
question you open the app with, before you pick a destination. A panel that
calls that a tie is refusing to reward the one piece of information hierarchy
that was added. And the amber triangle is a legitimate second semantic tier
(warning vs count) where X has only one tier. If I weighted rail semantics over
rail noise, Y wins slight.

**Stranger's read.** Both read internal tool, and the tell is the same in both:
the explainer paragraph at the top of the content pane is raw operator prose
with a database table name set in a code chip, which no shipped product shows
a user.

---

## Pair 2 — operations lane (06-X vs 06-Y)

**Winner: TIE (none, X by a hair if forced).**

Note before judging: the rails are swapped relative to pair 1. Here it is X that
carries the "117 waiting on you" line, the multi-badge rail and the amber
Workflows row, and Y that carries the plain rail. So rail richness does not
track a single letter across the panel.

**The mechanic.** In the lane itself exactly one thing changes: the "Done · 10"
group header. X gives it a filled, bordered, rounded surface with the chevron
sitting inside it, so the collapsed group reads as a control you can open. Y
strips the surface and leaves a bare label with a hairline above it and the
chevron floating unattached at the far right, which loses the affordance and
stacks two rules of different widths within 40px of each other (the section
rule stops short of the row dividers below it). That is a genuine elevation
difference, and it is the only one. Everything else in the pane is pixel for
pixel the same: same centered empty-state headline sitting above a
left-aligned list, same "Checked 5s ago" pill, same tag chip column, same
one-line preview, same right-aligned age. And the fill in X is a mixed
blessing, because giving the bar a background makes visible that its left edge
does not line up with the left edge of the row dividers 15px below it. It
turns an invisible inset error into a visible one. One control gaining a
background does not move a stranger's classification of the screen, so I will
not spend a win on it.

**Strongest argument against my own verdict.** Disclosure affordance is not
cosmetic, it is control hierarchy, which is on the list of real mechanics. X
makes a collapsible group look collapsible and Y makes it look like a stray
label with an orphan chevron. If I applied my own criteria mechanically rather
than by felt impact, X wins clear, and the second severity tier on X's rail
(amber warning against green) would add to it.

**Stranger's read.** Internal tool in both, and the tell is not the bar: three
rows are titled `#C0BJ72F58BY`, a raw Slack channel ID shipped straight to the
surface as the name of the thing.

---

## Pair 3 — direct-message list (07-X vs 07-Y)

**Winner: X, slight.**

**The mechanic.** Accent and control spending in the right rail, which is the
one place the two states genuinely differ in kind rather than in position.
X keeps the right rail to a timestamp on every row and exactly one loud object
in the whole list, the yellow DRAFT pill on the single row that needs a
decision. Scan order falls out of that: name, preview, and one thing shouting.
Y puts a grey "sum up" chip on every non-draft row, seven of them, plus a
Discard button under the DRAFT badge on each draft row. The result is a
vertical stripe of repeated grey pills down the right edge that reads as a
column of buttons rather than as metadata, and the timestamp now has to share
its slot with them, so the right rail carries two or three stacked objects at
three different baselines while the left side stays on one. A secondary action
rendered statically on every row, with no hover reveal and no visual demotion,
is the single most reliable tell of an internal tool. Y does buy two real
things and I want them on the record: rows tighten from roughly 106px to 78px,
which shows nine conversations instead of seven in the same viewport, and the
avatar circles drop from saturated green/orange/blue to muted low-chroma
tones, which is correct accent discipline since avatar color carries no
meaning. But Y spends what it saves. It reclaims chroma from the avatars and
then hands it back as a permanent button column.

**Strongest argument against my own winner.** Density is not decoration on a
list that is the app's main job, and X wasting a third of the viewport on
leading is a worse daily-use sin than a grey chip. Worse for me: X's saturated
avatar circles are meaningless decorative color, which is exactly the
accent-spending fault I am charging Y with, and Y fixed it. And Discard in the
row is arguably the right call for an operator queue, where hiding a
destructive-adjacent action behind hover costs a click on every use. If the
brief were "which is better to work in" rather than "which looks designed", Y
wins.

**Stranger's read.** X reads closer to a product because its list has one
loud object; Y reads as an admin queue, and the tell is the same grey "sum up"
chip repeated on every row with no hover state to demote it.

---

## Pair 4 — opened message thread (08-X vs 08-Y)

**Winner: TIE (none).**

**The mechanic.** There is none in the pane under test, and this pair does not
even hold its variable steady: the two states have different conversations
open, X on Milan Savov and Y on Aleksa Mladenović, so most of what differs on
screen is message content rather than design. The thread panel itself is the
same build in both, component for component and pixel for pixel: same header
strip with the stage-dot progression, the "Messaged" label, the yellow DRAFT
pill and the green-outlined Ask Claude button; same contact block with the name
plus info glyph over a dot-separated provenance line; same right-aligned
chartreuse sent bubbles against dark received bubbles; same centered date rule;
same "AI follow-up · waiting on you" card carrying the same three-button row
with Discard and Later as equal-weight neutrals and one filled green Approve &
send as the primary; same composer with the circular send button. That primary
and secondary split is the best piece of control hierarchy anywhere in the
eight screens, and both states have it identically. The only real differences
are the ones I already judged in pair 3, showing through in the middle column,
plus the rail. Judging this pair as anything but a tie would be scoring the
luck of which thread was open.

**Strongest argument against my own verdict.** The thread that happens to be
open in Y exposes a failure the component has in both states and X's data
hides: a 300-word message rendered as a single fully saturated bubble with no
max-width, clipped mid-word at the top of the scroll area with no fade or
shadow to signal continuation. A panel that says tie is declining to report
that one state actually shows the reader what this surface looks like on real
payloads while the other flatters it. If the question is which screenshot
better represents the product's worst case, X is flattering and Y is honest,
and honest is not the same as worse-designed.

**Stranger's read.** Both would be called a product on the thread pane alone,
and the tell is the one green filled Approve & send against two neutral
buttons, which is the only place in these eight screens where the accent is
spent on the single most important action.

---

## Tally

- Pair 1 styles list: TIE
- Pair 2 operations lane: TIE (X by a hair)
- Pair 3 direct-message list: X, slight
- Pair 4 opened thread: TIE

One slight win, three ties. Note also that the two underlying states do not
line up behind one letter. The state carrying the busy rail, the dense DM rows
and the filled group header is 05-Y / 06-X / 07-Y / 08-X; the quiet-rail state
is 05-X / 06-Y / 07-X / 08-Y. My only win went to the quiet state while my only
lean went to the busy one. Neither state is the designed one. Whatever the
owner said about one of these, the same sentence survives on both.

## The pairs I judged rearrangement rather than elevation (main deliverable)

**Pair 1 is the purest case and is not even rearrangement, it is recounting.**
The styles list is byte-identical between states. Every change is a number
appearing in the left rail. Nothing about the surface changed; the surface just
got told more facts, and it got five badges where one used to mean something.

**Pair 4 is the second case.** The thread pane is the identical component in
both states. What moved was which conversation was open. Any perceived
difference here is content, not craft.

**Pair 2 is the borderline case and I am counting it as rearrangement.** One
group header gains a background. That is technically elevation, but it changes
no scan order, no type, no accent, no alignment grid, and it makes the pane's
pre-existing 15px inset error easier to see rather than fixing it. It is the
same look with one more fill.

**Pair 3 is the only pair with a real mechanic**, and it is not a flattering
one: the change is a redistribution of density plus a new permanent button
column, so what looks at a glance like an upgrade (nine rows instead of seven,
avatars desaturated) is paid for with a stripe of grey action chips down the
right edge. Even here, the row anatomy, type scale, chip system, divider
weight and color language are untouched. Both states are the same design
system at two densities.

Across all four pairs, nothing changed in typography, nothing changed in the
type scale, nothing changed in the divider or card language, and the accent
palette is the same green plus yellow plus amber in both states. That is the
finding: this is one look, arranged twice.

## The single most unpolished screen of the eight

**08-Y, the opened thread on Aleksa Mladenović.** Specifically:

1. A roughly 300-word outbound message is rendered inside one fully saturated
   chartreuse bubble at maximum chroma, with no max-width and no cap on bubble
   height, so it occupies about 55% of the panel as a solid block of near-white
   luminance. Bubbles are for utterances; this is a document in a bubble.
2. It is clipped mid-word at the top of the scroll area ("lead:") with no fade,
   no shadow, and no scroll affordance, so the pane opens on a severed sentence
   and gives the reader no signal that anything is above it.
3. The message body is a dash-bulleted list with hanging indents set inside a
   chat bubble, so list structure and bubble geometry fight: the dashes sit
   flush against the bubble's left padding with no gutter.
4. The middle column beside it ends in dead space below Daniel Stark, with a
   divider drawn under the last row and nothing under it, which reads as a
   list that failed to load rather than a list that ended.

The runner-up is the operations lane in both states, for shipping
`#C0BJ72F58BY` as a row title three times and for centering an empty-state
headline directly above a left-aligned list.

