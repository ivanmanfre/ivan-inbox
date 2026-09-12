/* ==========================================================================
   src/exp/v2c/commandRank.ts — HOW A TYPED QUERY ORDERS THE PALETTE (E4, goal
   run inbox-repair-floor-and-21st-moves-2026-09-12).

   Ported from kokonutd/action-search-bar (21st.dev, 502 uses): one field, and
   what is typed filters LIVE into rows of `glyph · action · context · ⌘-hint ·
   category`. The skin is discarded entirely (Tailwind, framer, lucide, the
   pill-shaped bar). What is ported is the behaviour: the list narrows as you
   type, the best answer is at the top, and the rows are VERBS.

   `matchWbCommands` (commandSource.ts) was a FILTER with no order in it: every
   token had to appear somewhere in the title, and whatever survived came back
   in registry order. Typing "sal" therefore put "Select every row in this tab"
   above "Go to Sales", because Select is built before Go. A palette whose first
   row is not its best answer is a palette you stop pressing Enter in.

   TWO RULES, and they are the whole file:

   1 · GROUP ORDER IS NEVER RE-SORTED. The rendered list is grouped
       (`CommandList` draws one band per group, in GROUP_ORDER), and the cursor
       walks the FLAT array. If relevance were allowed to reorder across groups
       the flat index and the visual order would stop agreeing and ↓ would jump
       around the screen. So ranking happens strictly INSIDE each band, and the
       bands stay in the order the registry declares. "Prefix, then substring,
       then people by name" falls out of this: People is the last band before
       the on-screen rows, so a verb always outranks a person.

   2 · THE VOCABULARY NEVER SHRINKS, so the ≤8 cap is spent only on the bands
       whose LENGTH IS DATA. People (every loaded conversation) and Open (every
       row on screen) can be hundreds long and are what the cap exists for;
       Move / Select / Act / Claude / Thread / Go are a fixed list of things
       this app can do, and dropping the ninth one would re-open exactly the
       hole commandSource.ts's header comment was written about.
   ========================================================================== */

/** All this file needs of a command. `search` is extra text a row can be found
 *  by without printing it — a person's company, which belongs in the context
 *  line rather than in the verb. */
export type Rankable = {
  id: string
  title: string
  group: string
  search?: string
}

/** The bands whose length is data rather than vocabulary. See rule 2. */
export const ROW_GROUPS = ['People', 'Open']
export const ROW_GROUP_CAP = 8

export type RankOpts = {
  /** Band order. Anything not named lands after everything named. */
  order?: string[]
  cap?: number
  capGroups?: string[]
}

/**
 * How well one command answers one query. Lower is better; `null` is "not an
 * answer at all". The four classes, in the order the move asks for:
 *
 *   0  the verb STARTS with what was typed         — "go " → "Go to Sales"
 *   1  a word of the verb starts with it           — "sal" → "Go to Sales"
 *   2  it appears anywhere in the verb             — "ale" → "Go to Sales"
 *   3  every token appears somewhere, in any order — the old whole-list rule,
 *      kept as the last resort because it is what makes "model haiku" find
 *      "/model claude-haiku-4-5" (ChatPane's finding, quoted in commandSource).
 */
export function matchScore(query: string, c: Rankable): number | null {
  const q = query.toLowerCase().trim()
  if (q === '') return 0
  const title = c.title.toLowerCase()
  const extra = c.search ? c.search.toLowerCase() : ''
  const hay = `${title} ${c.group.toLowerCase()}${extra ? ` ${extra}` : ''}`
  if (title.startsWith(q)) return 0
  if (title.split(/[\s·,/-]+/).some(w => w.startsWith(q))) return 1
  // A person is found by company as readily as by name, and the company is not
  // in the verb. Same class as a word prefix in the title: it is still the head
  // of a word the reader typed.
  if (extra && extra.split(/[\s·,/-]+/).some(w => w.startsWith(q))) return 1
  if (hay.includes(q)) return 2
  const tokens = q.split(/\s+/)
  return tokens.every(t => hay.includes(t)) ? 3 : null
}

/**
 * The palette's rows for a query: matches only, best first INSIDE each band,
 * bands in registry order, and the two data-shaped bands capped.
 *
 * Stable: two commands of the same class come back in the order the registry
 * declared them, so an empty query returns the vocabulary exactly as written.
 */
export function rankCommands<T extends Rankable>(
  query: string, cmds: T[], opts: RankOpts = {},
): T[] {
  const order = opts.order ?? []
  const cap = opts.cap ?? ROW_GROUP_CAP
  const capped = new Set(opts.capGroups ?? ROW_GROUPS)

  const band = (g: string) => {
    const i = order.indexOf(g)
    return i < 0 ? order.length : i
  }

  const scored: { c: T; i: number; s: number }[] = []
  cmds.forEach((c, i) => {
    const s = matchScore(query, c)
    if (s !== null) scored.push({ c, i, s })
  })
  scored.sort((a, b) => band(a.c.group) - band(b.c.group) || a.s - b.s || a.i - b.i)

  const seen = new Map<string, number>()
  const out: T[] = []
  for (const x of scored) {
    const n = (seen.get(x.c.group) ?? 0) + 1
    seen.set(x.c.group, n)
    if (capped.has(x.c.group) && n > cap) continue
    out.push(x.c)
  }
  return out
}
