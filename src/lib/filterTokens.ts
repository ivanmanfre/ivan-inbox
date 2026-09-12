/* ==========================================================================
   src/lib/filterTokens.ts — THE FILTER GRAMMAR (E2, goal run
   inbox-repair-floor-and-21st-moves-2026-09-12).

   Ported from andrewlu0/filters (21st.dev, 1030 uses): a filter is a row of
   TOKENS, each one reading `[Field] [operator] [Value] [×]`, with a `+` that
   opens a searchable field list and a `Clear`. The skin is discarded entirely
   (Tailwind, shadcn, lucide, radix); what is ported is the SHAPE of the
   control — a filter you can read as a sentence and edit one word of.

   This file is the half with no pixels in it: the grammar, one FIELD REGISTRY
   per surface, and the pure functions that turn a token set into rows. Every
   field here is one the surface's own type PROVES; nothing is invented, and a
   row that carries nothing for a field matches neither `is` nor `is not`,
   which is the same rule contentFilters.ts already states ("a fabricated
   bucket is a claim about a row the machine never made").
   ========================================================================== */
import {
  STATUS_LABEL, eventTime, filterByStatus, isConversation, isLeadMagnet,
  type Status, type Thread, type Filter,
} from './inbox'
import { STAGE_LADDER, stageIsOff, stageStep } from '../exp/v2c/stage'

/* --------------------------------------------------------------------------
   1 · The grammar
   -------------------------------------------------------------------------- */

export type TokenOp = 'is' | 'is not' | 'has' | 'has no' | 'older than' | 'newer than'

export type FilterToken = {
  id: string
  field: string
  op: TokenOp
  /** '' for the two possession operators, which ARE the answer. */
  value: string
}

export type FieldValue = { value: string; label: string }

/** How the value slot behaves, which is also how a token is matched. */
export type FieldKind =
  /** One of a fixed list. `is` / `is not`. */
  | 'enum'
  /** A yes/no the row either carries or does not. `has` / `has no`, no value slot. */
  | 'flag'
  /** A number of days against a timestamp. `older than` / `newer than`. */
  | 'days'

export type FieldSpec<T> = {
  key: string
  label: string
  kind: FieldKind
  ops: TokenOp[]
  /** enum only. */
  values?: FieldValue[]
  /**
   * enum → the row's value, or null when the row carries nothing here.
   * flag  → 'yes' | 'no'.
   * days  → an ISO timestamp, or null when the row has no such event.
   */
  of: (row: T) => string | null
  /**
   * The escape hatch for a field that is SET-shaped rather than row-shaped —
   * the DMs status axis, whose 'needs' and 'all' are predicates over a bucket
   * rather than a value a row carries. Given one, it replaces `of` entirely,
   * so the token and the surface's own control cannot disagree.
   */
  apply?: (rows: T[], token: FilterToken) => T[]
}

export const OP_LABEL: Record<TokenOp, string> = {
  is: 'is', 'is not': 'is not', has: 'has', 'has no': 'has no',
  'older than': 'older than', 'newer than': 'newer than',
}

/** A token id that does not need a crypto API (this is a React key, not a secret). */
let seq = 0
export function tokenId(): string {
  seq += 1
  return `ftk-${seq}-${Math.random().toString(36).slice(2, 7)}`
}

export function findField<T>(fields: FieldSpec<T>[], key: string): FieldSpec<T> | null {
  return fields.find(f => f.key === key) ?? null
}

/** The token a fresh `+` pick starts as: the field's first operator, and for an
 *  enum its first value, so a token is never born meaningless. */
export function newToken<T>(field: FieldSpec<T>): FilterToken {
  const op = field.ops[0]
  const value = field.kind === 'flag' ? ''
    : field.kind === 'days' ? '7'
      : field.values?.[0]?.value ?? ''
  return { id: tokenId(), field: field.key, op, value }
}

export function valueLabel<T>(field: FieldSpec<T>, token: FilterToken): string {
  if (field.kind === 'flag') return ''
  if (field.kind === 'days') {
    const n = Number(token.value)
    return `${token.value} ${n === 1 ? 'day' : 'days'}`
  }
  return field.values?.find(v => v.value === token.value)?.label ?? token.value
}

/** The whole token as one sentence, for an aria-label and for a title. */
export function tokenSentence<T>(field: FieldSpec<T>, token: FilterToken): string {
  const v = valueLabel(field, token)
  return v ? `${field.label} ${OP_LABEL[token.op]} ${v}` : `${field.label} ${OP_LABEL[token.op]}`
}

const DAY = 86_400_000

/** Does ONE row satisfy ONE token? The null rule lives here and only here. */
export function matchToken<T>(field: FieldSpec<T>, row: T, token: FilterToken, now: number): boolean {
  const v = field.of(row)
  switch (token.op) {
    case 'is': return v !== null && v === token.value
    // A row carrying nothing for this field makes no claim, so it answers
    // neither side. Letting it through `is not` would be the machine saying
    // "this one is definitely not Arch" about a row with no lane at all.
    case 'is not': return v !== null && v !== token.value
    case 'has': return v === 'yes'
    case 'has no': return v === 'no'
    case 'older than':
    case 'newer than': {
      if (v === null) return false
      const n = Number(token.value)
      if (!Number.isFinite(n)) return true
      const age = now - Date.parse(v)
      if (!Number.isFinite(age)) return false
      return token.op === 'older than' ? age > n * DAY : age <= n * DAY
    }
  }
}

/** AND across tokens. A token naming a field this surface does not register is
 *  ignored rather than emptying the list — a persisted set outlives a rename. */
export function applyTokens<T>(
  rows: T[], fields: FieldSpec<T>[], tokens: FilterToken[], now: number = Date.now(),
): T[] {
  let out = rows
  for (const t of tokens) {
    const f = findField(fields, t.field)
    if (!f) continue
    out = f.apply ? f.apply(out, t) : out.filter(r => matchToken(f, r, t, now))
  }
  return out
}

/* --------------------------------------------------------------------------
   2 · DMs — the fields the Thread type proves
   -------------------------------------------------------------------------- */

/** The three tenants the `Filter` union already names, with the labels the six
 *  lane chips have always worn. One source, so a chip and a token cannot drift. */
export const LANE_VALUES: FieldValue[] = [
  { value: 'ivan', label: 'Ivan' },
  { value: 'risedtc', label: 'Rise' },
  { value: 'arch', label: 'Arch' },
]

export const CHANNEL_VALUES: FieldValue[] = [
  { value: 'dm', label: 'DM' },
  { value: 'inmail', label: 'InMail' },
  { value: 'email', label: 'Email' },
]

const STAGE_OFF = ['archived', 'disqualified', 'bounced'] as const

export const STAGE_VALUES: FieldValue[] = [
  ...STAGE_LADDER.map(l => ({ value: l.toLowerCase(), label: l })),
  ...STAGE_OFF.map(s => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })),
]

export const YES_NO: FieldValue[] = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]

const STATUS_VALUES: FieldValue[] = (Object.keys(STATUS_LABEL) as Status[])
  .map(s => ({ value: s, label: STATUS_LABEL[s] }))

/**
 * WHICH CHANNEL THIS THREAD RODE — `t.channel`, which groupThreads sets to the
 * last message that actually went out (never a pending draft).
 *
 * Deliberately NOT `threadKind`, which answers a different question ("has this
 * thread ever touched email") and would have silently WIDENED the Email lane
 * while porting a control: a LinkedIn conversation with one email mirror
 * anywhere in it would start appearing under Email. The Email chip has meant
 * `t.channel === 'email'` since the lane existed (lib/inbox.ts filterThreads),
 * and the shortcut has to select exactly the rows the old chip did.
 */
export function threadChannel(t: Thread): 'email' | 'inmail' | 'dm' {
  return t.channel === 'email' ? 'email' : t.channel === 'linkedin_inmail' ? 'inmail' : 'dm'
}

/** The newest INBOUND event, which is what "last reply" means. `t.last` alone
 *  would have answered about our own send on every thread we spoke last in —
 *  i.e. on exactly the threads this question gets asked about. */
export function lastReplyAt(t: Thread): string | null {
  let out: string | null = null
  for (const m of t.messages) {
    if (m.direction !== 'inbound') continue
    const when = eventTime(m)
    if (out === null || when > out) out = when
  }
  return out
}

function stageValue(t: Thread): string | null {
  const raw = (t.stage ?? '').trim().toLowerCase()
  if (stageIsOff(raw)) return raw
  const step = stageStep(raw)
  return step === null ? null : STAGE_LADDER[step].toLowerCase()
}

export const DM_FIELDS: FieldSpec<Thread>[] = [
  { key: 'lane', label: 'lane', kind: 'enum', ops: ['is', 'is not'], values: LANE_VALUES,
    of: t => t.client_id || null },
  { key: 'channel', label: 'channel', kind: 'enum', ops: ['is', 'is not'], values: CHANNEL_VALUES,
    of: threadChannel },
  // Set-shaped: filterByStatus owns the definition of 'needs' and 'all', and a
  // second copy of it here is how the bar and the list start disagreeing.
  { key: 'status', label: 'status', kind: 'enum', ops: ['is'], values: STATUS_VALUES,
    of: () => null,
    apply: (rows, token) => filterByStatus(rows, token.value as Status) },
  { key: 'stage', label: 'stage', kind: 'enum', ops: ['is', 'is not'], values: STAGE_VALUES,
    of: stageValue },
  { key: 'spam', label: 'spam', kind: 'enum', ops: ['is'], values: YES_NO,
    of: t => (t.spam ? 'yes' : 'no') },
  { key: 'draft', label: 'draft', kind: 'flag', ops: ['has', 'has no'],
    of: t => (t.draft !== null ? 'yes' : 'no') },
  { key: 'unread', label: 'unread', kind: 'flag', ops: ['has', 'has no'],
    of: t => (t.unread > 0 ? 'yes' : 'no') },
  { key: 'last reply', label: 'last reply', kind: 'days', ops: ['older than', 'newer than'],
    of: lastReplyAt },
  { key: 'lead magnet', label: 'lead magnet', kind: 'enum', ops: ['is'], values: YES_NO,
    of: t => (isLeadMagnet(t) ? 'yes' : 'no') },
]

export function wantsSpam(tokens: FilterToken[]): boolean {
  return tokens.some(t => t.field === 'spam' && t.op === 'is' && t.value === 'yes')
}

/** True when the token set owns the status axis, so the surface's own default
 *  status pass must stand down rather than intersect with it. */
export function hasStatusToken(tokens: FilterToken[]): boolean {
  return tokens.some(t => t.field === 'status')
}

/**
 * The DMs list, from a token set.
 *
 * The two rules filterThreads has always applied are applied FIRST and in the
 * same order, so a chip shortcut selects exactly the rows its chip did: only
 * CONVERSATIONS (a send echo lives in Sends), and the spam folder is its own
 * lane rather than a slice of the others.
 */
export function applyThreadTokens(
  threads: Thread[], tokens: FilterToken[], now: number = Date.now(),
): Thread[] {
  const convos = threads.filter(isConversation)
  const base = wantsSpam(tokens) ? convos.filter(t => t.spam) : convos.filter(t => !t.spam)
  return applyTokens(base, DM_FIELDS, tokens, now)
}

/* --------------------------------------------------------------------------
   3 · The six lane chips, as shortcuts
   -------------------------------------------------------------------------- */

/** What a chip WRITES. `All` writes nothing, because "all" is the question with
 *  no narrowing in it. */
export function tokensForFilter(f: Filter): FilterToken[] {
  const one = (field: string, value: string): FilterToken[] =>
    [{ id: tokenId(), field, op: 'is', value }]
  switch (f) {
    case 'all': return []
    case 'email': return one('channel', 'email')
    case 'spam': return one('spam', 'yes')
    default: return one('lane', f)
  }
}

/**
 * And what the rest of the app READS. Every consumer downstream of the chip bar
 * (WarmSignals, DmHistory, PushedBar, the Shell's own context line) takes a
 * `Filter`, so the token set is projected back onto that union rather than
 * changing nine signatures: the spam folder outranks a lane, a lane outranks a
 * channel, and anything else is 'all'.
 */
export function filterFromTokens(tokens: FilterToken[]): Filter {
  if (wantsSpam(tokens)) return 'spam'
  const lane = tokens.find(t => t.field === 'lane' && t.op === 'is'
    && LANE_VALUES.some(v => v.value === t.value))
  if (lane) return lane.value as Filter
  if (tokens.some(t => t.field === 'channel' && t.op === 'is' && t.value === 'email')) return 'email'
  return 'all'
}

/* --------------------------------------------------------------------------
   4 · Sales — the fields the row already derives
   -------------------------------------------------------------------------- */

/** Exactly the three facts `renderRow` computes for every call before it draws
 *  one: which part of the fortnight it sits in, whether the matcher found a
 *  pack, and whether a past call has a report under it. Nothing else on that
 *  row is a question ("who am I talking to" is what the list itself answers). */
export type SalesFacts = { when: string; pack: boolean; report: boolean }

export const SALES_WHEN_VALUES: FieldValue[] = [
  { value: 'today', label: 'Today' },
  { value: 'later', label: 'Later this week' },
  { value: 'next', label: 'Next week' },
  { value: 'earlier', label: 'Earlier this week' },
]

export const SALES_FIELDS: FieldSpec<SalesFacts>[] = [
  { key: 'when', label: 'when', kind: 'enum', ops: ['is', 'is not'], values: SALES_WHEN_VALUES,
    of: r => r.when },
  { key: 'pack', label: 'pack', kind: 'flag', ops: ['has', 'has no'],
    of: r => (r.pack ? 'yes' : 'no') },
  { key: 'report', label: 'report', kind: 'flag', ops: ['has', 'has no'],
    of: r => (r.report ? 'yes' : 'no') },
]

export function salesRowMatches(facts: SalesFacts, tokens: FilterToken[]): boolean {
  return applyTokens([facts], SALES_FIELDS, tokens).length === 1
}

/* --------------------------------------------------------------------------
   5 · Content — the derived facets, as fields
   -------------------------------------------------------------------------- */

/**
 * Content's facets are not a registry anyone writes down: contentFilters.ts
 * derives them from the rows currently loaded, because "a hardcoded enum would
 * be wrong the next time an agent writes a new value". So the field list here
 * is derived too, from the same Facet objects the pills were drawn from.
 *
 * `is` ONLY. FilterState is `Record<string,string>` — one value per facet, read
 * by applyFilters at seven call sites — and adding `is not` would mean changing
 * that shape everywhere. A control port does not get to change what the control
 * can express.
 */
export type ContentFacetLike = {
  key: string
  label: string
  options: { value: string; label: string; n: number }[]
}

export function contentFields(facets: ContentFacetLike[]): FieldSpec<never>[] {
  return facets.map(f => ({
    key: f.key,
    label: f.label.toLowerCase(),
    kind: 'enum' as const,
    ops: ['is'] as TokenOp[],
    values: f.options.map(o => ({ value: o.value, label: o.label })),
    of: () => null,
  }))
}

/** The tokens a FilterState IS. Order follows the facet list so the row does not
 *  reshuffle itself when a value changes. */
export function tokensFromFilterState(
  state: Record<string, string>, facets: ContentFacetLike[],
): FilterToken[] {
  const out: FilterToken[] = []
  for (const f of facets) {
    const v = state[f.key]
    if (v) out.push({ id: `ftk-${f.key}`, field: f.key, op: 'is', value: v })
  }
  return out
}

export function filterStateFromTokens(tokens: FilterToken[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of tokens) if (t.value) out[t.field] = t.value
  return out
}

/* --------------------------------------------------------------------------
   6 · Persistence — per surface, for the tab you are in
   -------------------------------------------------------------------------- */

/** sessionStorage, not local: the question you were asking survives a refresh
 *  and dies with the tab. A filter that outlives the day it was set is a list
 *  that looks empty for a reason nobody remembers. */
export function tokenStoreKey(surface: string): string {
  return `wb-filters:${surface}`
}

export function readTokens(surface: string): FilterToken[] {
  try {
    const raw = sessionStorage.getItem(tokenStoreKey(surface))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is FilterToken =>
      !!t && typeof t === 'object'
      && typeof (t as FilterToken).field === 'string'
      && typeof (t as FilterToken).op === 'string'
      && typeof (t as FilterToken).value === 'string')
      .map(t => ({ ...t, id: t.id || tokenId() }))
  } catch { return [] }
}

export function writeTokens(surface: string, tokens: FilterToken[]): void {
  try { sessionStorage.setItem(tokenStoreKey(surface), JSON.stringify(tokens)) } catch { /* private window */ }
}
