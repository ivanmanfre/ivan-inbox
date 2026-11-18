// The desk's preloaded brief: desk_brief_ivan() JSON rendered to compact text,
// plus the handle maps the action layer resolves against. Pure (no I/O), so the
// tests and the trigger replay run it on fixtures.
//
// Handles: every draft gets `#` + the shortest unique uuid prefix (min 5 hex).
// The model never sees or types a uuid; the server only acts on a handle it
// handed out in THIS brief.

export type Draft = {
  id: string; status: string; type: string | null
  scheduled_at: string | null; published_at: string | null
  first_line: string; title: string
  belief: number | null; vehicle: string | null; recipe: string | null; qa_verdict: string | null
  is_copy: boolean; photos: number; brain: boolean; human_edited: boolean
  slot_kind: string | null; selling: boolean; chars: number; created_at: string; fixture: string | null
  updated_at?: string | null  // set only on a live row read (actions.ts loadLive), never from the brief
  queue_ids?: string[]        // the live queue set (pending/queued_v2/posting ids, sorted); live row read only
}
export type QueueRow = { queue_id: string; draft_id: string; slot_at: string; origin: string; first_line: string }
export type CallLine = { id: string; ingested_at: string; status: string; topic: string; said: string; when: string | null; belief: string | null; vehicle: string | null; score: number | null; draft_id: string | null }
export type BriefJson = {
  as_of: string; today: string; this_monday: string
  panel: Record<string, unknown>
  drafts: Draft[]; queue: QueueRow[]
  posts: { posts?: PostRow[]; bar?: number; median?: number; error?: string } | Record<string, unknown>
  calls: { id: string; date: string | null; title: string; call_kind: string | null; booked: string | null; next_when: string | null; next_note: string }[]
  call_lines: CallLine[]
  beliefs: { n: string; belief: string; why: string }[]
  rulings: { note: string; at: string; rule: string }[]
  autopilot: { ran_at: string; week_start: string; mode: string; picked: number; scheduled: number; open_before: number; outcome: string; summary: string }[]
  ideas: { reviewing: number; newest: { id: string; source: string; topic: string; at: string }[] }
  /** published draft id -> the published post URLs linked to it (own_posts.clickup_task_id); null = could not be read */
  post_links?: Record<string, string[]> | null
  /** published post URL -> its labeled vehicle (post labeler) */
  post_vehicles?: Record<string, string>
}
export type PostRow = { url?: string; first_line?: string; posted_at?: string; impressions?: number | null; likes?: number | null; comments?: number | null; worked?: boolean; too_new?: boolean; boosted?: boolean; times_median?: number | null }

export type Rendered = {
  text: string
  drafts: Map<string, Draft>        // handle -> draft
  handleOf: Map<string, string>     // draft id -> handle
  lines: Map<string, CallLine>      // L-handle -> call line
  queueByDraft: Map<string, QueueRow>
  weeks: WeekFill[]
}

export type WeekFill = {
  week_start: string; label: string
  dated: { handle: string; at: string; status: string; copy: boolean; first_line: string }[]
  /** ALL counts come from cp17_calendar_panel_ivan().week_fill: originals = slots, open = 5 - slots */
  originals: number; cap: number; open_count: number; poland: number
  beliefs: Record<string, number>; missing_beliefs: number[]
  open: string[]
  /** copies (extras) and originals with no belief label: the calendar panel's week_fill when present (Sol r8 #7) */
  copies: number; unlabeled: number
  /** the panel's by_vehicle for the week (empty = nothing labeled) (eval E15) */
  vehicles: Record<string, number>
}

const TZ = 'Europe/Warsaw'
/** The weekly target of originals (eval/gold.py: open = 5 - week_fill.slots). */
export const WEEK_TARGET = 5

export function warsaw(iso: string | null | undefined, withTime = true): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
    : { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }
  return new Intl.DateTimeFormat('en-GB', opts).format(d).replace(',', '')
}

/** The Warsaw calendar day (YYYY-MM-DD) of an instant. */
export function warsawDay(iso: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  return p
}

function addDays(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function makeHandles(ids: string[]): Map<string, string> {
  const out = new Map<string, string>()
  const hex = ids.map((id) => id.replace(/-/g, '').toLowerCase())
  for (let i = 0; i < ids.length; i++) {
    let len = 5
    while (len < 32 && hex.some((h, j) => j !== i && h.startsWith(hex[i].slice(0, len)))) len++
    out.set(ids[i], '#' + hex[i].slice(0, len))
  }
  return out
}

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/** Keep only the unfinished drafts Ivan's own Review shows (cb34_p2_safe_drafts read with his session),
 *  and take the brain-member flag from the same view. Scheduled and published rows are never filtered.
 *  `visible` null = the view could not be read; the brief is then used unfiltered. */
export function applyVisibility(b: BriefJson, visible: Map<string, boolean> | null): BriefJson {
  if (!visible) return b
  const unfinished = new Set(['review', 'approved', 'error', 'generating'])
  return {
    ...b,
    drafts: (b.drafts ?? []).filter((d) => !unfinished.has(d.status) || visible.has(d.id) || !!d.fixture)
      .map((d) => (visible.get(d.id) ? { ...d, brain: true } : d)),
  }
}

/**
 * Published drafts the metrics read has not caught up with yet (newest first). A draft counts as
 * measured only when one of its LINKED published URLs (own_posts.clickup_task_id = the draft id) is a
 * row of the metrics list: never by matching text, so two posts with the same opener stay two posts
 * (Sol r5 B7). Without the link map nothing is guessed: no unmeasured rows are added.
 */
export function unmeasured(drafts: Draft[], posts: PostRow[], links: Record<string, string[]> | null | undefined): Draft[] {
  if (!links) return []
  const urls = new Set(posts.map((p) => p.url).filter((u): u is string => !!u))
  return drafts.filter((d) => d.status === 'published' && d.published_at && !(links[d.id] ?? []).some((u) => urls.has(u)))
    .sort((a, z) => String(z.published_at).localeCompare(String(a.published_at)))
}

export function mergedPosts(drafts: Draft[], posts: PostRow[], links: Record<string, string[]> | null | undefined): { at: string; first_line: string; p: PostRow | null; d: Draft | null }[] {
  // the linked draft of a measured post (own_posts / social id link), for its labeled vehicle
  const byUrl = new Map<string, Draft>()
  for (const d of drafts) for (const u of (links ?? {})[d.id] ?? []) byUrl.set(u, d)
  const rows = [
    ...posts.filter((p) => p.posted_at).map((p) => ({ at: String(p.posted_at), first_line: p.first_line ?? '', p, d: (p.url ? byUrl.get(p.url) : undefined) ?? null })),
    ...unmeasured(drafts, posts, links).map((d) => ({ at: String(d.published_at), first_line: d.first_line, p: null as PostRow | null, d })),
  ]
  return rows.sort((a, z) => Date.parse(z.at) - Date.parse(a.at))
}

/** The one way a week's fill is said: "N of 5 originals dated, M open", M = 5 - week_fill.slots (eval/gold.py). */
export function weekCount(w: { originals: number; cap: number }): string {
  return `${w.originals} of ${w.cap} originals dated, ${Math.max(0, w.cap - w.originals)} open`
}

export function render(b: BriefJson, recent: { role: string; origin: string; body: string; created_at: string }[] = [],
  jobs: { title: string; status: string; created_at: string; t3_link: string | null }[] = []): Rendered {
  const drafts = b.drafts ?? []
  const handleOf = makeHandles(drafts.map((d) => d.id))
  const byHandle = new Map<string, Draft>()
  for (const d of drafts) byHandle.set(handleOf.get(d.id)!, d)
  const queueByDraft = new Map<string, QueueRow>()
  for (const q of b.queue ?? []) queueByDraft.set(q.draft_id, q)
  const slots = Array.isArray((b.panel as { slots?: unknown }).slots) ? (b.panel as { slots: { draft_id: string | null; belief: number | null; vehicle: string | null }[] }).slots : []
  const slotOf = new Map<string, { belief: number | null; vehicle: string | null }>()
  for (const s of slots) if (s.draft_id) slotOf.set(s.draft_id, s)
  const beliefOf = (d: Draft) => d.belief ?? slotOf.get(d.id)?.belief ?? null
  const vehicleOf = (d: Draft) => d.vehicle ?? slotOf.get(d.id)?.vehicle ?? null

  const L: string[] = []
  const now = b.as_of
  L.push(`NOW: ${warsaw(now)} Warsaw time (today ${b.today}). This week starts Mon ${b.this_monday}.`)

  // ---- beliefs
  L.push('', 'THE 5 BELIEFS (kept):')
  for (const x of b.beliefs ?? []) L.push(`- Belief ${x.n}: ${x.belief}`)

  // ---- weeks
  const weeks: WeekFill[] = []
  const quotas = Array.isArray((b.panel as { quotas?: unknown }).quotas) ? (b.panel as { quotas: { slot_kind: string; per_week: number | string | null; every_n_weeks: number | null; vehicle: string | null; belief: number | null; note: string }[] }).quotas : []
  const cap = WEEK_TARGET
  const weekFill = Array.isArray((b.panel as { week_fill?: unknown }).week_fill)
    ? (b.panel as { week_fill: { week_start: string; slots?: number; copies?: number; no_belief?: number; by_belief?: Record<string, number>; by_vehicle?: Record<string, number> }[] }).week_fill : []
  for (const [i, label] of [[0, 'THIS WEEK'], [7, 'NEXT WEEK'], [14, 'WEEK AFTER NEXT']] as const) {
    const ws = addDays(b.this_monday, i)
    const we = addDays(ws, 7)
    const dated = drafts.filter((d) => {
      const at = d.status === 'published' ? (d.published_at ?? d.scheduled_at) : d.scheduled_at
      if (!at || !['review', 'approved', 'scheduled', 'published'].includes(d.status)) return false
      const day = warsawDay(at)
      return day >= ws && day < we
    }).map((d) => {
      const at = (d.status === 'published' ? (d.published_at ?? d.scheduled_at) : d.scheduled_at)!
      // a listing only: no count, belief, vehicle or kind is ever derived from it
      return { handle: handleOf.get(d.id)!, at, status: d.status, copy: d.is_copy, first_line: d.first_line }
    }).sort((a, z) => a.at.localeCompare(z.at))
    // ONE source for every number of a week: the calendar panel's week_fill (no draft-list arithmetic);
    // a week the panel does not have counts as 0 dated, exactly as eval/gold.py reads it
    const wf = weekFill.find((x) => x.week_start === ws)
    const beliefs: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
    if (wf?.by_belief && typeof wf.by_belief === 'object') {
      for (const [k, v] of Object.entries(wf.by_belief)) if (k in beliefs && typeof v === 'number') beliefs[k] = v
    }
    const originals = typeof wf?.slots === 'number' ? wf.slots : 0
    const vehicles = wf?.by_vehicle && typeof wf.by_vehicle === 'object' ? wf.by_vehicle as Record<string, number> : {}
    const w: WeekFill = {
      week_start: ws, label, dated, originals, cap, open_count: Math.max(0, cap - originals),
      poland: Number(vehicles.poland_place ?? 0), beliefs,
      missing_beliefs: [1, 2, 3, 4, 5].filter((n) => beliefs[String(n)] === 0), open: [],
      copies: typeof wf?.copies === 'number' ? Math.max(0, wf.copies) : 0,
      unlabeled: typeof wf?.no_belief === 'number' ? Math.max(0, Math.min(originals, wf.no_belief)) : 0,
      vehicles,
    }
    if (w.poland < 1) w.open.push('the Poland-with-him post (quota: 1 a week with him in it, belief 5) has no vehicle label in this week')
    weeks.push(w)
  }
  for (const w of weeks) {
    L.push('', `${w.label} (Mon ${w.week_start} to Sun ${addDays(w.week_start, 6)}): ${weekCount(w)}; ${w.copies} ${w.copies === 1 ? 'copy' : 'copies'} (extras, never counted).`)
    for (const x of w.dated) {
      const q = queueByDraft.get(byHandle.get(x.handle)!.id)
      L.push(`- ${warsaw(x.at)} ${x.handle} [${x.status}${q ? ', queued ' + q.origin : ''}]${x.copy ? ' COPY' : ''}: "${clip(x.first_line, 110)}"`)
    }
    if (!w.dated.length) L.push('- nothing dated')
    const vk = Object.entries(w.vehicles).filter(([, n]) => Number(n) > 0)
    L.push(`  vehicles (calendar labels): ${vk.length ? vk.map(([k, n]) => `${k}=${n}`).join(' ') : 'no vehicle labels yet'}`)
    const unlabeled = w.unlabeled
    L.push(`  belief counts (originals): ${Object.entries(w.beliefs).map(([k, v]) => `B${k}=${v}`).join(' ')}; ` +
      (unlabeled ? `${unlabeled} of ${w.originals} originals have NO belief label. Beliefs not covered by any labeled post: ` : 'missing beliefs: ') +
      (w.missing_beliefs.length ? w.missing_beliefs.map((n) => 'B' + n).join(', ') : 'none') +
      (unlabeled === w.originals && w.originals > 0 ? ' (no post this week has a belief set, so no belief is covered yet)' : ''))
    if (w.open.length) L.push(`  open quota: ${w.open.join('; ')}`)
  }
  L.push('', 'QUOTA RULES (weekly): ' + quotas.map((q) => `${q.slot_kind}${q.per_week != null ? ' ' + Number(q.per_week) + '/wk' : ''}${(q.every_n_weeks ?? 1) > 1 ? ' every ' + q.every_n_weeks + ' wks' : ''}`).join('; ') + '. Max 2 originals per belief per week. Copies are extras, never counted.')
  const enforce = (b.panel as { enforce?: unknown }).enforce
  L.push(`Quota enforcement: ${typeof enforce === 'string' ? enforce : JSON.stringify(enforce ?? 'unknown')}.`)

  // ---- summary: counts precomputed so the model never counts rows itself
  {
    const rv = drafts.filter((d) => d.status === 'review')
    const byStatus: Record<string, number> = {}
    for (const d of drafts) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1
    const posts = ((b.posts as { posts?: PostRow[] }).posts ?? []).filter((p) => p.posted_at)
    const best = posts.filter((p) => !p.boosted).sort((a, z) => (z.impressions ?? 0) - (a.impressions ?? 0))[0]
    const S: string[] = []
    S.push(`Review: ${rv.length} drafts, ${rv.filter((d) => d.recipe === 'cp17').length} of them from the new writer recipe; ${rv.filter((d) => d.scheduled_at).length} dated.`)
    S.push(`(Only if he asks:) Review also has ${rv.filter((d) => d.is_copy).length} copies and ${rv.filter((d) => d.brain).length} brain drafts that take Keep/Drop.`)
    S.push(`All live drafts by status: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', ')}.`)
    // eval E13/E14: the stored form for state answers, the planning form only for planning answers
    for (const w of weeks) S.push(`${w.label.toLowerCase()}: ${weekCount(w)}; ${w.copies} ${w.copies === 1 ? 'copy' : 'copies'} (extras).`)
    // one list, measured posts and published drafts the metrics have not caught yet, newest first;
    // the same call (same inputs) builds RECENT PUBLISHED POSTS below, so its first row is this line (Sol r4 #8)
    const merged = mergedPosts(drafts, (b.posts as { posts?: PostRow[] }).posts ?? [], b.post_links)
    if (merged[0]) S.push(`Last post out: ${warsaw(merged[0].at)} "${clip(merged[0].first_line, 70)}" (${merged[0].p ? `${merged[0].p.impressions ?? '?'} impressions so far` : 'no numbers yet'}).`)
    if (best) S.push(`Best post of the last 31 days by impressions: "${clip(best.first_line, 70)}" ${warsaw(best.posted_at, false)}, ${best.impressions} impressions.`)
    S.push(`Ideas waiting: ${b.ideas?.reviewing ?? 0}. Queue armed (next 21 days): ${(b.queue ?? []).length} posts, ${(b.queue ?? []).filter((x) => x.origin === 'autopilot').length} picked by the autopilot.`)
    L.splice(1, 0, '', 'SUMMARY (exact counts, use these):', ...S.map((x) => '- ' + x))
  }

  // ---- autopilot
  if (b.autopilot?.length) {
    const a = b.autopilot[0]
    L.push('', `AUTOPILOT last run ${warsaw(a.ran_at)} (week ${a.week_start}, ${a.mode}): picked ${a.picked}, scheduled ${a.scheduled}, open before ${a.open_before}, outcome ${a.outcome}. ${clip(a.summary, 300)}`)
  }
  // ---- queue
  if (b.queue?.length) {
    L.push('', 'PUBLISH QUEUE (armed, next 21 days):')
    for (const q of b.queue) L.push(`- ${warsaw(q.slot_at)} ${handleOf.get(q.draft_id) ?? '(not in drafts)'} ${q.origin}: "${clip(q.first_line, 90)}"`)
  }

  // ---- review
  const review = drafts.filter((d) => d.status === 'review' || d.status === 'error' || d.status === 'generating' || d.status === 'approved')
    .slice().sort((a, z) => String(z.created_at).localeCompare(String(a.created_at)))
  L.push('', `DRAFTS NOT YET SCHEDULED OR PUBLISHED (${review.length}), NEWEST FIRST. Format: handle [status] date | draft's own belief tag | draft's own vehicle tag | recipe | flags: first line. These tags are NOT calendar coverage; coverage is only the week blocks above.`)
  for (const d of review) {
    const flags = [d.is_copy && 'copy', d.brain && 'brain(keep/drop)', d.human_edited && 'hand-edited', d.photos ? `${d.photos} photo` : 'no photo'].filter(Boolean).join(',')
    L.push(`- ${handleOf.get(d.id)} [${d.status}${d.qa_verdict ? '/' + d.qa_verdict : ''}] ${d.scheduled_at ? warsaw(d.scheduled_at) : 'undated'} | B${beliefOf(d) ?? '-'} | ${vehicleOf(d) ?? '-'} | ${d.recipe ?? '-'} | ${flags}: "${clip(d.first_line, 120)}"`)
  }

  // ---- posts
  const posts = (b.posts as { posts?: PostRow[] }).posts ?? []
  const bar = (b.posts as { bar?: number }).bar
  // eval E5: the 48h window is precomputed here, at brief build, for every post (the model never computes it)
  const win = (at: string | null | undefined) => {
    const h = at ? Math.max(0, Math.floor((Date.parse(b.as_of) - Date.parse(at)) / 3600e3)) : null
    return h == null || Number.isNaN(h) ? '48h window unknown' : `${h}h since posting, 48h window ${h < 48 ? 'OPEN' : 'CLOSED'}`
  }
  L.push('', `RECENT PUBLISHED POSTS (last 31 days; "worked" = 1.5x his organic median, bar ${bar ?? '?'} impressions; boosted never counts; "early read" = its numbers were read before its 48h mark and may still be low; each row states its own 48h window):`)
  // the lane's quota sits next to the posts it governs (content_plan_quotas via the panel)
  const lane = (d: Draft | null, url?: string) => {
    const v = (url ? b.post_vehicles?.[url] : undefined) ?? (d ? vehicleOf(d) : null)
    const qv = v ? quotas.find((x) => x.vehicle === v && x.per_week != null) : undefined
    return qv && v === 'poland_place' ? `; Poland post (quota: ${Number(qv.per_week)} a week with him in it; copies are extras)` : ''
  }
  for (const m of mergedPosts(drafts, posts, b.post_links)) {
    const p = m.p
    if (!p) { L.push(`- ${warsaw(m.at)} "${clip(m.first_line, 90)}": (no numbers yet; ${win(m.at)})${lane(m.d)}`); continue }
    L.push(`- ${warsaw(p.posted_at)} "${clip(p.first_line, 90)}": ${p.impressions ?? '?'} impressions, ${p.likes ?? 0} likes, ${p.comments ?? 0} comments, ${p.times_median ?? '?'}x median${p.boosted ? ', BOOSTED' : ''}${p.too_new ? ', early read' : p.worked ? ', WORKED' : ''}; ${win(p.posted_at)}${lane(m.d, p.url)}`)
  }
  const pv = Array.isArray((b.panel as { pv48?: unknown }).pv48) ? (b.panel as { pv48: { posted_at: string; first_line: string; contacted_viewers_48h: number | null; contacted_fit_viewers_48h: number | null; baseline_per_48h: number | null; window_open: boolean }[] }).pv48 : []
  if (pv.length) {
    L.push('', 'PROFILE VIEWS FROM CONTACTED PEOPLE within 48h of each post (baseline = normal 48h rate):')
    for (const p of pv) L.push(`- ${warsaw(p.posted_at)} "${clip(p.first_line, 70)}": ${p.contacted_viewers_48h ?? 0} contacted viewers (${p.contacted_fit_viewers_48h ?? 0} fit), baseline ${p.baseline_per_48h != null ? Number(p.baseline_per_48h).toFixed(1) : '?'}, 48h window ${p.window_open ? 'OPEN' : 'CLOSED'}`)
  }

  // (call reviews are not shown: their dates read as call lines; the postable lines below are what matters)
  const lines = new Map<string, CallLine>()
  if (b.call_lines?.length) {
    L.push('', 'POSTABLE LINES FROM CALLS (his own words, from the call extractor; newest call first). "call" = the day he SAID it. Handle L1.. for draft_line actions:')
    b.call_lines.forEach((c, i) => {
      const h = 'L' + (i + 1)
      lines.set(h, c)
      // his words only: the extractor's topic paraphrase is not shown, so nothing about the call gets invented from it
      L.push(`- ${h} call ${c.when ?? 'date unknown'} [${c.status}${c.draft_id ? ', draft exists ' + (handleOf.get(c.draft_id) ?? '') : ''}] B${c.belief ?? '-'} ${c.vehicle ?? ''} | said: "${clip(c.said, 260)}"`)
    })
  }
  const br = Array.isArray((b.panel as { booking_reasons?: unknown }).booking_reasons) ? (b.panel as { booking_reasons: { call_date: string; reason_class: string; quote: string }[] }).booking_reasons : []
  if (br.length) {
    L.push('', 'WHY PEOPLE BOOKED (prospects\' own words on calls, newest first; only for a question about why people book; never Ivan\'s call lines, never a post pick or a reason for one):')
    for (const r of br.slice(0, 8)) L.push(`- ${warsaw(r.call_date, false)} ${r.reason_class}: "${clip(r.quote, 160)}"`)
  }

  // ---- ideas
  if (b.ideas) {
    L.push('', `IDEAS: ${b.ideas.reviewing} waiting in Ideas (reviewing). Newest: ` + (b.ideas.newest ?? []).map((i) => `${i.source}: ${clip(i.topic, 70)}`).join(' | '))
  }

  // ---- rulings
  if (b.rulings?.length) {
    L.push('', "IVAN'S DATED RULINGS ON CONTENT (newest first; follow them):")
    for (const r of b.rulings) L.push(`- ${String(r.at).slice(0, 10)}: ${clip(r.rule, 240)}`)
  }

  // ---- T3 jobs
  if (jobs.length) {
    L.push('', 'CLOUD JOBS (T3):')
    for (const j of jobs) L.push(`- ${warsaw(j.created_at)} "${clip(j.title, 80)}": ${j.status}`)
  }

  // ---- recent desk messages
  if (recent.length) {
    L.push('', 'LAST DESK MESSAGES (oldest first):')
    for (const m of recent) L.push(`- ${m.role === 'user' ? 'Ivan' : m.origin === 'proactive' ? 'Desk (wrote first)' : 'Desk'} ${warsaw(m.created_at)}: ${clip(m.body, 500)}`)
  }

  return { text: L.join('\n'), drafts: byHandle, handleOf, lines, queueByDraft, weeks }
}
