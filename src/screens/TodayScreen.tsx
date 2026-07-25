import { useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { PullIndicator } from '../components/PullIndicator'
import { useConfirm } from '../components/ConfirmSheet'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { useToday, type TodayHealth } from '../hooks/useToday'
import { approveDraft } from '../lib/inbox'
import { acceptRate, laneLabel, type GovernorRow } from '../lib/kpis'
import {
  ago, approvalsTotal, clockTime, countsFromBrief, dayTime, fetchThreadChatId,
  inScope, longDate, nextUp, partitionUrgencies, postsToday,
  type Brief, type BriefCounts, type CommentDraft, type DmDraft, type FeedDraft,
  type Scope, type ScheduledPost, type Urgency,
} from '../lib/today'

// Today = three staged zones (urgent → approve → today's content) plus a
// campaign-health strip. Deliberately absent: any n8n / workflow-error / system
// zone and any scan-report-open row — Ivan cut both from this surface.

const SEV = { live: '#10A37F', slowing: '#FF9F0A', stale: '#FF453A' }

const CHIPS: { key: Scope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ivan', label: 'Ivan' },
  { key: 'risedtc', label: 'Rise' },
]

const SCOPE_NAME: Record<Scope, string> = { all: '', ivan: 'Ivan', risedtc: 'Rise' }

const KIND: Record<string, { label: string; cls: string }> = {
  reply: { label: 'Reply', cls: 'reply' },
  approve: { label: 'Approve + send', cls: 'appr' },
  handraiser: { label: 'Hand raised', cls: 'hand' },
}

function kindOf(k: string) {
  return KIND[k] ?? { label: k.replace(/_/g, ' '), cls: 'reply' }
}

// Zone progress ("2/9 cleared"): the baseline is the highest count seen since
// this zone mounted, so the number is an honest "how many fewer than when you
// opened it" — never a fabricated day total. Zones remount on scope change.
function useProgress(count: number): { label: string; state: 'done' | 'pending' } {
  const base = useRef(count)
  if (count > base.current) base.current = count
  const total = base.current
  if (count === 0) return { label: total === 0 ? 'clear' : `${total}/${total} cleared`, state: 'done' }
  return { label: `${total - count}/${total} cleared`, state: 'pending' }
}

function ZoneHead({ n, title, right, state }: {
  n: string; title: string; right: string; state: 'done' | 'pending' | 'hot'
}) {
  return (
    <div className="td-zh">
      <span className="td-zn">{n}</span>
      <span className="td-zt">{title}</span>
      <span className="td-zrule" />
      <span className={`td-zc ${state}`}>{right}</span>
      <span className={`td-zmark ${state}`}>{state === 'done' ? '✓' : ''}</span>
    </div>
  )
}

// ---- top count strip (sticky) ----

function CountStrip({ c, syncedAt, stale }: {
  c: BriefCounts | null; syncedAt: string | null; stale: boolean
}) {
  const urgent = c?.urgencies_count ?? 0
  const approvals = c ? approvalsTotal(c) : 0
  const posts = c?.posts_today
  return (
    <div className="td-sum">
      {/* Modifier classes are td-* prefixed on purpose: a bare `app`/`on` here
          would collide with the global .app shell rule (column flex, 480px). */}
      <span className={`td-sm td-urg ${urgent > 0 ? 'td-hi' : ''}`}><b>{c ? urgent : '–'}</b> urgent</span>
      <span className="td-sdot">·</span>
      <span className={`td-sm td-apr ${approvals > 0 ? 'td-hi' : ''}`}><b>{c ? approvals : '–'}</b> approvals</span>
      <span className="td-sdot">·</span>
      <span className="td-sm"><b>{posts == null ? '–' : posts}</b> posts</span>
      <span className={`td-sync ${stale ? 'td-old' : ''}`}>
        {syncedAt ? `${stale ? 'Cached' : 'Synced'} ${clockTime(syncedAt)} · ${ago(syncedAt)}` : 'Syncing…'}
      </span>
    </div>
  )
}

// ---- zone 01: urgent ----

function UrgencyRow({ u, auto }: { u: Urgency; auto?: boolean }) {
  const k = auto ? { label: 'Auto-reply', cls: 'auto' } : kindOf(u.kind)
  const org = [u.company, u.title].filter(Boolean).join(' · ')
  const open = u.prospect_id
    ? () => { location.hash = `#thread/${encodeURIComponent(u.prospect_id!)}` }
    : undefined
  return (
    <div className={`td-r ${open ? 'tap' : ''}`} onClick={open}>
      <Avatar name={u.name} channel="linkedin" size={42} />
      <div className="td-mid">
        <div className="td-top">
          <span className="td-nm">{u.name}</span>
          <span className={`td-kind ${k.cls}`}>{k.label}</span>
        </div>
        {u.snippet && <div className="td-snip">{u.snippet}</div>}
        {org && <div className="td-org">{org}</div>}
      </div>
      <div className="td-right"><span className="td-tm">{ago(u.waiting_since)}</span></div>
    </div>
  )
}

function ZoneUrgent({ brief, scope, loading }: {
  brief: Brief | null; scope: Scope; loading: boolean
}) {
  const [showAuto, setShowAuto] = useState(false)
  const scoped = (brief?.urgencies ?? []).filter(u => inScope(u, scope))
  const { visible, autoreplies } = partitionUrgencies(scoped)
  // The fn's autoreply / aging scalars are whole-account numbers, so they only
  // belong to the bucket that owns unscoped rows (client_id NULL = Ivan). Under
  // a client scope we fall back to what the rows themselves say — never borrow
  // an account-wide number and label it Rise's.
  const wholeAccount = scope === 'all' || scope === 'ivan'
  const autoCount = wholeAccount ? brief?.autoreplies_count ?? autoreplies.length : autoreplies.length
  const aging = wholeAccount ? brief?.aging_count ?? 0 : 0
  const prog = useProgress(visible.length)
  const state = visible.length > 0 ? 'hot' : prog.state

  return (
    <section className="td-zone" id="td-z1">
      <ZoneHead n="01" title="Urgent" right={prog.label} state={state} />
      {visible.length === 0 ? (
        <div className="td-empty">
          {loading && !brief
            ? 'Loading the brief…'
            : `0 urgent — nothing needs you${scope === 'all' ? '' : ` on ${SCOPE_NAME[scope]}`}.`}
        </div>
      ) : (
        visible.map(u => <UrgencyRow key={u.id} u={u} />)
      )}
      {autoCount > 0 && (
        <>
          <div className="td-more" onClick={() => setShowAuto(v => !v)}>
            <span className="n">{showAuto ? '−' : '+'}{autoCount}</span>
            <span>auto-replies</span>
            <span className="tail">out of office — not waiting on you</span>
          </div>
          {showAuto && autoreplies.map(u => <UrgencyRow key={u.id} u={u} auto />)}
        </>
      )}
      {aging > 0 && (
        <div className="td-aging">aging out: {aging} — older than 3 days, out of the count</div>
      )}
    </section>
  )
}

// ---- zone 02: approve ----

// Inline approve reuses the EXISTING approve-first write path (approveDraft):
// stamp approved_at, let the dispatcher pick it up. No new write path, no
// change to the gate. Comment/feed drafts stay read-only here — approving them
// needs RLS this app doesn't have.
function DmRow({ d, onApproved }: { d: DmDraft; onApproved: () => void }) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    if (busy || sent) return
    const ok = await confirm({
      title: `Send to ${d.prospect_name}?`,
      message: 'The sender picks it up within about 2 minutes.',
      confirmText: 'Approve & send',
    })
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      const chatId = d.prospect_id ? await fetchThreadChatId(d.prospect_id) : null
      await approveDraft(d.id, d.message_text, chatId)
      setSent(true)
      onApproved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve draft')
    } finally {
      setBusy(false)
    }
  }

  const meta = [d.channel === 'email' ? 'Email' : 'LinkedIn', d.matched_offer, `drafted ${ago(d.created_at)} ago`]
    .filter(Boolean).join(' · ')

  return (
    <div className={`td-dm ${sent ? 'done' : ''}`}>
      <div className="td-dm-h">
        <span className="td-nm">{d.prospect_name}</span>
        <span className="td-tm">{ago(d.created_at)}</span>
      </div>
      <div className="td-dm-b">{d.message_text}</div>
      <div className="td-dm-meta">{meta}</div>
      {error && <div className="td-err">{error}</div>}
      <div className="td-dm-ac">
        {d.prospect_id && (
          <span
            className="btn s"
            onClick={() => { location.hash = `#thread/${encodeURIComponent(d.prospect_id!)}` }}
          >
            Open
          </span>
        )}
        <span className={`btn p ${sent ? 'off' : ''}`} onClick={approve}>
          {sent ? 'Approved' : busy ? 'Approving…' : 'Approve & send'}
        </span>
      </div>
    </div>
  )
}

function QueueRow({ n, title, sub, meta, href }: {
  n: number; title: string; sub?: string | null; meta?: string | null; href?: string | null
}) {
  const body = (
    <>
      <div className="td-qn">{n}</div>
      <div className="td-qmid">
        <div className="td-qt">{title}</div>
        {sub && <div className="td-qs">{sub}</div>}
        {meta && <div className="td-qmeta">{meta}</div>}
      </div>
      {href && <div className="td-chev">›</div>}
    </>
  )
  if (href) {
    return <a className="td-qrow tap" href={href} target="_blank" rel="noreferrer">{body}</a>
  }
  return <div className="td-qrow">{body}</div>
}

function oldest(dates: (string | null | undefined)[]): string | null {
  const list = dates.filter((d): d is string => Boolean(d)).sort()
  return list[0] ?? null
}

function ZoneApprove({ brief, scope, loading, onApproved }: {
  brief: Brief | null; scope: Scope; loading: boolean; onApproved: () => void
}) {
  const dms = (brief?.needs_you.dm_drafts ?? []).filter(d => inScope(d, scope))
  const comments = (brief?.needs_you.comment_drafts ?? []).filter(d => inScope(d, scope))
  const feed = (brief?.needs_you.feed_drafts ?? []).filter(d => inScope(d, scope))
  const total = dms.length + comments.length + feed.length
  const prog = useProgress(total)

  const cOldest = oldest(comments.map(c => c.drafted_at))
  const fNewest = feed.map(f => f.created_at).filter(Boolean).sort().at(-1) ?? null

  return (
    <section className="td-zone" id="td-z2">
      <ZoneHead n="02" title="Approve" right={prog.label} state={total > 0 ? 'pending' : prog.state} />
      {total === 0 ? (
        <div className="td-empty">
          {loading && !brief ? 'Loading the brief…' : 'Nothing waiting on your approval.'}
        </div>
      ) : (
        <>
          {dms.length > 0 && (
            <div className="td-dms">
              <div className="td-sub">DM drafts · approve sends them</div>
              {dms.map(d => <DmRow key={d.id} d={d} onApproved={onApproved} />)}
            </div>
          )}
          {comments.length > 0 && (
            <QueueRow
              n={comments.length}
              title="Comment drafts"
              sub={commentPreview(comments[0])}
              meta={`${comments.length} target${comments.length === 1 ? '' : 's'}${cOldest ? ` · oldest drafted ${ago(cOldest)} ago` : ''} · approve in the comment queue`}
              href={comments[0]?.post_url ?? null}
            />
          )}
          {feed.length > 0 && (
            <QueueRow
              n={feed.length}
              title="Feed drafts"
              sub={feedPreview(feed[0])}
              meta={`${feed.length} pending${fNewest ? ` · newest ${ago(fNewest)} ago` : ''} · approve in the feed lane`}
              href={feed[0]?.post_url ?? null}
            />
          )}
        </>
      )}
    </section>
  )
}

function commentPreview(c: CommentDraft | undefined): string | null {
  if (!c) return null
  const who = c.post_author_name ? `${c.post_author_name} — ` : ''
  const text = c.comment_text ?? c.post_excerpt ?? ''
  return text ? `${who}${text}` : who || null
}

function feedPreview(f: FeedDraft | undefined): string | null {
  if (!f) return null
  const who = f.target_name ? `${f.target_name}${f.target_class ? ` (${f.target_class})` : ''} — ` : ''
  const text = f.draft ?? f.hook ?? ''
  return text ? `${who}${text}` : who || null
}

// ---- zone 03: today's content ----

function postLine(p: ScheduledPost): string {
  return [p.post_format, p.platform, p.status].filter(Boolean).join(' · ')
}

function ZoneToday({ brief, scope, loading }: {
  brief: Brief | null; scope: Scope; loading: boolean
}) {
  const posts = brief ? postsToday(brief, scope) : []
  const next = brief ? nextUp(brief, scope) : null
  // Queue total is an account-wide scalar — same rule as the aging line above.
  const queue = scope === 'risedtc' ? null : brief?.outreach_queue?.total ?? null

  return (
    <section className="td-zone" id="td-z3">
      <ZoneHead
        n="03"
        title="Today"
        right={posts.length === 0 ? 'clear' : `${posts.length} scheduled`}
        state={posts.length === 0 ? 'done' : 'pending'}
      />
      {posts.length === 0 ? (
        <div className="td-card">
          <div className="td-card-t">
            {loading && !brief ? 'Loading the brief…' : 'Nothing scheduled today'}
          </div>
          <div className="td-card-s">
            {loading && !brief
              ? ' '
              : `No posts go out ${scope === 'risedtc' ? 'for Rise ' : ''}today. This zone stays clear until the next slot.`}
          </div>
        </div>
      ) : (
        posts.map(p => (
          <div key={p.id} className="td-post">
            <div className="td-post-t">{p.scheduled_at ? clockTime(p.scheduled_at) : '—'}</div>
            <div className="td-mid">
              <div className="td-post-x">{p.post_text ?? 'Untitled post'}</div>
              <div className="td-org">{postLine(p)}</div>
            </div>
          </div>
        ))
      )}
      {next && (
        <div className="td-next">
          <span className="lbl">NEXT</span>
          <span className="txt">
            <b>{next.scheduled_at ? dayTime(next.scheduled_at) : 'unscheduled'}</b>
            {next.post_format ? ` · ${next.post_format}` : ''}
            {next.post_text ? ` — ${next.post_text}` : ''}
          </span>
        </div>
      )}
      {queue != null && (
        <div className="td-next">
          <span className="lbl">QUEUE</span>
          <span className="txt"><b>{queue}</b> prospects ready to send</span>
        </div>
      )}
    </section>
  )
}

// ---- campaign / inbound health strip ----

function sum<T>(rows: T[], key: keyof T): number {
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0)
}

function govMode(g: GovernorRow | undefined): { label: string; color: string } {
  if (!g) return { label: 'NO DATA', color: '#8E8E93' }
  if (g.mode === 'cold_paused') return { label: 'COLD-PAUSED', color: SEV.stale }
  if (g.mode === 'warm_only') return { label: 'WARM-ONLY', color: SEV.slowing }
  return { label: 'NORMAL', color: SEV.live }
}

function HealthStrip({ health, brief, scope }: {
  health: TodayHealth | null; brief: Brief | null; scope: Scope
}) {
  if (!health) {
    return (
      <section className="td-zone" id="td-z4">
        <ZoneHead n="04" title="Campaign health" right="" state="pending" />
        <div className="td-empty">Loading campaign health…</div>
      </section>
    )
  }

  const accept = health.accept.filter(r => inScope(r, scope))
  const pipeline = health.pipeline.filter(r => inScope(r, scope))
  const governors = health.governor.filter(r => inScope(r, scope))
  const replies = health.replies.filter(r => inScope(r, scope))

  const r7 = acceptRate(sum(accept, 'sent_7d'), sum(accept, 'accepted_7d'))
  const r30 = acceptRate(sum(accept, 'sent_30d'), sum(accept, 'accepted_30d'))
  const trend = r7 - r30
  const trendColor = trend > 0 ? SEV.live : trend < 0 ? SEV.slowing : 'var(--text2)'

  const repliesToday = sum(replies, 'today')
  const repliesWeek = sum(replies, 'week')

  const gUsed = sum(governors, 'used')
  const gCap = sum(governors, 'cap')
  const gLeftDay = sum(governors, 'headroom_day')
  const worst = [...governors].sort((a, b) => Number(b.mode !== 'normal') - Number(a.mode !== 'normal'))[0]
  const mode = govMode(worst)
  const capWindow = worst?.window_label ?? 'week'

  const byLane = new Map<string, { sent7: number; sendable: number }>()
  for (const r of pipeline) {
    const e = byLane.get(r.lane) ?? { sent7: 0, sendable: 0 }
    e.sent7 += r.sent_7d
    e.sendable += r.sendable
    byLane.set(r.lane, e)
  }
  const lanes = [...byLane.entries()].sort((a, b) => b[1].sent7 - a[1].sent7)
  const laneScale = gCap > 0 ? gCap : Math.max(1, ...lanes.map(([, e]) => e.sent7))

  const li = brief?.outreach_health?.linkedin ?? null
  const coldEmail = brief?.outreach_health?.cold_email ?? null
  const hasKpis = accept.length > 0 || pipeline.length > 0 || governors.length > 0

  return (
    <section className="td-zone" id="td-z4">
      <ZoneHead
        n="04"
        title="Campaign health"
        right={scope === 'all' ? 'both seats' : SCOPE_NAME[scope]}
        state="pending"
      />
      {!hasKpis ? (
        <div className="td-empty">No campaign data for this scope.</div>
      ) : (
        <>
          <div className="td-tiles">
            <div className="td-tile">
              <div className="td-tl">Replies</div>
              <div className="td-tb">{repliesToday}<span className="u"> today</span></div>
              <div className="td-ts">{repliesWeek} in 7d</div>
            </div>
            <div className="td-tile">
              <div className="td-tl">Accept</div>
              <div className="td-tb">{r7}<span className="u">%</span></div>
              <div className="td-ts">
                7d · <span style={{ color: trendColor, fontWeight: 700 }}>
                  {trend > 0 ? '▲' : trend < 0 ? '▼' : '±'}{Math.abs(trend)}
                </span> vs 30d ({r30}%)
              </div>
            </div>
            <div className="td-tile">
              <div className="td-tl">Governor</div>
              <div className="td-tb">{gUsed}<span className="u">/{gCap}</span></div>
              <div className="td-ts">
                <span style={{ color: mode.color, fontWeight: 700 }}>{mode.label}</span>
                {' · '}{gLeftDay} left today
              </div>
            </div>
          </div>

          {lanes.length > 0 && (
            <div className="td-lanes">
              <div className="td-sub">
                Sends this 7d vs the {capWindow} cap{gCap > 0 ? ` (${gCap})` : ''}
              </div>
              {lanes.map(([lane, e]) => (
                <div key={lane} className="td-lane">
                  <div className="td-lane-top">
                    <span className="nm">{laneLabel(lane)}</span>
                    <span className="n">{e.sent7}</span>
                    <span className="cap">{e.sendable} sendable</span>
                  </div>
                  <div className="td-bar">
                    <div
                      className="td-bar-f"
                      style={{
                        width: `${Math.min(100, Math.round((e.sent7 / laneScale) * 100))}%`,
                        background: e.sent7 === 0 ? 'var(--surface3)' : SEV.live,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {li && (
        <div className="td-li">
          <div className="td-sub">LinkedIn lane · all seats</div>
          <div className="td-li-grid">
            <Counter n={li.fresh_supply} cap="Fresh supply" />
            <Counter n={li.sends_today} cap="Sent today" warnZero />
            <Counter n={li.accepts_today} cap="Accepts" />
            <Counter n={li.replies_today} cap="Replies" />
            <Counter n={li.needs_reply} cap="Need reply" warn />
            <Counter n={li.stuck} cap="Stuck" bad />
          </div>
          {coldEmail && coldEmail.connected === false && (
            <div className="td-li-note">Cold email: {coldEmail.note ?? 'not connected'}.</div>
          )}
        </div>
      )}
    </section>
  )
}

function Counter({ n, cap, warn, bad, warnZero }: {
  n: number | null | undefined; cap: string; warn?: boolean; bad?: boolean; warnZero?: boolean
}) {
  const v = n ?? null
  const color = v == null ? 'var(--text3)'
    : v === 0 ? (warnZero ? SEV.slowing : 'var(--text3)')
    : bad && v > 0 ? SEV.stale
    : warn && v > 0 ? SEV.slowing
    : 'var(--text)'
  return (
    <div className="td-ct">
      <div className="td-ct-n" style={{ color }}>{v == null ? '—' : v}</div>
      <div className="td-ct-c">{cap}</div>
    </div>
  )
}

// ---- screen ----

export function TodayScreen() {
  const [scope, setScope] = useState<Scope>('ivan')
  const t = useToday()
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, t.refresh)

  // Once the payload lands, every number on this screen comes from it (scoped
  // by the chip) so the strip can't disagree with the zones. Before that, the
  // fast counts call carries the strip.
  const counts = t.brief ? countsFromBrief(t.brief, scope) : t.counts
  const syncedAt = t.brief?.generated_at ?? t.counts?.generated_at ?? t.cachedAt ?? null
  const stale = t.fromCache || t.degraded || (t.error != null && t.brief != null)

  return (
    <>
      <div className="nav">
        <div className="row-top">
          <div>
            <h2>Today</h2>
            <div className="td-date">{longDate()}</div>
          </div>
          <div className="sc-refresh" onClick={() => { t.refresh() }} title="Refresh">↻</div>
        </div>
        <div className="chips">
          {CHIPS.map(c => (
            <span
              key={c.key}
              className={`chip ${scope === c.key ? 'on' : ''}`}
              onClick={() => setScope(c.key)}
            >
              {c.label}
            </span>
          ))}
        </div>
      </div>

      <div className="rows td-rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        <CountStrip c={counts} syncedAt={syncedAt} stale={stale} />

        {t.authError && (
          <div className="td-banner">
            Signed out — showing the last brief saved on this device. Sign in again from Settings.
          </div>
        )}
        {!t.authError && t.degraded && (
          <div className="td-banner">
            Counts only — this session isn’t authorised for the full brief. Sign in again to see the rows.
          </div>
        )}
        {!t.authError && !t.degraded && t.error && t.brief && (
          <div className="td-banner">Couldn’t refresh — showing the last brief on this device.</div>
        )}
        {t.error && !t.brief && !t.refreshing && (
          <div className="empty">{t.error}</div>
        )}

        <div className="td-zones" key={scope}>
          <ZoneUrgent brief={t.brief} scope={scope} loading={t.loading || t.refreshing} />
          <ZoneApprove
            brief={t.brief}
            scope={scope}
            loading={t.loading || t.refreshing}
            onApproved={() => { t.refresh() }}
          />
          <ZoneToday brief={t.brief} scope={scope} loading={t.loading || t.refreshing} />
          <HealthStrip health={t.health} brief={t.brief} scope={scope} />
        </div>

        {scope === 'risedtc' && t.brief && (
          <div className="td-foot">
            The morning brief doesn’t carry client scope yet — unscoped rows read as Ivan’s
            (client_id NULL = Ivan). Campaign health above is genuinely Rise-scoped.
          </div>
        )}
      </div>
    </>
  )
}
