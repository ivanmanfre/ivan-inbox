// Plain-words mapping for the Plan tab (spec 2026-10-12 R4). Pure: no React, no fetches.
// Every sentence Ivan reads about a planned post comes from here, so the wording rules live in one place:
// short sentences, everyday words, a number only next to a plain comparison, no model or pipeline terms, no em dash.
import { displayTitle, planDay, type BrainStrip, type PlanBrain, type PlanEvidence, type PlanPost, type PlanRead, type PlanSlot, type PlanWarning, type PlanWeek, type StripRule } from '../../../lib/contentPlan'

export type Acct = 'ivan' | 'risedtc' | 'arch'
export const ACCT_NAME: Record<Acct, string> = { ivan: 'Ivan', risedtc: 'Rise', arch: 'Arch' }
export const OWNER: Record<Acct, string> = { ivan: 'you', risedtc: 'Mattan', arch: 'Davorin' }
/** Whose niche, inside a sentence: "your niche", "Rise's niche". */
const POSS: Record<Acct, string> = { ivan: 'your', risedtc: "Rise's", arch: "Arch's" }
const acctOf = (a: string): Acct => (a === 'risedtc' || a === 'arch' ? a : 'ivan')

export type St = 'published' | 'scheduled' | 'review' | 'writing' | 'failed'
export const ST_WORD: Record<St, string> = { published: 'Published', scheduled: 'Scheduled', review: 'Waiting for your OK', writing: 'Being written', failed: 'Failed' }

export type Tz = { name: string; label: string }
const TZ_DEFAULT: Record<Acct, Tz> = { ivan: { name: 'Europe/Warsaw', label: 'Warsaw' }, risedtc: { name: 'America/Los_Angeles', label: 'PT' }, arch: { name: 'Europe/Warsaw', label: 'Warsaw' } }
/** The read's own time zone when it ships one, else the account's default. */
export function tzOf(read: Pick<PlanRead, 'account' | 'tz'>): Tz {
  const t = read.tz
  return t && t.name && t.label ? { name: t.name, label: t.label } : TZ_DEFAULT[acctOf(read.account)]
}

export type PlanItem = {
  key: string; kind: 'post' | 'planned'; week: string; which: 'this' | 'next' | 'after'; day: string | null; suggested: boolean; at: string | null
  title: string; st: St; draftId: string | null; slotId: string | null; ideaRef: string | null; ideaSource: string | null; format: string | null
  brain: PlanBrain | null; evidence: PlanEvidence[]; whyNow: string | null; post?: PlanPost; slot?: PlanSlot
}

// ---- words for brain labels ----
export const TRAIT: Record<string, Record<string, string>> = {
  topic_class: { product_ecommerce_ops: 'Ecommerce operations posts', founder_life_career: 'Founder career stories', industry_news_trends: 'Industry news posts', marketing_tactics: 'Marketing tactic posts', ai_automation: 'AI posts' },
  proof_type: { named_example: 'Posts with a named example', numbers_result: 'Posts with a result in numbers', personal_experience: 'Posts with personal experience', none: 'Posts without proof' },
  angle: { story: 'Story posts', data: 'Data posts', news: 'News posts', opinion: 'Opinion posts', how_to: 'How-to posts', personal: 'Personal posts' },
  stakes: { money: 'Posts about money', time_effort: 'Posts about time or effort', career: 'Posts about a career risk', reputation: 'Posts about a reputation risk', reputation_status: 'Posts about a reputation risk', none: 'Posts with nothing at risk' },
}
export const STRUCT: Record<string, string> = {
  'STORY': 'a story', 'FRAMEWORK WALKTHROUGH': 'step by step', 'DATA-LED': 'numbers first', 'TEARDOWN': 'a teardown', 'MIRROR': 'a copy of a past winner',
  'MECHANISM COMPARISON': 'a side-by-side comparison', 'HOT TAKE': 'a strong opinion', 'CONFESSIONAL': 'a personal confession', 'SHORT TAKE': 'a short post',
  'BORROWED WINNER FORMAT': 'the shape of a top post',
}
export const HOOK: Record<string, string> = {
  pattern_interrupt: 'Opens with a surprise', claim: 'Opens with a bold claim', data_led: 'Opens with a number', specific_receipt: 'Opens with proof',
  story_opener: 'Starts in the middle of a story', question: 'Opens with a question', story: 'Starts with a story', list: 'Opens with a list',
  joke: 'Opens with a joke', offer: 'Opens with an offer',
}
export const DIM: Record<string, string> = { VOICE: 'Voice', SUBSTANCE: 'Depth', SPECIFICITY: 'Details', OPINION: 'Opinion', ECONOMY: 'Short', HOOK: 'Hook', VERIFIED: 'Facts', AI_TELLS: 'Sounds human' }
const DIM_ORDER = Object.keys(DIM)
export const TOPIC: Record<string, string> = {
  demand: 'sales posts', reach: 'posts that bring new followers', teardown: 'teardowns', trust: 'trust posts', personal: 'founder stories',
  case_study: 'case studies', how_to: 'how-to posts', opinion: 'opinion posts', authority: 'expert posts',
}

// ---- fixed sentences (spec R3.4 and R4) ----
export const FIRST_LINE_MAX_CHARS = 45
export const FIRST_LINE_MIN_WORDS = 100
export const FIRST_LINE_SHORT = 'Short first line: posts like this do 9% better.'
export const FIRST_LINE_QUESTION = 'A question in the first line: 12% fewer views.'
export const FIRST_LINE_UNDER_100_WORDS = 'Under 100 words: 12% fewer views.'
export const NO_DAY_LINE = 'No day yet. It gets the first free weekday of its week when you approve it.'
export const FAILED_LINE = 'Failed twice. The planner is picking a new topic for this slot.'
export const NOTHING_WAITS = 'Nothing waits for you'
export const FLAG_LABEL = { lm: 'Lead magnet', boosted: 'Boosted', founder: 'Founder story', carousel: 'Carousel', weekend: 'Weekend', failed: 'Failed', low: 'Low score', fact: 'Not backed by the call' } as const

// ---- small helpers ----
const words = (s: string) => s.replace(/_/g, ' ')
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const num = (n: number) => n.toLocaleString('en-GB')
const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const addDays = (iso: string, n: number) => { const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const weekday = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay()
const isWeekend = (iso: string | null) => iso != null && (weekday(iso) === 0 || weekday(iso) === 6)
const realRules = (strip: BrainStrip | null | undefined): StripRule[] => (Array.isArray(strip?.rules) ? strip!.rules : []).filter(r => r && !String(r.rule_id ?? '').startsWith('zz-'))
/** One test for "does this rule have a clear measured effect": a known gain whose range does not cross zero. */
export function ruleClear(r: Pick<StripRule, 'gain' | 'lo' | 'hi' | 'unclear'>): boolean {
  if (r.unclear || !fin(r.gain)) return false
  return !(fin(r.lo) && fin(r.hi) && r.lo < 0 && r.hi > 0)
}
const weekendRule = (strip: BrainStrip | null | undefined) => realRules(strip).find(r => /weekend/i.test(String(r.rule_id ?? '')))
const evOf = (it: PlanItem) => (Array.isArray(it.evidence) ? it.evidence : [])

/** Last guard on every machine phrase that can reach the screen: the R4 banned words and the em dash. */
function scrub(s: string): string {
  return s
    .replace(/\s*—\s*/g, ', ')
    .replace(/\bniche winner(s?)\b/gi, 'top post$1')
    .replace(/\bReview draft(s?)\b/gi, 'written draft$1')
    .replace(/\b(?:niche )?outlier(s?)\b/gi, 'top post$1')
    .replace(/\bits author['’]s usual\b/gi, "its author's normal views")
    .replace(/\busual\b/gi, 'normal')
    .replace(/\bprimer\b/gi, 'guide')
    .replace(/\bpillars?\b/gi, 'topic')
    .replace(/\bcadence\b/gi, 'posting rhythm')
    .replace(/\bpattern(s?)\b/gi, 'kind$1')
    .replace(/\bbreakout(s?)\b/gi, 'viral post$1')
    .replace(/\bholdout\b/gi, 'check')
    .replace(/\brecipe\b/gi, 'formula')
    .replace(/\bQA\b/g, 'quality check')
    .replace(/\bICP\b/g, 'buyer fit')
}

// ---- items ----
export function statusOf(x: Pick<PlanPost, 'kind' | 'status'> | Pick<PlanSlot, 'kind' | 'status'>): St {
  const s = String(x.status ?? '')
  if (x.kind === 'planned') {
    if (s === 'waiting_review') return 'review'
    if (s === 'failed' || s === 'error') return 'failed'
    return 'writing'
  }
  if (s === 'published' || s === 'posted') return 'published'
  if (s === 'review') return 'review'
  if (s === 'error') return 'failed'
  return 'scheduled'
}

/** Posts and planned slots of the three weeks, by day then time. Undated slots go last. */
export function itemsOf(read: PlanRead): PlanItem[] {
  const out: PlanItem[] = []
  for (const w of Array.isArray(read?.weeks) ? read.weeks : []) {
    for (const p of Array.isArray(w.posts) ? w.posts : []) {
      out.push({
        key: `p:${p.draft_id ?? p.queue_id ?? `${p.day}:${p.title}`}`, kind: 'post', week: w.start, which: w.which, day: p.day ?? null, suggested: false,
        at: p.at ?? null, title: displayTitle(p.title), st: statusOf(p), draftId: p.draft_id ?? null, slotId: null, ideaRef: null, ideaSource: null,
        format: p.format ?? null, brain: p.brain ?? null, evidence: Array.isArray(p.evidence) ? p.evidence : [], whyNow: null, post: p,
      })
    }
    for (const s of Array.isArray(w.planned) ? w.planned : []) {
      out.push({
        key: `s:${s.slot_id}`, kind: 'planned', week: w.start, which: w.which, day: s.day ?? null, suggested: true, at: null,
        title: displayTitle(s.topic), st: statusOf(s), draftId: s.draft_id ?? null, slotId: s.slot_id, ideaRef: s.idea_ref ?? null,
        ideaSource: s.idea_source ?? null, format: s.format ?? null, brain: s.brain ?? null, evidence: Array.isArray(s.evidence) ? s.evidence : [],
        whyNow: s.why_now ? s.why_now : null, slot: s,
      })
    }
  }
  return out.map((it, i) => ({ it, i })).sort((a, b) => {
    const d = (a.it.day ?? '￿').localeCompare(b.it.day ?? '￿')
    if (d) return d
    const t = (a.it.at ?? '￿').localeCompare(b.it.at ?? '￿')
    return t || a.i - b.i
  }).map(x => x.it)
}

/** Items from today on, slots that have no day yet, and posts still waiting for approval from earlier days. */
export function upcoming(items: PlanItem[], today: string): PlanItem[] {
  return items.filter(i => i.day == null || i.day >= today || i.st === 'review')
}

/** "07:00 PT" / "10:45 Warsaw", or '' when the item has no real time. */
export function timeLabel(it: PlanItem, tz: Tz): string {
  if (!it.at) return ''
  const d = new Date(it.at)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return `${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz.name })} ${tz.label}`
  } catch {
    return ''
  }
}

// ---- why this post ----
const REASON_TYPES = ['outlier', 'brain', 'series', 'lead_magnet', 'past_winner', 'approved', 'own_source']

/** Machine phrases from the planner and the evidence labels, in plain words. */
export function plainWhy(s: string): string {
  let t = String(s ?? '')
    .replace(/A (ready|finished)( \w+)? (Review )?draft( waiting in Review)?/gi, 'A written draft')
    .replace(/waiting in Review,?\s*/i, '')
    .replace(/adapted from/gi, 'based on')
    .replace(/a niche outlier at ([0-9.]+)x its author['’]s usual/gi, "a post that got $1x its author's normal views")
    .replace(/Niche outlier the Content Brain adapted, ([0-9.]+)x its author['’]s usual/gi, "Based on a post that got $1x its author's normal views")
    .replace(/Niche outlier the Content Brain adapted/gi, 'Based on a top post')
    .replace(/Content Brain draft/gi, 'Written by the brain, based on top posts')
    .replace(/^Content brain$/i, 'An idea from the brain')
    .replace(/X outlier by (@\w+)\s*(\([^)]*\)?)?/gi, 'A top X post by $1')
    .replace(/Mirror of a proven winner/i, 'Copy of a past winner')
    .replace('Format test (copied shape)', 'Copies the shape of a top post')
    .replace(/fits (?:a|the) winning ([\w-]+) pattern/gi, 'is like top $1 posts')
    .replace(/;\s*([a-z])/g, (_m, c: string) => `. ${c.toUpperCase()}`)
    .replace(/;/g, '.')
    .replace(/\s+\./g, '.')
  t = scrub(t).trim()
  return t
}

const slugLike = (s: string) => /^[a-z0-9]+(-[a-z0-9]+)+$/.test(s)

/** Why this post: the slot's reason, else the brain's source post, else the strongest evidence line. */
export function reasonFor(it: PlanItem, _acct: Acct): string | null {
  if (it.whyNow && it.whyNow.trim()) return plainWhy(it.whyNow)
  const br = it.brain?.brief
  if (br) {
    const who = br.author && !slugLike(br.author) ? br.author.trim() : null
    const r = fin(br.ratio) && br.ratio > 0 ? br.ratio.toFixed(1) : null
    if (who) return r ? `Based on a post by ${who} that got ${r}x their normal views.` : `Based on a top post by ${who}.`
    return r ? `Based on a top post that got ${r}x its author's normal views.` : 'Based on a top post.'
  }
  const ev = evOf(it)
  const b = ev.find(e => REASON_TYPES.includes(e.type) && e.label)
  if (b) return plainWhy(b.label)
  const c = ev.find(e => e.type === 'call' && e.label)
  if (c) return plainWhy(c.label)
  const i = ev.find(e => e.type === 'idea' && e.label)
  if (i) return plainWhy(i.label)
  return null
}

const isEnglish = (q: string) => !/[čćžšđ]/i.test(q) && !/\b(da|je|što|nije|mislim|koji|ali|kad)\b/i.test(q) && !/^(Extracts|Fits|Adds)\b/.test(q)
/** The English call quote, cut at a word near 200 characters. Pending or non-English quotes show nothing. */
export function quoteFor(it: PlanItem): string | null {
  const b = it.brain
  if (!b || b.quote_pending) return null
  let q = String(b.quote ?? '').trim()
  if (!q || !isEnglish(q)) return null
  if (q.length > 200) q = `${q.slice(0, 200).replace(/\s\S*$/, '').replace(/[\s,;:.]+$/, '')}…`
  return q
}

/** "Top posts in Rise's niche have this too: a reputation at risk." */
export function traitLine(it: PlanItem, acct: Acct): string | null {
  const raw = it.brain?.trait ?? evOf(it).find(e => e.type === 'brain_rule')?.label ?? null
  if (!raw) return null
  const t = scrub(String(raw)
    .replace(/^Shares traits with top niche posts:\s*/i, '')
    .replace(/single image format,?\s*/i, '')
    .replace(/a hook that opens with a number/gi, 'opening with a number')
    .replace(/reputation status at stake/gi, 'a reputation at risk')
    .replace(/(^|,\s*)career at stake/gi, '$1a career at risk')
    .replace(/(^|,\s*)personal angle/gi, '$1a personal angle')
    .replace(/\bat stake\b/gi, 'at risk'))
    .replace(/[\s,]+$/, '').trim()
  return t ? `Top posts in ${POSS[acct]} niche have this too: ${t}.` : null
}

// ---- will it do well ----
export type ReadLine = { sign: 'Good sign' | 'Bad sign' | 'Neutral'; text: string; flat: boolean; x: number; detail: string; rel: string }
/** The brain guess in one sentence, its detail line and how sure it is. Neutral within 15% (no scale then). */
export function readLine(it: PlanItem, acct: Acct): ReadLine | null {
  const r = it.brain?.read
  if (!r || !fin(r.rate) || !fin(r.base) || r.base <= 0) return null
  const x = r.rate / r.base
  const lab = TRAIT[r.dim]?.[r.val] ?? scrub(`${cap1(words(String(r.val ?? '')))} posts`)
  const flat = Math.abs(x - 1) < 0.15
  const where = `in ${POSS[acct]} niche`
  let sign: ReadLine['sign']; let text: string
  if (flat) { sign = 'Neutral'; text = `${lab} do about average ${where}.` }
  else if (x > 1) { sign = 'Good sign'; text = `${lab} go viral ${x.toFixed(1)}x more often ${where}.` }
  else { sign = 'Bad sign'; text = `${lab} go viral ${x < 0.6 ? 'about half as often' : 'a bit less often'} ${where}.` }
  const based = fin(r.n) ? ` Based on ${num(r.n)} posts.` : ''
  const detail = `${(r.rate * 100).toFixed(1)}% of these posts went viral, vs ${(r.base * 100).toFixed(1)}% of all posts.${based}`
  const rel = r.proven ? (r.small ? 'Proven on recent posts, but few examples' : 'Proven on recent posts') : 'Not proven yet'
  return { sign, text, flat, x, detail, rel }
}

// ---- is it good ----
const timesWord = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)
/** The quality check in one line, on the lane's own scale (80, 90, 100, 120). */
export function qaLine(it: PlanItem): string | null {
  if (it.st === 'failed') return FAILED_LINE
  const q = it.brain?.qa
  if (!q || !q.outcome) return null
  const score = fin(q.final) ? (fin(q.max) ? `${q.final}/${q.max}` : `${q.final}`) : null
  const needs = fin(q.pass_line) ? ` (needs ${q.pass_line})` : ''
  const rw = fin(q.rewrites) && q.rewrites > 0 ? q.rewrites : 0
  switch (q.outcome) {
    case 'passed': return score ? `Passed: ${score}${needs}.` : 'Passed.'
    case 'recovered': {
      const tail = rw ? ` It was rewritten ${timesWord(rw)}.` : ''
      return (score ? `Passed: ${score}${needs}.` : 'Passed.') + tail
    }
    case 'low': {
      const after = rw === 1 ? ', even after a rewrite' : rw > 1 ? `, even after ${rw} rewrites` : ''
      return `Low score${score ? `: ${score}` : ''}${after}.${q.approved_anyway ? ' Approved anyway.' : ''}`
    }
    case 'failed': return 'Did not pass the check.'
    case 'hand': return 'Checked by hand.'
    default: return null
  }
}

/** The Rise fact check against the call. The claim count is not stored today, so most lines carry no numbers. */
export function factsLine(it: PlanItem): string | null {
  const f = it.brain?.facts
  if (!f) return null
  const total = fin(f.total) && f.total > 0 ? f.total : null
  if (f.pass) return total ? `All ${total} facts match the call.` : 'Facts match the call.'
  const held = ' It will be held at publish until fixed.'
  if (total && fin(f.failed)) return `${f.failed} of ${total} facts not found in the call.${held}`
  return `Fact check against the call: failed.${held}`
}

/** The eight check scores in plain words, the weakest marked. */
export function dimsOf(it: PlanItem): { key: string; label: string; v: number; low: boolean }[] {
  const d = it.brain?.qa?.dims
  if (!d || typeof d !== 'object') return []
  const keys = Object.keys(d).filter(k => fin(d[k]))
  keys.sort((a, b) => (DIM_ORDER.indexOf(a) + 1 || 99) - (DIM_ORDER.indexOf(b) + 1 || 99))
  if (!keys.length) return []
  const weakest = it.brain?.qa?.weakest
  const lowKey = weakest && keys.includes(weakest) ? weakest : keys.reduce((m, k) => (d[k] < d[m] ? k : m), keys[0])
  return keys.map(k => ({ key: k, label: DIM[k] ?? scrub(cap1(words(k.toLowerCase()))), v: d[k], low: k === lowKey }))
}

// ---- how it is written ----
/** "Written as a teardown. Opens with proof." Model reasons are never shown. */
export function angleLine(it: PlanItem): string | null {
  const a = it.brain?.angle
  if (!a) return null
  const s = String(a.structure ?? '').split(' (')[0].trim().toUpperCase()
  const st = s ? (STRUCT[s] ?? scrub(words(s).toLowerCase())) : ''
  const h = a.opener ? HOOK[a.opener] : undefined
  const parts = [st ? `Written as ${st}.` : '', h ? `${h}.` : ''].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

/** First-line checks from the post body (spec R3.4). */
export function firstLineChecks(it: PlanItem): string[] {
  const b = it.brain
  if (!b) return []
  const out: string[] = []
  const fl = String(b.first_line ?? '').trim()
  if (fl && [...fl].length <= FIRST_LINE_MAX_CHARS) out.push(FIRST_LINE_SHORT)
  if (fl.includes('?')) out.push(FIRST_LINE_QUESTION)
  if (fin(b.words) && b.words < FIRST_LINE_MIN_WORDS) out.push(FIRST_LINE_UNDER_100_WORDS)
  return out
}

// ---- why this day / this week ----
/** Why this day: the real date and time with zone, and the weekday rule with its effect. */
export function dayWhy(it: PlanItem, acct: Acct, strip: BrainStrip | null | undefined, tz: Tz): string {
  if (it.suggested) return NO_DAY_LINE
  if (!it.day) return ''
  const t = timeLabel(it, tz)
  let s = `${planDay(it.day)}${t ? `, ${t}` : ''}.`
  const r = weekendRule(strip)
  if (r) {
    // A weekdays rule with a positive gain means weekend posts get that much fewer views. Otherwise no effect is claimed.
    const known = ruleClear(r) && (r.gain as number) > 0
    const effect = known ? `weekend posts get ${Math.round(Math.abs(r.gain as number))}% fewer views${acct === 'ivan' ? '' : ` for ${ACCT_NAME[acct]} creators`}${r.status === 'shadow' ? ' (still testing)' : ''}` : ''
    if (isWeekend(it.day)) s += acct === 'ivan' || !known ? ` A weekend day, against ${acct === 'ivan' ? 'your' : 'the'} weekdays-only rule.` : ` A weekend day: ${effect}.`
    else s += known ? ` A weekday: ${effect}.` : ` A weekday, as ${acct === 'ivan' ? 'your' : 'the'} rule says.`
  }
  const by = it.brain?.time_set_by
  if (by === 'hand') s += ' Set by hand.'
  else if (by === 'planner') s += ' Set by the planner.'
  return s
}

const isLm = (it: PlanItem) => !!(it.brain?.flags?.lm || it.post?.lead_magnet || evOf(it).some(e => e.type === 'lead_magnet'))
const isFounder = (it: PlanItem) => !!(it.brain?.flags?.founder || it.post?.founder || evOf(it).some(e => e.type === 'founder'))
const isTopPost = (it: PlanItem) => !!(it.brain?.brief || evOf(it).some(e => e.type === 'outlier' || e.type === 'brain'))

/** The week's mix: "3 from calls · 1 founder story · 1 lead magnet · 2 based on top posts". */
export function mixLine(items: PlanItem[]): string {
  const n = (f: (i: PlanItem) => boolean) => items.filter(f).length
  const p: string[] = []
  const calls = n(i => evOf(i).some(e => e.type === 'call')); if (calls) p.push(`${calls} from calls`)
  const f = n(isFounder); if (f) p.push(`${f} founder ${f > 1 ? 'stories' : 'story'}`)
  const lm = n(isLm); if (lm) p.push(`${lm} lead magnet${lm > 1 ? 's' : ''}`)
  const br = n(isTopPost); if (br) p.push(`${br} based on top posts`)
  return p.join(' · ')
}

/** Why this week: the week's mix, never the post's own reason. */
export function weekWhy(items: PlanItem[], week: string): string {
  const its = items.filter(i => i.week === week)
  if (!its.length) return ''
  const mix = mixLine(its)
  return mix ? `This week: ${mix}.` : `This week: ${its.length} post${its.length > 1 ? 's' : ''}.`
}

// ---- card face ----
export type Flag = { key: 'lm' | 'boosted' | 'founder' | 'carousel' | 'weekend' | 'failed' | 'low' | 'fact'; label: string; tone: 'ink' | 'plain' | 'red' | 'amber' }
/** Flags only for exceptions. "Low score" is off for Arch (its check would mark every post) and on published posts. */
export function flagsFor(it: PlanItem, strip: BrainStrip | null | undefined, acct?: Acct): Flag[] {
  const fl = it.brain?.flags
  const f: Flag[] = []
  const add = (key: Flag['key'], tone: Flag['tone']) => f.push({ key, label: FLAG_LABEL[key], tone })
  if (isLm(it)) add('lm', 'ink')
  if (fl?.boosted) add('boosted', 'plain')
  if (fl?.founder || it.post?.founder) add('founder', 'plain')
  if (fl?.carousel || it.format === 'carousel' || it.format === 'pdf') add('carousel', 'plain')
  if (isWeekend(it.day) && weekendRule(strip)) add('weekend', 'amber')
  if (it.st === 'failed' || fl?.failed) add('failed', 'red')
  else if (fl?.low_score && it.st !== 'published' && acct !== 'arch') add('low', 'amber')
  if (fl?.fact_fail) add('fact', 'red')
  return f
}

/** The weekday columns to draw: Mon to Fri, plus Sat or Sun only when an item sits there. */
export function weekDays(week: PlanWeek, items: PlanItem[]): number[] {
  const days = [0, 1, 2, 3, 4]
  for (const d of [5, 6]) { const day = addDays(week.start, d); if (items.some(i => i.day === day)) days.push(d) }
  return days
}

// ---- plan level ----
/** The answer line: how many posts wait for Ivan, then one line of parts. Counts from today on. */
export function answerOf(read: PlanRead): { need: number; title: string; parts: string[] } {
  const today = read?.today ?? ''
  const up = upcoming(itemsOf(read), today)
  const need = up.filter(i => i.st === 'review')
  // A post still waiting from an earlier day counts as this week's work.
  const wk = need.filter(i => i.which === 'this' || (i.day != null && i.day < today)).length
  const later = need.length - wk
  const sch = up.filter(i => i.st === 'scheduled').length
  const wr = up.filter(i => i.st === 'writing').length
  const fail = up.filter(i => i.st === 'failed').length
  const parts: string[] = []
  if (wk) parts.push(`${wk} this week`)
  if (later) parts.push(`${later} later`)
  if (sch) parts.push(`${sch} scheduled`)
  if (wr) parts.push(`${wr} being written`)
  if (fail) parts.push(`${fail} failed`)
  const n = need.length
  return { need: n, title: n ? `${n} post${n > 1 ? 's' : ''} ${n > 1 ? 'wait' : 'waits'} for your OK` : NOTHING_WAITS, parts }
}

const WARN_LINK: Record<string, { label: string; sub: string }> = {
  lm_due: { label: 'Lead magnets', sub: 'magnets' },
  empty_topic_area: { label: 'Add ideas', sub: 'ideas' },
  no_fresh_proof: { label: 'Add ideas', sub: 'ideas' },
  draft_failed: { label: 'Open the draft', sub: 'now' },
}
/** A warning in plain words with its fix link (null when there is nothing to open). */
export function warningOf(w: PlanWarning): { text: string; link: { label: string; sub: string } | null } {
  const text = scrub(String(w?.text ?? '')
    .replace(/No open ideas for demand \((\d+) posted in 8 weeks\)/, 'Out of ideas for sales posts ($1 used in 8 weeks)')
    .replace(/No open ideas for reach \((\d+) posted in 8 weeks\)/, 'Out of ideas for posts that bring new followers ($1 used in 8 weeks)')
    .replace(/No open ideas for (\w+) \((\d+) posted in 8 weeks\)/, (_m, t: string, n: string) => `Out of ideas for ${topicWord(t)} (${n} used in 8 weeks)`))
  const link = WARN_LINK[w?.code ?? '']
  return { text, link: link ? { ...link } : null }
}

/** A brain rule as a row: its name and the gain from following it. */
export function ruleRow(r: StripRule): { name: string; effect: string; tone: 'pos' | 'neg' | 'tag' } {
  const name = scrub(String(r.name ?? ''))
  if (!ruleClear(r)) {
    const crosses = fin(r.lo) && fin(r.hi) && r.lo < 0 && r.hi > 0
    if (!fin(r.gain) && !r.unclear && !crosses) return { name, effect: r.your_rule ? 'your rule' : 'not measured yet', tone: 'tag' }
    return { name, effect: 'your rule, not clear in the data', tone: 'tag' }
  }
  const gain = r.gain as number
  const up = gain >= 0
  return { name, effect: `${Math.round(Math.abs(gain))}% ${up ? 'more' : 'fewer'} ${r.metric === 'comments' ? 'comments' : 'views'}`, tone: up ? 'pos' : 'neg' }
}

/** The live and tested rules, test rows left out. */
export function rulesOf(strip: BrainStrip | null | undefined): { live: StripRule[]; testing: StripRule[] } {
  const all = realRules(strip)
  return { live: all.filter(r => r.status === 'live'), testing: all.filter(r => r.status === 'shadow') }
}

/** "1 of 2 proven on recent posts. Rise has 24 measured posts. Its guesses have not passed their test yet." */
export function readsSummary(strip: BrainStrip | null | undefined, acct: Acct): string {
  if (!strip) return ''
  const items = Array.isArray(strip.reads?.items) ? strip.reads.items : []
  const out: string[] = []
  if (items.length) {
    const proven = items.filter(i => i.proven)
    if (!proven.length) out.push(`Not proven yet. The brain needs more of ${POSS[acct]} recent posts.`)
    else out.push(`${proven.length} of ${items.length} proven on recent posts${proven.every(i => i.small) ? ', but few examples' : ''}.`)
  }
  const p = strip.predictions
  if (p && fin(p.need) && p.need > 0 && fin(p.measured)) {
    if (p.validated) out.push(`Predictions are on, from ${p.measured} measured posts.`)
    else if (p.measured >= p.need) out.push(`${ACCT_NAME[acct]} has ${p.measured} measured posts. Its guesses have not passed their test yet.`)
    else out.push(`Predictions start at ${p.need} measured posts: ${ACCT_NAME[acct]} ${p.measured} of ${p.need}.`)
  }
  return out.join(' ')
}

/** "Last 90 days: 253 views on a normal post · viral = 3x that" */
export function viewsLine(strip: BrainStrip | null | undefined): string {
  const m = strip?.views?.median
  return fin(m) ? `Last 90 days: ${num(m)} views on a normal post · viral = 3x that` : ''
}

/** How a published post did, next to the normal post. */
/** Rule names inside a sentence: first letter down ("More than 50 words" becomes "more than 50 words"). */
const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** "Mon 2 Nov. Under watch: more than 50 words and weekdays only." The day of the next brain check and what it watches. */
export function nextCheckLine(strip: BrainStrip | null | undefined): string {
  const n = strip?.next_check
  if (!n) return ''
  const date = typeof n.date === 'string' && n.date ? planDay(n.date) : ''
  const watch = (Array.isArray(n.watch) ? n.watch : []).map(w => scrub(String(w ?? '')).trim()).filter(Boolean).map(lower1)
  if (!date) return 'No check day is set yet.'
  return `${date}. ${watch.length ? `Under watch: ${andList(watch)}.` : 'No rule is under watch.'}`
}

/** "From 10,629 posts by 140 creators." */
export function sourceNote(strip: BrainStrip | null | undefined): string {
  const c = strip?.collection
  return c && fin(c.posts) && fin(c.creators) ? `From ${num(c.posts)} posts by ${num(c.creators)} creators.` : ''
}

/** The plan note under the strip (Rise and Arch: what is being tested). Already plain in the read; scrubbed again here. */
export function stripNote(strip: BrainStrip | null | undefined): string {
  return typeof strip?.note === 'string' ? scrub(strip.note).trim() : ''
}

/** A change the brain holds back for Ivan's say: "Start following: add a picture". */
export function proposalLine<T extends { name: string; to_status: string }>(p: T): string {
  const name = lower1(scrub(String(p?.name ?? '')))
  const verb = p?.to_status === 'live' ? 'Start following' : p?.to_status === 'shadow' ? 'Go back to testing' : p?.to_status === 'candidate' ? 'Start testing' : 'Stop using'
  return `${verb}: ${name}`
}

/** A change that already happened: "Add a picture: now followed, Mon 12 Oct". Test rows give nothing. */
export function changeLine<T extends { rule_id: string; name: string; to_status: string; at: string }>(c: T): string {
  if (String(c?.rule_id ?? '').startsWith('zz-')) return ''
  const how = c.to_status === 'live' ? 'now followed' : c.to_status === 'shadow' ? 'back to testing' : c.to_status === 'candidate' ? 'now testing' : 'stopped'
  const day = typeof c.at === 'string' && c.at ? planDay(c.at) : ''
  return `${scrub(String(c.name ?? ''))}: ${how}${day ? `, ${day}` : ''}`
}

/** The receipt after Accept or Dismiss: "Now following: add a picture." / "Dismissed. The rule stays as it is." */
export function decisionLine<T extends { name: string; to_status: string }>(p: T, accepted: boolean): string {
  if (!accepted) return 'Dismissed. The rule stays as it is.'
  const name = lower1(scrub(String(p?.name ?? '')))
  const lead = p?.to_status === 'live' ? 'Now following' : p?.to_status === 'shadow' ? 'Back to testing' : p?.to_status === 'candidate' ? 'Now testing' : 'Stopped using'
  return `${lead}: ${name}.`
}

/** The receipt after Undo: "Put back: add a picture." */
export function undoLine(c: { name: string }): string {
  return `Put back: ${lower1(scrub(String(c?.name ?? '')))}.`
}

/** A second line under a rule row when it did not hold on the newest posts. */
export function ruleNote(r: Pick<StripRule, 'held_latest' | 'your_rule'>): string | null {
  if (r.held_latest !== false) return null
  return r.your_rule ? 'Did not hold on the newest posts, kept because you set it.' : 'Did not hold on the newest posts.'
}

/** "7 of 29 went viral" (viral = 3x a normal post). */
export function viralLine(strip: BrainStrip | null | undefined): string {
  const v = strip?.views
  return v && fin(v.breakouts) && fin(v.measured) && v.measured > 0 ? `${v.breakouts} of ${v.measured} went viral` : ''
}

/** The tooltip of one brain-guess dot: the post, what the guess says, how far to trust it. */
export function readDotTip<T extends { title: string; x: number; proven: boolean; small: boolean }>(i: T): string {
  const x = i.x
  const says = !fin(x) ? 'has no guess yet'
    : Math.abs(x - 1) < 0.15 ? 'does about average'
      : x >= 1 ? `goes viral ${(Math.round(x * 10) / 10).toFixed(1)}x more often`
        : x >= 0.6 ? 'goes viral a bit less often' : 'goes viral about half as often'
  const rel = i.proven ? `Proven on recent posts${i.small ? ', but few examples' : ''}` : 'Not proven yet'
  return `${displayTitle(i.title)}: ${says}. ${rel}.`
}

/** One idea-stock row in plain words. */
export function stockRow(s: { topic: string; stock: number; used: number }): { name: string; stock: number; used: number; empty: boolean; tip: string } {
  const name = cap1(topicWord(s.topic))
  const stock = fin(s.stock) ? s.stock : 0
  const used = fin(s.used) ? s.used : 0
  const empty = stock <= 0
  return { name, stock, used, empty, tip: empty ? `${name}: out of ideas, ${used} used in 8 weeks.` : `${name}: ${stock} ideas in stock, ${used} used in 8 weeks.` }
}

export function resultLine(it: PlanItem, strip: BrainStrip | null | undefined): string | null {
  const r = it.brain?.result
  if (!r) return null
  if (!fin(r.views)) return r.young ? 'Numbers are still coming in.' : null
  const m = strip?.views?.median
  let s = `${num(r.views)} views${r.young ? ' so far' : ''}.`
  if (fin(m)) s += ` A normal post gets ${num(m)}.`
  if (r.viral) s += ' It went viral.'
  return s
}

/** The idea-stock topic in plain words. */
export function topicWord(p: string): string {
  const k = String(p ?? '')
  return TOPIC[k] ?? scrub(`${words(k)} posts`.trim())
}

/** True when the planner has not run in 26 hours (or never). */
export function lateRun(read: Pick<PlanRead, 'last_run'>, now: Date): boolean {
  const t = Date.parse(read?.last_run?.ran_at ?? '')
  if (Number.isNaN(t)) return true
  return now.getTime() - t > 26 * 3600_000
}

// ---- the detail panel (spec 2026-10-12 §3c, R2.4, R3.3 to R3.5) ----
export const FIRST_LINES_MAX = 260
const PHOTO_REASON: Record<string, string> = { no_fitting_photo: 'none of your photos fits this post' }
const shortDate = (iso: string) => planDay(iso).replace(/^\w+ /, '')

/** "Fri 23 Oct · 07:00 PT · 185 words · edited by hand"; a planned slot starts with "No day yet". */
export function metaLine(it: PlanItem, tz: Tz): string {
  const p: string[] = []
  if (it.suggested || !it.day) p.push('No day yet')
  else { p.push(planDay(it.day)); const t = timeLabel(it, tz); if (t) p.push(t) }
  const w = it.brain?.words
  if (fin(w) && w > 0) p.push(`${num(w)} words`)
  if (it.brain?.edited) p.push('edited by hand')
  return p.join(' · ')
}

/** Where it comes from, when it says more than the reason: the first evidence line in plain words. */
export function sourceLine(it: PlanItem, reason: string | null): string | null {
  const brief = !!it.brain?.brief
  const e = evOf(it).find(x => x.label && !(brief && (x.type === 'outlier' || x.type === 'brain')))
  if (!e) return null
  const s = plainWhy(e.label)
  return s && s !== reason ? s : null
}

/** "A written draft based on a post by Monika Grycz that got 4.6x their normal views." (never the ranker's own text) */
export function briefLine(it: PlanItem): string | null {
  const br = it.brain?.brief
  if (!br) return null
  const who = br.author && !slugLike(br.author) ? br.author.trim() : null
  const r = fin(br.ratio) && br.ratio > 0 ? br.ratio.toFixed(1) : null
  if (who) return r ? `A written draft based on a post by ${who} that got ${r}x their normal views.` : `A written draft based on a top post by ${who}.`
  return r ? `A written draft based on a post that got ${r}x its author's normal views.` : null
}

/** "Copies the shape of a post by Monika Grycz." */
export function shapeLine(it: PlanItem): string | null {
  const br = it.brain?.brief
  const who = br?.author && !slugLike(br.author) ? br.author.trim() : null
  return who ? `Copies the shape of a post by ${who}.` : null
}

/** "Replaced: 'Friends and family' failed the quality check on 12 Oct; the planner picked this one." */
export function replacedLine(it: PlanItem): string | null {
  const r = it.brain?.replaced
  if (!r || !r.title) return null
  const on = r.on && /^\d{4}-\d{2}-\d{2}/.test(r.on) ? ` on ${shortDate(r.on)}` : ''
  return `Replaced: '${displayTitle(r.title)}' failed the quality check${on}; the planner picked this one.`
}

/** The picture: Rise photos come in rotation; Ivan's assigner says why there is none. */
export function photoLine(it: PlanItem, acct: Acct): string | null {
  const ph = it.brain?.photo
  if (!ph) return null
  const whose = acct === 'ivan' ? 'Your' : `${OWNER[acct]}'s`
  if (ph.has && ph.rotation) return `${whose} photo, picked in rotation.`
  const why = ph.reason ? (PHOTO_REASON[ph.reason] ?? scrub(words(ph.reason)).trim().replace(/\.$/, '')) : ''
  if (ph.has) return why ? `${whose} photo: ${why}.` : null
  return why ? `No photo: ${why}.` : null
}

/** The writer's opener rule (H01), when the account has it in force or in test. */
export function writerRuleLine(acct: Acct, strip: BrainStrip | null | undefined): string | null {
  const r = realRules(strip).find(x => /^H01-/i.test(String(x.rule_id ?? '')))
  return r ? `Writer rule: open with something ${OWNER[acct]} did or saw.` : null
}

/** "3 of 12 people who engaged run a brand (Rise normal: 9%)." */
export function engagedLine(it: PlanItem, acct: Acct): string | null {
  const e = it.brain?.result?.engaged
  if (!e || !fin(e.brand) || !fin(e.total) || e.total <= 0) return null
  const usual = fin(e.usual_pct) ? ` (${ACCT_NAME[acct]} normal: ${Math.round(e.usual_pct)}%)` : ''
  return `${num(e.brand)} of ${num(e.total)} people who engaged run a brand${usual}.`
}

/** The first lines of the post, cut at a word at most 260 characters in, with an ellipsis. */
export function firstLines(it: PlanItem): string | null {
  const b = String(it.brain?.body_head ?? '').trim()
  if (!b) return null
  const cut = b.length > FIRST_LINES_MAX - 1 ? b.slice(0, FIRST_LINES_MAX - 1).replace(/\s+\S*$/, '').trimEnd() : b
  return `${cut}…`
}
