import { supabase } from './supabase'
import { ClientRpcError, clientRpcMessage, type ContentLane } from './content'
import type { Soft } from './audience'

/* ==========================================================================
   AUDIENCE PROPOSALS — the writer's output, waiting on Ivan (Run 06, §2.5).

   A proposal is a row in `ops_drafts` with `kind = 'audn_recommendation'`.
   The weekly writer workflow puts it there; NOTHING else in this app writes
   one, and approving it is the only way an audience recommendation ever
   reaches an idea bank. That approval is a database function
   (`audn_recommendation_publish`), not an insert from here: one writer per
   table, and the idempotency key is the proposal's own id.

   Three states exist and no others (CONTRACTS §2.1):

     open       no stamps. This module reads exactly these.
     published  `approved_at` and `sent_at` are set and `context.published`
                names the row that was written. It leaves this list.
     dropped    the row is DELETED. Delete means delete — there is no archive
                flag to restore it from and the surface says so before asking.

   Two rules carried over from the audience block next door:

     · THE CONSUMER NEVER DERIVES THE CLIENT. `client_id` is the lane the
       operator picked in the Segmented control, passed in as a parameter.
     · A READ THAT FAILED IS A VALUE, not an empty list. Every fetch here
       soft-fails into `{ok:false, error}` and the block renders the failure
       with the name of the read in it.

   And one this module adds, because it is the first audience surface that
   WRITES: nothing is removed from the screen until the database says it is
   gone. A failed approve keeps its row and shows the refusal.
   ========================================================================== */

export const PROPOSAL_KIND = 'audn_recommendation'

// Only the columns this surface reads. `slack_channel` is deliberately absent:
// it is null for this kind by the migration's own CHECK, and a column nothing
// renders is a column that can only ever mislead the next reader.
export const COLUMNS = 'id, client_id, kind, body, context, created_at'

// ---------------------------------------------------------------------------
// Row shapes. The context bag is typed LOOSELY on purpose: it is written by an
// n8n Code node against a model's output, so every field here is a field that
// might be missing, and the renderer treats absence as absence rather than
// asserting a shape the writer never promised.
// ---------------------------------------------------------------------------

export type RosterRole =
  | 'direct_competitor' | 'buyer_voice' | 'format_reference' | 'warm_anchor'

/** The recommendation object itself (Run 03 CONTRACTS §2.1, minus the fields
    the RPC owns). The four text fields plus the title are the ONLY things a
    client can read after approval, and they are the only things Edit changes. */
export type AudnObject = {
  what_changed?: string | null
  why_it_matters?: string | null
  could_publish?: string | null
  proof_needed?: string | null
  evidence?: {
    source_ids?: string[] | null
    source_dates?: string[] | null
    sample_n?: number | null
    unknowns?: string | null
  } | null
  roster_role?: string | null
  roster_accounts?: string[] | null
  /** A string names the asset the post needs; `false` means none is needed.
      Both are answers — only `undefined` is silence. */
  asset_required?: string | false | null
  asset_state?: string | null
  pillar?: string | null
  format?: string | null
  title?: string | null
}

/** One cited row, as the writer captured it. Every id in
    `evidence.source_ids` appears here, so the reader can open what was read. */
export type SourceRow = {
  table?: string | null
  id?: string | null
  author?: string | null
  date?: string | null
  reactions?: number | null
  comments?: number | null
  shares?: number | null
  url?: string | null
}

export type ProposalContext = {
  audn?: AudnObject | null
  source_rows?: SourceRow[] | null
  author_baseline?: {
    median?: number | null
    n?: number | null
    window_days?: number | null
    source?: string | null
  } | null
  proposed_at?: string | null
  cycle_id?: string | null
  prompt?: string | null
  /** Present when this proposal REFRESHES a Run 03 recommendation rather than
      being written from scratch. The surface says so: a reader deciding on a
      line that already existed once is deciding a different question. */
  seed?: {
    run?: string | null
    recommendation_id?: string | null
    refreshed?: string[] | null
  } | null
  /** Stamped by the RPC on approve. An open proposal never carries it. */
  published?: {
    table?: string | null
    id?: string | null
    ref?: string | null
    at?: string | null
    overrides?: Record<string, string> | null
  } | null
  [key: string]: unknown
}

export type Proposal = {
  id: string
  client_id: string
  kind: string
  /** `what_changed` again, in the column `ops_drafts` renders everywhere else.
      The audn object is the source of truth; this is the fallback. */
  body: string | null
  context: ProposalContext | null
  created_at: string | null
}

// ---------------------------------------------------------------------------
// Soft failure, the same shape `audience.ts` uses (its `Soft<T>` is imported
// rather than redeclared — two definitions of one state machine is two chances
// to disagree). The wrapper is local because `audience.ts`'s is private.
// ---------------------------------------------------------------------------
function msg(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === 'string' ? e : 'unavailable'
}

async function soft<T>(
  what: string,
  run: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<Soft<T>> {
  try {
    const { data, error } = await run()
    if (error) return { ok: false, error: `${what}: ${error.message}` }
    return { ok: true, rows: (data ?? []) as T[] }
  } catch (e: unknown) {
    return { ok: false, error: `${what}: ${msg(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every OPEN proposal for one lane, oldest first — the order they were
    written in is the order they are read in, so nothing jumps the queue by
    being re-read. 50 is a ceiling far above the writer's own per-cycle limit
    (3 by default); hitting it would mean the lane was never reviewed. */
export async function fetchProposals(lane: ContentLane): Promise<Soft<Proposal>> {
  // DEV ONLY. The writer workflow is not deployed and this app is behind a
  // magic-link gate, so the list layout cannot otherwise be LOOKED at. The
  // guard is a compile-time constant in a production build, so Rollup drops
  // the branch and `devFixture` with it — `dist/` carries neither the flag
  // name nor the fixture strings.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const flag = new URLSearchParams(window.location.search).get('audnProposalsFixture')
    if (flag === '1') return { ok: true, rows: devFixture(lane) }
    if (flag === 'empty') return { ok: true, rows: [] }
  }
  return soft<Proposal>('proposals', () =>
    supabase.from('ops_drafts')
      .select(COLUMNS)
      .eq('kind', PROPOSAL_KIND)
      .eq('client_id', lane)
      .is('approved_at', null)
      .is('sent_at', null)
      .order('created_at', { ascending: true })
      .limit(50))
}

// ---------------------------------------------------------------------------
// Writes. Both of them, and there are only two.
// ---------------------------------------------------------------------------

/** The five strings a human may change before approving. Evidence is never
    overridable — the citation is the proposal's proof, and a proof someone
    could retype is not one. */
export type TextOverrides = Partial<Record<
  'what_changed' | 'why_it_matters' | 'could_publish' | 'proof_needed' | 'title',
  string
>>

export const OVERRIDABLE = [
  'what_changed', 'why_it_matters', 'could_publish', 'proof_needed', 'title',
] as const

export type PublishResult = {
  /** True when the idea row already existed: the RPC wrote NOTHING and
      returned the row it found. The surface says so rather than claiming a
      write it did not make. */
  already: boolean
  table: string | null
  id: string | null
  ref: string | null
}

// The server's refusal codes, in words that say what happened to the row the
// reader is looking at. Anything unmapped keeps the raw code (`clientRpcMessage`
// does that), because an unnamed refusal is unsearchable.
export const PUBLISH_MESSAGES: Record<string, string> = {
  not_found: 'That proposal is gone: dropped or already approved elsewhere.',
  unknown_client:
    'That lane has no client registry row, so the database refused to publish it. Nothing changed.',
  no_text:
    'Every text field came back empty, so there was nothing to publish. Nothing changed.',
}

/** APPROVE. The one path from a proposal to an idea bank.
    `client_ideas` for a client lane, `lm_idea_candidates` for Ivan — which of
    the two is the database's decision, and it comes back in `table`. */
export async function publishProposal(
  lane: ContentLane, id: string, overrides: TextOverrides = {},
): Promise<PublishResult> {
  const { data, error } = await supabase.rpc('audn_recommendation_publish', {
    p_client_id: lane,
    p_proposal_id: id,
    p_text_overrides: overrides,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Record<string, unknown>
  if (r.ok !== true) {
    const code = typeof r.error === 'string' ? r.error : 'unknown'
    throw new ClientRpcError(code, PUBLISH_MESSAGES[code] ?? clientRpcMessage(code))
  }
  return {
    already: r.already === true,
    table: typeof r.table === 'string' ? r.table : null,
    id: typeof r.id === 'string' ? r.id : null,
    ref: typeof r.ref === 'string' ? r.ref : null,
  }
}

/** DROP. The row is deleted, not flagged: `ops_drafts` has no archive column
    and inventing one here would put a second definition of "open" next to the
    one the writer's skip rule counts.

    `.is('approved_at', null)` is the race guard — a proposal approved in
    another tab between the read and the click must not be deleted out from
    under the idea row it became. That makes a zero-row delete a REAL outcome,
    so the count comes back and the caller is expected to tell the reader when
    nothing was removed. (§2.5 spells the three filters; the `select` is this
    file's addition, for exactly that reason.) */
export async function dropProposal(id: string): Promise<{ deleted: number }> {
  const { data, error } = await supabase.from('ops_drafts')
    .delete()
    .eq('id', id)
    .eq('kind', PROPOSAL_KIND)
    .is('approved_at', null)
    .select('id')
  if (error) throw new Error(error.message)
  return { deleted: Array.isArray(data) ? data.length : 0 }
}

// ---------------------------------------------------------------------------
// Pure helpers. Everything the row renders that is not a straight field read
// lives here, so the component has no string arithmetic of its own to get
// wrong and the test can assert the sentence rather than the layout.
// ---------------------------------------------------------------------------

export const ROLE_LABEL: Record<string, string> = {
  direct_competitor: 'direct competitor',
  buyer_voice: 'buyer voice',
  format_reference: 'format reference',
  warm_anchor: 'warm anchor',
}

/** A role nobody set is `role not stated`, never a guessed bucket. */
export function rosterRole(p: Proposal): string {
  const raw = p.context?.audn?.roster_role
  if (!raw) return 'role not stated'
  return ROLE_LABEL[raw] ?? raw
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-08-19` → `19 Aug`. An unparseable date comes back as itself: a date
    we cannot read is still what the writer recorded, and dropping it would
    silently shrink the window the evidence line claims. */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  if (!m) return iso.trim()
  const mi = Number(m[2]) - 1
  if (mi < 0 || mi > 11) return iso.trim()
  return `${Number(m[3])} ${MONTHS[mi]}`
}

export function proposalTitle(p: Proposal): string {
  const t = p.context?.audn?.title?.trim()
  if (t) return t
  const first = (p.body ?? '').split('\n').map(s => s.trim()).find(Boolean) ?? ''
  if (!first) return '(untitled proposal)'
  if (first.length <= 80) return first
  const cut = first.slice(0, 80)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trimEnd()}…`
}

/** `3 sources · 19 Aug – 30 Aug · unknowns: no reach figure on two of them`

    The count comes from the cited ids, not from the rows the writer happened
    to attach: those two can differ, and the ids are what the validator checked.
    A missing piece is left OUT of the line rather than rendered as a zero — a
    proposal citing nothing must not read as "0 sources · unknowns: none", it
    must read as the one honest fact it carries. */
export function evidenceLine(p: Proposal): string {
  const ev = p.context?.audn?.evidence ?? null
  const rows = p.context?.source_rows ?? []
  const ids = Array.isArray(ev?.source_ids) ? ev.source_ids.filter(Boolean) : []
  const n = ids.length || rows.length
  const parts: string[] = []
  if (n > 0) parts.push(`${n} source${n === 1 ? '' : 's'}`)

  const dates = (Array.isArray(ev?.source_dates) && ev.source_dates.length
    ? ev.source_dates
    : rows.map(r => r.date ?? ''))
    .filter((d): d is string => typeof d === 'string' && d.trim() !== '')
    .map(d => d.trim())
    .sort()
  if (dates.length === 1) parts.push(shortDate(dates[0]))
  else if (dates.length > 1) {
    const a = shortDate(dates[0])
    const b = shortDate(dates[dates.length - 1])
    parts.push(a === b ? a : `${a} – ${b}`)
  }

  const unknowns = ev?.unknowns?.trim()
  parts.push(`unknowns: ${unknowns || 'not stated'}`)
  return parts.join(' · ')
}

/** The proposal's own age line, from the writer's stamp rather than the row's
    — `proposed_at` is when the model was asked, `created_at` is when the
    insert landed, and the first is the one the reader is judging. */
export function proposedAt(p: Proposal): string | null {
  return p.context?.proposed_at ?? p.created_at ?? null
}

/** The four labelled lines, in the order §2.1 fixes them. A field the writer
    left empty is dropped here rather than rendered as an empty label. */
export const TEXT_FIELDS: Array<{ key: keyof TextOverrides; label: string }> = [
  { key: 'what_changed', label: 'What changed' },
  { key: 'why_it_matters', label: 'Why it matters' },
  { key: 'could_publish', label: 'Could publish' },
  { key: 'proof_needed', label: 'Proof needed' },
]

export function textField(p: Proposal, key: keyof TextOverrides): string {
  if (key === 'title') return proposalTitle(p)
  const a = p.context?.audn ?? {}
  const v = a[key]
  if (typeof v === 'string' && v.trim()) return v.trim()
  // `what_changed` is the one field with a column fallback: the writer copies
  // it into `body`, which is what every other ops surface renders.
  if (key === 'what_changed' && p.body?.trim()) return p.body.trim()
  return ''
}

/** Only what the human actually changed travels to the RPC. Sending an
    unchanged field back would record an override nobody made, and
    `context.published.overrides` is a log of the human's edits. */
export function changedOverrides(p: Proposal, draft: TextOverrides): TextOverrides {
  const out: TextOverrides = {}
  for (const key of OVERRIDABLE) {
    const next = draft[key]
    if (typeof next !== 'string') continue
    if (next.trim() === textField(p, key).trim()) continue
    out[key] = next.trim()
  }
  return out
}

/** The prefilled editor state — every field, as it stands now. */
export function editDraft(p: Proposal): TextOverrides {
  const out: TextOverrides = {}
  for (const key of OVERRIDABLE) out[key] = textField(p, key)
  return out
}


/** The seed marker, for a proposal that REFRESHES an earlier recommendation
    rather than being written from scratch. The run name is what the writer
    records; no date travels with it, so this line names no month — a
    timestamp we cannot read is not one we get to invent. */
export function seedNote(p: Proposal): string | null {
  const s = p.context?.seed
  if (!s) return null
  // The refreshed fields are COLUMN KEYS in the writer's output. They are said
  // in words here: `why_it_matters` on a screen is plumbing showing through,
  // and the reader is being told which part of the line was rewritten, not
  // which key was.
  const fields = (Array.isArray(s.refreshed) ? s.refreshed : [])
    .filter((f): f is string => typeof f === 'string' && f.trim() !== '')
    .map(f => FIELD_WORDS[f] ?? f.replace(/_/g, ' '))
  return fields.length
    ? `carried from an earlier review · refreshed: ${fields.join(', ')}`
    : 'carried from an earlier review'
}

const FIELD_WORDS: Record<string, string> = {
  what_changed: 'what changed',
  why_it_matters: 'why it matters',
  could_publish: 'could publish',
  proof_needed: 'proof needed',
  title: 'title',
}

// ---------------------------------------------------------------------------
// DEV FIXTURE. Referenced only from the dead branch in `fetchProposals`, so a
// production build drops it whole. Nothing here is a claim: the accounts, the
// authors and the numbers are invented, and no real client string appears
// (CONTRACTS §4).
// ---------------------------------------------------------------------------
function devFixture(lane: ContentLane): Proposal[] {
  const one: AudnObject = {
    title: 'Post the placement rule, with the two misses that forced it',
    what_changed:
      'Three of the four accounts we watch stopped naming a client in their proof lines this month, and the '
      + 'two posts that did name one carried the lowest reaction counts either account has had since July.',
    why_it_matters:
      'Your own proof lines still open with a client name. The people who reacted to those posts are the '
      + 'same people who read yours, so the format is being compared whether or not anyone says so.',
    could_publish:
      'A post that walks the placement rule through the two misses it came from, ending on the check you '
      + 'run before a claim ships.',
    proof_needed:
      'The two dates and the reaction counts, taken from the posts themselves. Nothing about revenue.',
    evidence: {
      source_ids: ['cp-3101', 'cp-3144', 'cp-3190'],
      source_dates: ['2026-08-19', '2026-08-24', '2026-08-30'],
      sample_n: 3,
      unknowns: 'no reach figure on two of the three',
    },
    roster_role: 'direct_competitor',
    roster_accounts: ['Northwind Studio', 'Belmar Growth'],
    asset_required: 'A screenshot of the two proof lines side by side',
    asset_state: 'missing',
    pillar: 'positioning',
    format: 'post',
  }
  const two: AudnObject = {
    title: 'Answer the question two buyers asked in the same week',
    what_changed:
      'Two people who react to your posts asked the same thing in public within four days: how long the '
      + 'first month takes before anything is visible.',
    why_it_matters:
      'Both of them sit in the buying seat, and neither got an answer under the post they asked it on.',
    could_publish: 'The real first-month timeline, week by week, with what is not visible in each one.',
    proof_needed: 'The two comments, quoted as written, and the dates they were posted.',
    evidence: {
      source_ids: ['cp-3155', 'cp-3161'],
      source_dates: ['2026-09-02', '2026-09-06'],
      sample_n: 2,
      unknowns: 'neither person states a budget',
    },
    roster_role: 'buyer_voice',
    roster_accounts: ['Dana Whitfield', 'Sam Oyelaran'],
    asset_required: false,
    asset_state: 'none',
    pillar: 'objection',
    format: 'post',
  }
  const rows1: SourceRow[] = [
    { table: 'competitor_posts', id: 'cp-3101', author: 'Northwind Studio', date: '2026-08-19', reactions: 41, comments: 6, shares: 1, url: 'https://example.com/p/3101' },
    { table: 'competitor_posts', id: 'cp-3144', author: 'Belmar Growth', date: '2026-08-24', reactions: 12, comments: 0, shares: 0, url: 'https://example.com/p/3144' },
    { table: 'competitor_posts', id: 'cp-3190', author: 'Northwind Studio', date: '2026-08-30', reactions: 58, comments: 9, shares: 3, url: 'https://example.com/p/3190' },
  ]
  const rows2: SourceRow[] = [
    { table: 'competitor_posts', id: 'cp-3155', author: 'Dana Whitfield', date: '2026-09-02', reactions: 8, comments: 2, shares: 0, url: 'https://example.com/p/3155' },
    { table: 'competitor_posts', id: 'cp-3161', author: 'Sam Oyelaran', date: '2026-09-06', reactions: 15, comments: 4, shares: 0, url: 'https://example.com/p/3161' },
  ]
  const mk = (
    id: string, at: string, audn: AudnObject, rows: SourceRow[],
    seed: ProposalContext['seed'],
  ): Proposal => ({
    id, client_id: lane, kind: PROPOSAL_KIND,
    body: audn.what_changed ?? '',
    created_at: at,
    context: {
      audn, source_rows: rows,
      author_baseline: { median: 34, n: 18, window_days: 90, source: 'monthly median' },
      proposed_at: at, cycle_id: 'fixture:1', prompt: 'audn-recommendation-writer@v1',
      seed, published: null,
    },
  })
  return [
    mk('fixture-1', '2026-09-08T09:00:00Z', one, rows1, null),
    mk('fixture-2', '2026-09-09T06:30:00Z', two, rows2, {
      run: 'audience-learning-03', recommendation_id: 'fixture-seed', refreshed: ['why_it_matters'],
    }),
  ]
}
