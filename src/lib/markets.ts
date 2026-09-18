/* ==========================================================================
   MARKETS: one client's whole market readout, in one call.

   `operator_market_readout('clientops', lane)` (db/100) returns the entire
   screen: the two populations kept apart, the offers from the accounts we
   follow ranked by comments per 1,000 followers, the ones below that floor
   with a machine reason, the wider unvetted feed, the stored themes with
   their counts recomputed from the posts behind them, the lane's own posts,
   which tests the numbers can carry, coverage, and the stored insights.

   `operator_lanes('clientops')` (db/100) returns which tenants this operator
   may see at all, from client_registry through lane_allowed(). Nothing here
   types a lane id.

   TWO POPULATIONS, NAMED THE SAME WAY EVERYWHERE:
     the accounts we follow for you   the roster the client and Ivan agreed on
     the wider feed                   every other author the harvest stored
   A sentence may never say "these accounts" about a number that counts the
   wider feed. Every count below says which of the two it came from.

   All arithmetic and every sentence live here. The view selects and arranges.
   ========================================================================== */
import { supabase } from './supabase'
import { CLIENT_OPS_GATE } from './content'

/* ---------------------------------------------------------------- the shapes */

export type MarketOffer = {
  post_ref: string
  author: string
  author_url: string | null
  posted_at: string | null
  likes: number | null
  comments: number | null
  reposts: number | null
  follower_count: number | null
  followers_source: string | null
  per_1k: number | null
  cta_kind: string | null
  gate_keyword: string | null
  offer: string | null
  confidence: number | null
  /** How far above the ranked median this offer sits. Null when it is not ranked. */
  vs_median: number | null
  /** Why it sits below the ranked ones. Null on a ranked offer. */
  why_followers: 'missing' | 'small' | null
  why_comments: boolean | null
}

export type MarketTheme = {
  theme: string
  posts: number
  authors: number
  med: number | null
  ex_author: string | null
  ex_url: string | null
  ex_text: string | null
}

export type MarketTest = {
  kind: 'shape' | 'ask' | 'theme' | 'own_median' | 'offer_share'
  base: number
  n: Record<string, unknown>
}

/** One stored reading. Every field beyond `section` may be missing: a reading is
    written by a mining pass, and a pass that could not fill a field leaves it out
    rather than inventing it. */
export type InsightExample = { url?: string; first_line?: string; comments?: number }
export type InsightReading = {
  headline?: string
  number?: string | number
  base?: string | number
  examples?: InsightExample[]
  change?: string
}
export type MarketInsight = { section: string; reading: InsightReading; created_at?: string }

export type MarketReadout = {
  since: string
  window_days: number
  client_id: string
  display_name: string
  floor: { comments: number; followers: number }
  min_test_base: number
  populations: {
    roster_size: number
    roster_authors: number
    roster_posts: number
    roster_median_comments: number | null
    roster_max_post_comments: number | null
    wider_posts: number
    wider_authors: number
  }
  offers: {
    roster_offers: number
    wider_offers: number
    ranked_count: number
    below_count: number
    roster_max_comments: number | null
    roster_offer_median: number | null
    cta: { link: number; comment_gate: number; dm_gate: number }
    with_keyword: number
    rank: { median_per1k: number | null; max_per1k: number | null; min_per1k: number | null }
    ranked: MarketOffer[]
    below: MarketOffer[]
    wider: MarketOffer[]
    top_by_comments: MarketOffer | null
    top_leads_ranking: boolean
  }
  themes: { run_id: string | null; total: number; rows: MarketTheme[] }
  own: {
    posts: number
    median_comments: number | null
    best_comments: number | null
    best: { url: string | null; title: string | null; comments: number | null; at: string | null } | null
    /** Posts carrying no comments AND no reactions: stored but never measured. */
    stale_count: number
    /** The median across the posts we did measure. */
    median_measured: number | null
    attributed: number
    unattributed: number
    lm_catalog: number
    lm_used: number
  }
  tests: MarketTest[]
  coverage: { judged: number; unjudged: number; total: number }
  insights: { run_id: string | null; rows: MarketInsight[] }
}

export type MarketRead =
  | { kind: 'ready'; data: MarketReadout; readAt: string }
  | { kind: 'denied' | 'failed'; message: string }

export type Lane = { client_id: string; display_name: string }
export type LanesRead =
  | { kind: 'ready'; lanes: Lane[]; readAt: string }
  | { kind: 'denied' | 'failed'; message: string }

const DENIED = /permission|denied|not authorized|unauthorized|not_authenticated|unknown seat/i

/* ---------------------------------------------------------------- the reads */

export async function fetchMarketReadout(lane: string): Promise<MarketRead> {
  const { data, error } = await supabase.rpc('operator_market_readout', {
    p_gate: CLIENT_OPS_GATE, p_client_id: lane,
  })
  if (error) {
    const message = error.message || 'The market readout failed.'
    return DENIED.test(message) ? { kind: 'denied', message } : { kind: 'failed', message }
  }
  const d = data as Partial<MarketReadout> | null
  // The three keys the whole screen rests on. A payload without them is a failed
  // read rather than an empty screen that looks like an empty market.
  if (!d || typeof d.since !== 'string' || !d.populations || !d.offers) {
    return { kind: 'failed', message: 'The market readout returned no usable payload.' }
  }
  return { kind: 'ready', data: d as MarketReadout, readAt: new Date().toISOString() }
}

export async function fetchLanes(): Promise<LanesRead> {
  const { data, error } = await supabase.rpc('operator_lanes', { p_gate: CLIENT_OPS_GATE })
  if (error) {
    const message = error.message || 'The lane list read failed.'
    return DENIED.test(message) ? { kind: 'denied', message } : { kind: 'failed', message }
  }
  if (!Array.isArray(data)) return { kind: 'failed', message: 'The lane list returned no usable list.' }
  const lanes = (data as unknown[]).filter((r): r is Lane =>
    !!r && typeof r === 'object'
    && typeof (r as Lane).client_id === 'string' && (r as Lane).client_id !== ''
    && typeof (r as Lane).display_name === 'string' && (r as Lane).display_name !== '')
  return lanes.length
    ? { kind: 'ready', lanes, readAt: new Date().toISOString() }
    : { kind: 'failed', message: 'The lane list came back empty.' }
}

/* ---------------------------------------------------------------- numbers */

/** A count a person reads: thousands separated, never a bare float. */
export function int(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '0'
  return Math.round(Number(n)).toLocaleString('en-US')
}

/** A median of 2.5 is not 3. Whole numbers stay whole, the rest keep one decimal. */
export function dec(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '0'
  const v = Number(n)
  return Number.isInteger(v) ? int(v) : (Math.round(v * 10) / 10).toFixed(1)
}

/** Comments per thousand followers always carry one decimal, so a rate never reads as a count. */
export function one(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '0.0'
  return (Math.round(Number(n) * 10) / 10).toFixed(1)
}

export function pct(a: number | null | undefined, b: number | null | undefined): number {
  const top = Number(a ?? 0), bottom = Number(b ?? 0)
  return bottom ? Math.round((top / bottom) * 100) : 0
}

export function plu(n: number | null | undefined, one_: string, many?: string): string {
  return Math.round(Number(n ?? 0)) === 1 ? one_ : (many || `${one_}s`)
}

/** What the post asked the reader to do, in the reader's words. */
export function askLabel(kind: string | null | undefined): string {
  if (kind === 'comment_gate') return 'a word in the comments'
  if (kind === 'dm_gate') return 'a reply in the inbox'
  if (kind === 'link') return 'a link in the post'
  return 'no reply at all'
}

/** The first readable line of someone's post, cut at a word. */
export function firstLine(text: string | null | undefined, cap = 120): string | null {
  if (!text) return null
  const t = String(text).split(/\n+/).map(s => s.trim()).find(s => s.length > 0)
  if (!t) return null
  return t.length > cap ? `${t.slice(0, cap).replace(/\s+\S*$/, '')}…` : t
}

/* ---------------------------------------------------------------- the words */

export const ACCOUNTS = 'the accounts we follow for you'
export const WIDER = 'the wider feed'

/** How many accounts actually published, which is the base a roster count sits on. */
export function accountsWithPosts(p: MarketReadout['populations']): string {
  return p.roster_authors === p.roster_size
    ? `${int(p.roster_authors)} ${plu(p.roster_authors, 'account')} we follow for you`
    : `${int(p.roster_authors)} of the ${int(p.roster_size)} accounts we follow for you`
}

/** The one number the screen opens with, and the sentence under it. */
export function answer(m: MarketReadout): { figure: string; unit: string; lines: string[] } {
  const o = m.offers, p = m.populations
  const top = o.top_by_comments
  const lead = o.ranked[0] ?? null
  const lines: string[] = []

  if (!o.roster_offers || !top) {
    return {
      figure: int(m.coverage.judged),
      unit: `posts read from this market so far`,
      lines: [
        `${accountsWithPosts(p)} published ${int(p.roster_posts)} ${plu(p.roster_posts, 'post')} in this window and none of them carried an offer, so we have nothing to rank yet.`,
        widerLine(m),
        `We read the rest of the window as it lands. The first offer those accounts publish turns up here.`,
      ].filter(Boolean),
    }
  }

  lines.push(
    `${top.author} offered ${quote(top.offer)} and asked for ${askLabel(top.cta_kind)}. `
    + (top.follower_count
      ? `${int(top.follower_count)} ${plu(top.follower_count, 'person', 'people')} followed the account when we read it and ${int(top.comments)} ${plu(top.comments, 'comment')} came back, `
        + `${one(top.per_1k)} for every thousand followers.`
      : `${int(top.comments)} ${plu(top.comments, 'comment')} came back. We hold no follower count for that account yet, so it stays out of the ranking.`),
  )

  if (lead && !o.top_leads_ranking) {
    lines.push(
      `The ranking counts comments for every thousand followers on offers that cleared ${int(m.floor.comments)} comments and ${int(m.floor.followers)} followers, `
      + `so ${lead.author} leads it at ${one(lead.per_1k)} on ${int(lead.comments)} ${plu(lead.comments, 'comment')} from ${int(lead.follower_count)} followers.`)
  } else if (lead && o.ranked_count === 1) {
    lines.push(`That post is the only offer from those accounts that cleared ${int(m.floor.comments)} comments and ${int(m.floor.followers)} followers, so it is the only one we can rank by reach.`)
  } else if (lead && lead.vs_median) {
    lines.push(`That post also leads the ranking at ${one(lead.vs_median)} times the ${one(o.rank.median_per1k)} the other ${int(o.ranked_count)} ranked offers run at.`)
  }

  const w = widerLine(m)
  if (w) lines.push(w)

  return {
    figure: int(o.roster_max_comments),
    unit: `comments on the loudest offer from the accounts we follow for you`,
    lines,
  }
}

function quote(s: string | null | undefined): string {
  const t = String(s ?? '').trim()
  if (!t) return 'an offer we could not name'
  return `“${t.charAt(0).toUpperCase()}${t.slice(1)}”`
}

/** One sentence that keeps the second population visible and separate. */
export function widerLine(m: MarketReadout): string {
  const p = m.populations
  if (!p.wider_posts) return ''
  return `We also stored ${int(p.wider_posts)} ${plu(p.wider_posts, 'post')} from ${int(p.wider_authors)} other ${plu(p.wider_authors, 'author')} writing around the same topics. `
    + `We have not vetted those accounts, so they sit in one table at the end and stay out of the ranking.`
}

/** The coverage caption names both populations, because it counts both. */
export function coverageLine(m: MarketReadout): string {
  const c = m.coverage
  return `We read ${int(c.judged)} of the ${int(c.total)} ${plu(c.total, 'post')} on file for this market, ${pct(c.judged, c.total)} in a hundred`
    + (c.unjudged ? `, and the other ${int(c.unjudged)} sit in the queue` : '')
    + `. That count covers ${ACCOUNTS} and ${WIDER} together, so every number here says which of the two it came from.`
}

/** The four-row ask ledger, loudest ask first. */
export function askRows(m: MarketReadout): Array<{ id: string; value: number; label: string }> {
  const cta = m.offers.cta
  const rows = [
    { id: 'link', value: cta.link, label: 'asked for a link in the post' },
    { id: 'comment_gate', value: cta.comment_gate, label: 'asked for a word in the comments' },
    { id: 'dm_gate', value: cta.dm_gate, label: 'asked for a reply in the inbox' },
  ].sort((a, b) => b.value - a.value)
  rows.push({
    id: 'with_keyword',
    value: m.offers.with_keyword,
    label: `of those ${int(m.offers.roster_offers)} also named a word to write back`,
  })
  return rows
}

/** Why one offer sits below the ranked ones, in the reader's words. */
export function floorReason(o: MarketOffer, floor: MarketReadout['floor']): string {
  const why: string[] = []
  if (o.why_followers === 'missing') why.push('we hold no follower count for the account')
  else if (o.why_followers === 'small') why.push(`the account is under ${int(floor.followers)} followers`)
  if (o.why_comments) why.push(`it drew under ${int(floor.comments)} comments`)
  return why.length ? why.join(' and ') : 'it carries no reach we can size'
}

/** How the ranked section introduces itself. */
export function shapeLine(m: MarketReadout): string {
  const o = m.offers
  if (!o.roster_offers) return `No offer from ${ACCOUNTS} is on file yet, so there is nothing to rank.`
  if (!o.ranked_count) {
    return `None of the ${int(o.roster_offers)} ${plu(o.roster_offers, 'offer')} from ${ACCOUNTS} cleared ${int(m.floor.comments)} comments and ${int(m.floor.followers)} followers, so we can rank none of them by reach yet.`
  }
  return `${int(o.ranked_count)} of the ${int(o.roster_offers)} ${plu(o.roster_offers, 'offer')} from ${ACCOUNTS} cleared ${int(m.floor.comments)} comments and ${int(m.floor.followers)} followers, `
    + `at a median of ${one(o.rank.median_per1k)} comments for every thousand followers.`
    + (o.below_count ? ` The other ${int(o.below_count)} keep their raw counts below, each with the reason.` : '')
}

/** What the themes section says, whether or not a set has been named. */
export function themeLine(m: MarketReadout): string {
  const t = m.themes
  if (!t.total) {
    return `We have not named the repeating ideas in this market yet. A name appears here once 3 posts from 2 of ${ACCOUNTS} come back to the same idea.`
  }
  return `We read their loudest posts and named the ${int(t.total)} ${plu(t.total, 'idea')} that came back. Each name is ours, and the counts under it are the posts behind it.`
}

/** The wider feed's own caption. It never borrows the roster's words. */
export const widerTitle = 'Also loud around your topics, from accounts we have not vetted'
export function widerNote(m: MarketReadout): string {
  const o = m.offers, p = m.populations
  return `${int(o.wider_offers)} ${plu(o.wider_offers, 'offer')} came from ${int(p.wider_authors)} ${plu(p.wider_authors, 'author')} outside the list we agreed with you. `
    + `We stored them because they came up around your topics, and they stay out of the ranking, the medians and the plan until you put an account on the list.`
}

/* ---------------------------------------------------------------- own posts */

export type OwnRow = { id: string; value: number; display: string; label: string; base: string; you?: boolean }

export type OwnState =
  | { kind: 'none'; line: string }
  | { kind: 'withheld'; line: string; measured: string }
  | { kind: 'ready'; line: string; rows: OwnRow[] }

/**
 * A post carrying no comments AND no reactions was stored and never measured.
 * When at least half of the lane's posts are in that state the median position
 * itself lands on an unmeasured row, so the median is a property of the gap
 * rather than of the market, and the comparison is withheld and said out loud.
 * Ivan's lane today: 38 of 72.
 */
export function medianWithheld(own: MarketReadout['own']): boolean {
  return own.posts > 0 && own.stale_count * 2 >= own.posts
}

export function ownState(m: MarketReadout): OwnState {
  const own = m.own, p = m.populations
  if (!own.posts) {
    return {
      kind: 'none',
      line: `We hold none of your own posts in this window, and ${int(own.lm_catalog)} ${plu(own.lm_catalog, 'offer')} ${plu(own.lm_catalog, 'sits', 'sit')} in your catalogue. `
        + `Your side of the comparison fills in from the first post we record.`,
    }
  }

  const share = `${int(own.attributed)} of your ${int(own.posts)} ${plu(own.posts, 'post')} carried one of your offers, ${pct(own.attributed, own.posts)} in a hundred, `
    + `against ${pct(m.offers.roster_offers, p.roster_posts)} in a hundred across the ${int(p.roster_posts)} posts ${ACCOUNTS} published.`

  if (medianWithheld(own)) {
    const measured = own.posts - own.stale_count
    return {
      kind: 'withheld',
      line: `We hold ${int(own.posts)} of your posts in this window. Comments and reactions read zero on ${int(own.stale_count)} of them, which means we stored those posts and never measured them, so we withhold the comparison against the market median. ${share}`,
      measured: measured > 0
        ? `Across the ${int(measured)} we did measure, the median is ${dec(own.median_measured)} ${plu(own.median_measured ?? 0, 'comment')} and the best post drew ${int(own.best_comments)}.`
        : `We have measured none of them yet, so there is no median to read.`,
    }
  }

  const rows: OwnRow[] = []
  if (p.roster_median_comments !== null) {
    rows.push({
      id: 'roster_median_comments', value: Number(p.roster_median_comments), display: dec(p.roster_median_comments),
      label: `Median comments across ${ACCOUNTS}`,
      base: `Across ${int(p.roster_posts)} posts from ${int(p.roster_authors)} ${plu(p.roster_authors, 'account')} in this window.`,
    })
    rows.push({
      id: 'roster_max_post_comments', value: Number(p.roster_max_post_comments ?? 0), display: dec(p.roster_max_post_comments),
      label: 'The loudest of those posts',
      base: 'The highest comment count any of those accounts reached, offer or no offer.',
    })
  }
  rows.push({
    id: 'own_median_comments', value: Number(own.median_comments ?? 0), display: dec(own.median_comments), you: true,
    label: 'Median comments on your posts',
    base: `Across ${int(own.posts)} ${plu(own.posts, 'post')} you published in the same window`
      + (own.stale_count ? `, ${int(own.stale_count)} of which we have not measured yet.` : '.'),
  })
  rows.push({
    id: 'own_best_comments', value: Number(own.best_comments ?? 0), display: dec(own.best_comments), you: true,
    label: 'Your best post',
    base: own.best?.title ? String(firstLine(own.best.title, 80)) : 'Your highest comment count in this window.',
  })
  return { kind: 'ready', line: `We hold ${int(own.posts)} of your posts in this window. ${share}`, rows }
}

/* ---------------------------------------------------------------- the plan */

/** What the plan section says when the numbers cannot carry a test yet. */
export function planThinLine(m: MarketReadout): string {
  const o = m.offers
  return `We hold ${int(o.roster_offers)} ${plu(o.roster_offers, 'offer')} from ${ACCOUNTS} and ${int(o.ranked_count)} of ${plu(o.roster_offers, 'it', 'them')} cleared `
    + `${int(m.floor.comments)} comments and ${int(m.floor.followers)} followers. We pick the first test once ${int(m.min_test_base)} offers from those accounts clear that floor.`
}

const nnum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const nstr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** One test, as a title and a body. Each one starts from a number already on the screen. */
export function testCopy(t: MarketTest, m: MarketReadout): { title: string; body: string } {
  const n = t.n || {}
  if (t.kind === 'shape') {
    const top = (n.top || {}) as MarketOffer
    const ratio = nnum(top.vs_median)
    return {
      title: 'Run one offer in the shape of the loudest one',
      body: `${top.author ?? 'That account'} drew ${one(top.per_1k)} comments for every thousand followers`
        + (ratio ? `, ${one(ratio)} times the ${one(nnum(n.median_per1k))} the other ranked offers run at` : '')
        + `. That sits on ${int(t.base)} ranked ${plu(t.base, 'offer')} from ${ACCOUNTS}. We write one offer in that shape for you and run it.`,
    }
  }
  if (t.kind === 'ask') {
    const pairs = [
      ['link', nnum(n.link) ?? 0, 'a link in the post'],
      ['comment_gate', nnum(n.comment_gate) ?? 0, 'a word in the comments'],
      ['dm_gate', nnum(n.dm_gate) ?? 0, 'a reply in the inbox'],
    ].sort((a, b) => Number(b[1]) - Number(a[1])) as Array<[string, number, string]>
    return {
      title: 'Ask the way this market already asks',
      body: `Of the ${int(t.base)} ${plu(t.base, 'offer')} those accounts published, ${int(pairs[0][1])} asked for ${pairs[0][2]} and ${int(pairs[1][1])} asked for ${pairs[1][2]}. `
        + `We write one offer twice, one ask each, and run them one after the other so the ask is the only thing that moved.`,
    }
  }
  if (t.kind === 'theme') {
    const authors = nnum(n.authors) ?? 0
    return {
      title: `Write into the idea ${int(authors)} of them keep returning to`,
      body: `${int(t.base)} of their posts come back to the same idea, across ${int(authors)} accounts, at a median of ${dec(nnum(n.med))} comments. `
        + `“${nstr(n.theme) ?? 'an idea we have not named'}” is our name for it. `
        + (t.base < 10 ? `${int(t.base)} posts is a small base, so we treat this as the least certain of the three. ` : '')
        + `We draft two posts on it for you and keep the one that holds.`,
    }
  }
  if (t.kind === 'own_median') {
    return {
      title: 'Close the gap on the median',
      body: `You published ${int(nnum(n.own_posts))} ${plu(nnum(n.own_posts), 'post')} in this window at a median of ${dec(nnum(n.own_median))} comments, `
        + `against ${dec(nnum(n.roster_median))} across the ${int(nnum(n.roster_posts))} posts ${ACCOUNTS} published. `
        + `We write the next three against that number and read them back to you.`,
    }
  }
  const rp = nnum(n.roster_posts) ?? 0
  return {
    title: 'Put an offer under more of what you already write',
    body: `${int(nnum(n.roster_offers))} of the ${int(rp)} posts those accounts published carried an offer, ${pct(nnum(n.roster_offers), rp)} in a hundred. `
      + `${int(nnum(n.attributed))} of your ${int(nnum(n.own_posts))} carry one today. `
      + `We attach an offer to your next four posts and read the comments against these same counts.`,
  }
}

/* ---------------------------------------------------------------- insights */

/** A stored reading, with every optional field resolved to something printable or null.
    A pass that could not fill a field left it out, so nothing here invents one. */
export type InsightRow = {
  section: string
  headline: string
  number: string | null
  base: string | null
  change: string | null
  examples: Array<{ url: string | null; line: string; comments: number | null }>
}

export function insightRows(m: MarketReadout): InsightRow[] {
  const rows = m.insights?.rows
  if (!Array.isArray(rows)) return []
  return rows
    .filter(r => r && typeof r.section === 'string' && r.section.trim())
    .map(r => {
      const reading = (r.reading && typeof r.reading === 'object' ? r.reading : {}) as InsightReading
      const ex = Array.isArray(reading.examples) ? reading.examples : []
      return {
        section: r.section,
        headline: nstr(reading.headline) ?? sectionTitle(r.section),
        number: reading.number === null || reading.number === undefined ? null : String(reading.number),
        base: reading.base === null || reading.base === undefined ? null : String(reading.base),
        change: nstr(reading.change),
        examples: ex
          .filter(e => e && typeof e === 'object')
          .slice(0, 3)
          .map(e => ({
            url: nstr(e.url),
            line: nstr(e.first_line) ?? 'We hold no opening line for this post.',
            comments: nnum(e.comments),
          }))
          .filter(e => e.url || e.line),
      }
    })
}

/** A section id is a machine word, so it never reaches the screen unchanged. */
export function sectionTitle(section: string): string {
  const s = String(section).replace(/[_-]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'A reading'
}

export const INSIGHTS_EMPTY = 'No readings stored for this market yet.'

/** The line under a reading, when it carries a number and the base behind it. */
export function insightBase(r: InsightRow): string | null {
  if (r.number === null && r.base === null) return null
  if (r.number !== null && r.base !== null) return `${r.number} on a base of ${r.base}`
  return r.number ?? `on a base of ${r.base}`
}
