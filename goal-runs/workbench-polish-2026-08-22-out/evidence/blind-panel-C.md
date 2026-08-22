# Blind design panel C

Judged blind, one pair at a time, no knowledge of which state is older.

## Pair 1 — lead-magnet lane (09-X vs 09-Y)

**Winner: Y. Margin: slight.**

**Why.** The two are the same layout, so the verdict rests on four small mechanics, all of which go to Y.

1. Raw system vocabulary. Mid-page under the "Lead-magnet ideas" header, X reads "5 lead-magnet rows at `reviewing`" with `reviewing` set in a monospace code chip. Y reads "5 lead-magnet rows waiting for review". A code-styled database enum sitting in a body sentence is the single loudest artifact in either shot: it tells the viewer the screen is a thin skin over a table.
2. Group headers get a surface. In Y the "Lead-magnet ideas" header row (y≈275) and the status tab strip (y≈643) each sit on a faintly lighter band running the full content width, so those two rows read as section furniture and the item rows read as content on top of them. In X both bands are the same value as the page, so the header and the tab strip float in the same plane as the list and the eye has no structural stops between the error banner and the bottom of the list.
3. Left rail information. Y carries counts on the rail items (Content 95, Magnets 12, Workflows 20) and a header line "117 waiting on you". Right or wrong as a number choice, it gives the rail a consistent badge system and a top-of-rail anchor. X has a single stray "2" on Content and an empty gap where Y has Workflows, so the rail's badge language looks half-applied.
4. Scan order. Y's banded header/tab rows chunk the list into two visible groups (ideas above, needs-review below). X presents one undifferentiated 9-row stack with a tab strip buried inside it at y≈643, which is genuinely confusing: the tabs look like they belong to the row above them.

Everything else is identical and identically mediocre in both: same red error banner, same chip row, same 61.9 / 57 / 56 score badges.

**Does the loser read as an internal tool built by an operator for himself? Yes.** Strongest tell is the literal `reviewing` enum rendered in a code chip inside a sentence. Second tell is the tab strip with raw counts (Idea 109, Published 43, Errors 1, Archived 31) floating with no container.

**What is still wrong with the winner.**
- The red error banner at the top (y≈122) is the brightest object on the screen and it is spent on "1 errored" with no action and no way to dismiss or open it. The most saturated colour in the whole UI is being used on a one-item background condition.
- The score badges (61.9, 57, 56, 55.82) are unrounded floats in the leftmost, first-read position of every row. 55.82 to two decimals in a scan column is a debug value, and it pushes the row titles off a common left edge: 61.9 starts titles at x≈293 while 57 starts them at x≈292 only because the badge widths happen to be close. Nothing enforces the column.
- Left rail baseline drift: "117 waiting on you" mixes a 22px numeral with 11px caption on one line, and it sits above "Today" without any divider, so it reads as a broken nav item rather than a summary.
- Radius inconsistency across the chip row at y≈173: the search field, Status, Format and Filters are all pill-radius, but the tag chips in the rows (COMPETITOR, MANUAL, CALL) are 4px rectangles, and the tab strip items are pill again. Three radii in one column.
- The tag chips are uppercase 9px letterspaced grey on grey, below comfortable contrast, and they sit tight under the title with no baseline grid.

## Pair 2 — command palette over the app (10a-X vs 10a-Y)

**Winner: Y. Margin: slight.**

The palette itself is close to identical in both: same width, same left-aligned two-column rows (bold verb, grey explanation), same right-hand key caps, same MOVE / SELECT / ACT group labels. So the verdict comes down to two copy edits inside it and the state of the list behind it, and the points genuinely split.

**Where Y wins.**
- Footer hint bar (y≈697). X reads "↑↓ to move · Opens, never acts · Enter to run · Esc to close · ? for every key". "Opens, never acts" is a subjectless fragment addressed to someone who already knows what the palette does to rows; it sits in the same list as four verb-object hints and breaks the pattern. Y drops it and leaves four parallel items. Four parallel hints scan as a designed footer; five with one non-parallel private note scan as a changelog.
- Placeholder (y≈115). Y's "Type to find a command, a lane or a row" names the three searchable object types. X's "Find a command, or anything you have written" promises a scope the row list does not show and reads as an author's aspiration.
- The list behind the scrim. X's right gutter carries a repeated small grey "sum up" pill on every non-draft row (y≈360, 438, 515, 592, 669, 745, 823) plus a "Discard" button under each DRAFT badge. That is a per-row secondary action rendered as a permanent button on every line, seven copies of the same grey pill stacked down one edge. Y's rows carry only a right-aligned relative timestamp, with taller rows (about 100px pitch versus about 88px) and full-width dividers. Behind a modal, X's background reads as a control panel and Y's reads as a list.

**Where X wins.** The left rail. X has the complete badge system (Content 95, Magnets 12, Workflows 20 with an amber warning glyph) and a top-of-rail summary "117 waiting on you". Y's rail has a lone "2" on Content, no Magnets count, no Workflows row, so its badge language looks half-applied and the rail bottom is a large empty gap above Settings. This is a real point against Y and it is why the margin is slight rather than clear.

**Does the loser read as an internal tool built by an operator for himself? Yes.** Strongest tell in X is "Opens, never acts" in the footer: three words that only make sense to the person who wrote the selection model. Runner-up is the wall of identical "sum up" pills down the right gutter of the underlying list.

**What is still wrong with the winner.**
- The command list is sliced. "Skip the selected rows" at y≈670 is cut in half by the footer bar at y≈683 with no scrollbar, no fade, no shadow under the footer. A modal whose content is guillotined mid-row is the clearest single defect in either shot.
- Half the palette is greyed out with inline excuses: "no row is focused yet, press j to start" appears twice, "nothing is selected" three times. Five disabled rows out of thirteen, each explaining its own disablement in body text. A designed palette would hide or reorder unavailable commands, not print their preconditions.
- The palette contains an entry to open the palette ("Command palette / Opens this palette. Ctrl+K does the same on a keyboard with no ⌘."). Self-referential, and the explanation discusses keyboard hardware.
- Key caps are inconsistent objects: single glyph pills (j, k, x, ?), word pills (Enter, Esc), a modifier pill (⌘K), and a grey "no key" placeholder pill that occupies the same slot as a real binding. "no key" styled as a key is a null value drawn as data.
- The search field at the top of the page (y≈47) uses an emoji magnifier rather than an icon, and it renders at a different weight and colour from every other glyph in the chrome.
- The brightest colour on the screen is the yellow DRAFT badge at (1372, 233), a status label, not an action. Nothing on the screen is that bright for anything the user can do.

## Pair 3 — assistant chat pane beside the app (10b-X vs 10b-Y)

**Winner: X. Margin: clear.**

**Why.**
1. Row rhythm in the middle column. X fits 7 conversations at roughly 107px pitch; Y fits 10 at roughly 77px. In X each row is a three-part block (name plus lane tags, preview line, right-aligned time) with real space above and below the divider, so a row reads as one object. In Y the same three parts are compressed and a second control column is jammed into the right gutter, so name, tags, preview, "sum up" pill and timestamp all fight inside 77px.
2. Repeated utility controls. Y stacks a grey "sum up" pill on seven rows (y≈404, 482, 558, 636, 713, 790, 867) and a "Discard" button under each of the two DRAFT badges. Nine small grey buttons down one edge, all the same value, none of them primary. X shows none of them; its right gutter holds only relative times plus a single yellow DRAFT badge. In X the eye finds one accent per screen. In Y it finds a control panel.
3. Where the pane content starts. X's assistant pane goes header, then straight into the prompt line at y≈127 and three suggestion cards at y≈241, 298, 356, with the cards sitting in the upper third where they are read first. Y inserts a strip at y≈110 ("Claude can see 1 thing, names and states only", plus bare text links "Detach all" and "Show me", plus a removable chip "DMs, all lanes ×") and pushes the same content down about 70px. That strip is the most engineer-flavoured object in either shot: it reports what was injected into a prompt, counts it as "1 thing", and renders its two actions as unstyled 11px words with no button, no underline and no separator from the header above.
4. Bottom edge. Y's list is guillotined mid-row: at y≈863 the "Romaniia Dzhevaha" row shows a name, a tag and half an avatar before the window ends. X's last row (Daniel Stark, y≈787) completes and closes with a divider and clear space beneath. A list that ends on a sliced avatar is the single strongest "unfinished" cue on the screen.
5. Banner separation. X sets 83px between the "2 drafts pushed to later" banner and the first conversation row; Y sets 56px, and the banner's bottom edge nearly touches the first row's tags, so the banner stops reading as a separate object on its own surface.

**Where Y wins.** Same as pair 2, the left rail: Y has the full badge set (Content 95, Magnets 12, Workflows 20 with amber glyph) and "117 waiting on you", where X's rail has a lone "2" and a large dead gap between Claude and Settings.

**Does the loser read as an internal tool built by an operator for himself? Yes.** Strongest tell is the line "Claude can see 1 thing, names and states only" with "Detach all" beside it. That is prompt plumbing surfaced as chrome, phrased in the vocabulary of whoever wired the context.

**What is still wrong with the winner.**
- The pane header carries the word "default" twice in two forms: the pill "default" at (1320, 55) and the subtitle "Container default" at (935, 70). "Container" is a deployment word appearing as the assistant's identity line.
- The empty-state body explains architecture to the user: "Every turn starts a fresh Claude session, the transcript above is the continuity, not the model's memory." An operator's mental model printed into the UI, and it references "the transcript above" when there is no transcript above.
- Roughly 400px of dead vertical space between the last suggestion card (y≈380) and the composer (y≈841), with nothing anchoring the middle of the pane.
- The three suggestion cards sit at almost the same value as the pane background, so they blend into their container instead of sitting on it. No icon, no leading affordance, no hover cue visible, and no hierarchy among the three.
- Composer row radius chaos: a rounded-square icon button at (861, 841), a pill "Live" at (914, 841), a large-radius input field, and a circle send button at (1387, 841). Four shapes in one 40px strip.
- Case inconsistency: page title "DMS" versus pane copy "the dms you're looking at".
- The middle column is truncated hard at x≈725, cutting every preview mid-word, while 100px of empty gutter sits to its right before the divider at x≈829.
- Emoji magnifier in the search field at (482, 47), rendering at a different weight and colour from the rest of the chrome.

## Tally

- Pair 1 (lead-magnet lane): **Y**, slight.
- Pair 2 (command palette): **Y**, slight.
- Pair 3 (assistant chat pane): **X**, clear.

The panel does not sweep. Note that the shots group by left-rail treatment: 09-Y, 10a-X and 10b-Y all carry "117 waiting on you" plus Workflows 20 and full rail counts, while 09-X, 10a-Y and 10b-X carry the sparse rail. On that grouping the sparse-rail set takes 2 of 3, and its two wins are the wider margins. So whichever state is which, no single state is uniformly the more designed one: the full-rail state owns the sidebar and the plain-English status copy, and the sparse-rail state owns row rhythm, restraint in the right gutter, and a pane that does not lead with plumbing.

### Where the winners still read as an internal tool, specifically

- **Pair 1 winner (09-Y):** unrounded float scores 61.9 / 55.82 in the first-read column of every row, and a red banner that spends the screen's most saturated colour on "1 errored" with no action attached.
- **Pair 2 winner (10a-Y):** the command list sliced mid-row by the footer bar at y≈683 with no scroll affordance; five of thirteen commands greyed out while printing their own preconditions ("nothing is selected", "no row is focused yet, press j to start"); a "no key" pill drawn in the keybinding slot.
- **Pair 3 winner (10b-X):** the assistant pane header reading "Container default" under "Claude", and the empty state explaining "Every turn starts a fresh Claude session, the transcript above is the continuity, not the model's memory."

Across all six shots the same three habits do the damage: system vocabulary printed as UI copy (`reviewing`, "Container default", "Opens, never acts", "Claude can see 1 thing"), the brightest colour spent on statuses rather than actions (DRAFT, "1 errored"), and containers that do not sit on anything, so headers, banners and cards share the page's value and the eye finds no levels.
