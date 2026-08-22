import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { PullIndicator } from '../components/PullIndicator'
import { SystemAlertStrip } from '../components/SystemAlertStrip'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { useToday, type TodayHealth } from '../hooks/useToday'
import { label } from '../lib/labels'
import { acceptRate, laneLabel, type GovernorRow } from '../lib/kpis'
import type { Thread } from '../lib/inbox'
import type { OpsDraft } from '../lib/ops'
import {
  ago, ageTag, cleanSnippet, clockTime, countsFromBrief, dayTime,
  longDate, nextUp, todayLoad, todayPlate,
  type Brief, type BriefCounts, type CommentDraft, type DmDraft, type FeedDraft,
  type ScheduledPost, type TodayPlate, type Urgency,
} from '../lib/today'
import {
  buildOpsItems, buildReplyItems, fetchContentErrorPile, fetchContentReviewPile,
  fetchStagedIdeaPile, pileItems, rankQueue, type QueueItem,
} from '../lib/workQueue'
import {
  describeWhen, fetchUpcomingEvents, isStartingSoon, resolveMeetingType,
  MEETING_TYPE_LABEL, type CalendarEvent,
} from '../lib/nextCall'
import {
  LEAD_LABEL, SEGMENT_LABEL, actionItems, callStats, callTitle, fetchCalls, leadLine,
  owedByMe, people, segmentCalls,
  type CallRow, type CallSegment, type CallStats,
} from '../lib/transcripts'

// Today = three staged zones (urgent → approve → today's content) plus a
// campaign-health strip. Deliberately absent: any n8n / workflow-error / system
// zone and any scan-report-open row — Ivan cut both from this surface.

const SEV = { live: '#10A37F', slowing: '#FF9F0A', stale: '#FF453A' }

const KIND: Record<string, { label: string; cls: string }> = {
  reply: { label: 'Reply', cls: 'reply' },
  approve: { label: 'Approve + send', cls: 'appr' },
  handraiser: { label: 'Hand raised', cls: 'hand' },
}

function kindOf(k: string) {
  return KIND[k] ?? { label: label(k), cls: 'reply' }
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

// ---- masthead ----

// One primary number at the app's real top of scale (34px — the large-title size
// styles.css already uses; the 40px gate that would have forced more was withdrawn
// in CALIBRATION.md for contradicting this scale). It is the SUM of the three zone
// loads and nothing else, and the segments beneath it are a stacked bar of those
// same three counts, so the headline and the breakdown cannot disagree.
function Masthead({ c, plate, syncedAt, stale }: {
  c: BriefCounts | null; plate: TodayPlate | null; syncedAt: string | null; stale: boolean
}) {
  const load = todayLoad(c)
  const segs = [
    { k: 'urgent', n: load.urgent, c: SEV.stale, l: 'urgent' },
    { k: 'approvals', n: load.approvals, c: SEV.live, l: 'to approve' },
    { k: 'going', n: load.going, c: '#0A84FF', l: 'going out' },
  ]
  const denom = Math.max(1, load.total)
  return (
    <div className="td-mast">
      <div className="td-mast-l">
        {/* '–' until the payload lands: a zero we have not verified is a lie, and
            this screen's whole job is telling the truth about a cached read. */}
        <div className="td-big">{c ? load.total : '–'}</div>
        <div className="td-big-c">
          {!c ? 'still loading' : load.total === 1 ? 'thing on your plate' : 'things on your plate'}
        </div>
      </div>
      <div className="td-mast-r">
        <div className="td-stack">
          {segs.map(s => (
            <span
              key={s.k}
              className="td-stack-s"
              style={{ width: `${(s.n / denom) * 100}%`, background: s.c }}
              title={`${s.n} ${s.l}`}
            />
          ))}
          {load.total === 0 && <span className="td-stack-s clear" style={{ width: '100%' }} />}
        </div>
        <div className="td-legend">
          {segs.map(s => (
            <span key={s.k} className={`td-lg ${s.n === 0 ? 'off' : ''}`}>
              <span className="td-lg-d" style={{ background: s.c }} />
              <b>{c ? s.n : '–'}</b> {s.l}
            </span>
          ))}
        </div>
        {/* The split Ivan actually asked about. The total above is unchanged —
            this says how much of it is TODAY'S. */}
        {c && plate && (
          <div className="td-split">
            <b>{plate.newCount}</b> new today
            <span className="td-split-sep">·</span>
            <b>{plate.carriedCount}</b> carried over
            {plate.oldest && <span className="td-split-o">oldest {plate.oldest}</span>}
          </div>
        )}
        <span className={`td-sync ${stale ? 'td-old' : ''}`}>
          {syncedAt ? `${stale ? 'Cached' : 'Synced'} ${clockTime(syncedAt)} · ${ago(syncedAt)}` : 'Syncing…'}
        </span>
      </div>
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
      {/* D22: no explicit size — the workbench grid track (.wb .av, 28px,
          faithful.css) sizes this; a hardcoded 42 used to win over it and
          spill into the text column. */}
      <Avatar name={u.name} channel="linkedin" />
      <div className="td-mid">
        <div className="td-top">
          <span className="td-nm">{u.name}</span>
          <span className={`td-kind ${k.cls}`}>{k.label}</span>
        </div>
        {/* D23/D24: cleanSnippet strips the classifier's bracket tag and
            decodes HTML entities so this reads as prose, not wire text. */}
        {u.snippet && <div className="td-snip">{cleanSnippet(u.snippet)}</div>}
        {org && <div className="td-org">{org}</div>}
      </div>
      <div className="td-right"><span className="td-tm">{ago(u.waiting_since)}</span></div>
    </div>
  )
}

function ZoneNew({ plate, loading, brief, onOpenDrafts, onOpenOps }: {
  plate: TodayPlate; loading: boolean; brief: Brief | null
  onOpenDrafts: () => void; onOpenOps: () => void
}) {
  const n = plate.newCount
  return (
    <section className="td-zone" id="td-z1">
      <ZoneHead
        n="01"
        title="New today"
        right={n === 0 ? 'nothing new' : `${n} since yesterday`}
        state={n > 0 ? 'hot' : 'done'}
      />
      {n === 0 ? (
        <div className="td-empty">
          {loading && !brief
            ? 'Loading the brief…'
            : 'Nothing new since yesterday. Everything on your plate is carried over — and this is a live read, not a stall.'}
        </div>
      ) : (
        <>
          {plate.urgencies.fresh.map(u => <UrgencyRow key={u.id} u={u} />)}
          <ApprovalRows
            dms={plate.dms.fresh} comments={plate.comments.fresh} feed={plate.feed.fresh}
            onOpenDrafts={onOpenDrafts} onOpenOps={onOpenOps}
          />
          {plate.posts.map(p => (
            <div key={p.id} className="td-post">
              <div className="td-post-t">{p.scheduled_at ? clockTime(p.scheduled_at) : '—'}</div>
              <div className="td-mid">
                <div className="td-post-x">{p.post_text ?? 'Untitled post'}</div>
                <div className="td-org">{postLine(p)}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

// ---- the counted hand-off ----
//
// SINGLE OWNERSHIP. One pending item has one owning surface; every other
// appearance of it is a count, a preview and a way in — never a second mutating
// affordance. This screen used to carry an inline "Approve & send" on DM drafts,
// and the row it acted on came from `brief.needs_you.dm_drafts`, i.e. the CACHED
// morning brief, which is ~12s stale on a cold open and arbitrarily stale after a
// failed refresh. That is the U1 replay landmine with a friendly button on it: the
// dispatcher's real predicate is `approved_at NOT NULL AND sent_at IS NULL`, so a
// stale approve here sent a message Ivan had already discarded in the Drafts queue.
//
// The DB guard added to approveDraft (send_blocked_reason IS NULL) is the belt;
// this is the braces. Approving DMs now happens only where the rows are live.
function HandOff({ n, title, sub, meta, owner, href, onOpen, age }: {
  n: number
  title: string
  sub?: string | null
  meta?: string | null
  // Where this pending item actually lives. An aggregating surface that shows you
  // something it cannot act on has to say where the action is, inline, or it reads
  // as a broken button that someone forgot to draw.
  owner: string
  href?: string | null
  onOpen?: () => void
  // The group's oldest item, printed ON the row. The age used to live only inside
  // the meta sentence, which is where "16d ago" goes to not be read.
  age?: string | null
}) {
  const body = (
    <>
      <div className="td-qn">{n}</div>
      <div className="td-qmid">
        <div className="td-qt">
          {title}
          {age && <span className="td-qage">{age}</span>}
        </div>
        {sub && <div className="td-qs">{sub}</div>}
        {meta && <div className="td-qmeta">{meta}</div>}
        <div className="td-qown">{owner}</div>
      </div>
      <div className="td-chev">›</div>
    </>
  )
  if (onOpen) {
    return <div className="td-qrow tap" onClick={onOpen}>{body}</div>
  }
  if (href) {
    return <a className="td-qrow tap" href={href} target="_blank" rel="noreferrer">{body}</a>
  }
  return <div className="td-qrow">{body}</div>
}

// ---- zone 00: the work queue ----
//
// Measured: 552 rows across content drafts, client ideas, ops drafts and DMs
// are waiting on a human decision, and 449 of them cannot appear on Today at
// all. The edge function behind every zone above carries no content drafts,
// no ideas and no ops rows, and lane scoping means no other screen has ever
// shown two lanes' backlogs at once. This zone is the answer: one ranked list
// that crosses every lane, built from data the app already fetches at the
// Shell level (`threads`, `opsDrafts`, zero new cost) plus two small
// read-only aggregate queries for the two piles nothing else surfaces
// (content review/error, staged client ideas, see lib/workQueue.ts).
//
// RANKING RULE (defended in full in lib/workQueue.ts): severity tier first,
// oldest-first inside a tier. A person waiting always outranks a draft
// waiting, and a reply nobody has even opened (tier 0) always outranks one
// that was at least read (tier 1). 36 of the 58 unanswered threads were
// never opened in this app at all, which is the sharpest neglect in the
// whole set, sharper than any age number on its own.
//
// THE ACTION IS THE CLICK. A reply row opens the exact thread (openId is the
// prospect_id), the same navigation Item 5 already treats as the real
// action surface for a DM, since sending still has to happen after a human
// reads the thread. An ops row opens the Ops job (no per-row focus exists
// from outside it, and OpsBoard belongs to another item in this run). A
// content/idea pile row opens Content PRE-FILTERED TO ITS LANE. Shell owns
// the lane state Content reads, so this hands off at the lane boundary
// without touching ContentList.tsx, content.ts or BulkBar.tsx, none of which
// are this item's files to change.
function QueueReplyRow({ item, onOpen }: { item: QueueItem; onOpen: () => void }) {
  return (
    <div className="td-r tap" onClick={onOpen}>
      <Avatar name={item.title} channel="linkedin" />
      <div className="td-mid">
        <div className="td-top">
          <span className="td-nm">{item.title}</span>
          {/* The one thing on this screen that has to be impossible to miss:
              a real person wrote in and this app has never once been opened
              to their message. Styled off the same SEV.stale red every other
              severity marker on this screen already uses, no new color
              vocabulary, just the loudest existing one. */}
          {item.tier === 0 && (
            <span className="td-kind" style={{ color: SEV.stale, fontWeight: 800 }}>
              ● never opened
            </span>
          )}
          {item.lane !== 'ivan' && (
            <span className="td-kind">{item.lane === 'risedtc' ? 'RISE' : 'ARCH'}</span>
          )}
        </div>
        {item.sub && <div className="td-snip">{item.sub}</div>}
      </div>
      <div className="td-right"><span className="td-tm">{ago(item.waitingSince)}</span></div>
    </div>
  )
}

function QueuePileRow({ item, onOpen }: { item: QueueItem; onOpen: () => void }) {
  const owner = item.kind === 'ops'
    ? 'approved (or discarded) in Ops'
    : item.kind === 'ideas'
      ? 'reviewed in Content, Ideas tab'
      : 'promoted or skipped in Content'
  return (
    <HandOff
      n={item.n ?? 1}
      title={item.title}
      sub={item.sub}
      owner={owner}
      age={`${Math.round(item.ageDays)}d`}
      onOpen={onOpen}
    />
  )
}

function ZoneQueue({ items, onOpenThread, onOpenOps, onOpenContent }: {
  items: QueueItem[]
  onOpenThread: (id: string) => void
  onOpenOps: () => void
  onOpenContent: (lane: string) => void
}) {
  const neverOpened = items.filter(i => i.tier === 0).length
  return (
    <section className="td-zone" id="td-z0">
      <ZoneHead
        n="A"
        title="Work queue"
        right={items.length === 0 ? 'clear' : `${items.length} across every lane`}
        state={items.length === 0 ? 'done' : 'hot'}
      />
      {neverOpened > 0 && (
        <div className="td-empty" style={{ color: SEV.stale, fontWeight: 700 }}>
          {neverOpened} {neverOpened === 1 ? 'person' : 'people'} wrote and {neverOpened === 1 ? 'was' : 'were'} never opened here.
        </div>
      )}
      {items.length === 0 ? (
        <div className="td-empty">Nothing crossing every lane is waiting on you right now.</div>
      ) : (
        items.map(item => item.kind === 'reply'
          ? <QueueReplyRow key={item.id} item={item} onOpen={() => onOpenThread(item.openId!)} />
          : (
            <QueuePileRow
              key={item.id}
              item={item}
              onOpen={item.kind === 'ops' ? onOpenOps : () => onOpenContent(item.openId!)}
            />
          ))
      )}
    </section>
  )
}

// ---- zone 01: next call ----
//
// Dashboard port #1 (dashboard-port-audit.md): this inbox has never once
// read `calendar_events`, so it cannot answer "do I have a call today", the
// exact question the URL Ivan sent (`?section=today&sub=meetings`) was
// pointing at. Ported from personal-site (read-only reference), with its two
// known bugs deliberately not carried across, see lib/nextCall.ts for both.
//
// Reuses the SAME `.td-next`/`.lbl`/`.txt` primitive Zone 03 "Schedule"
// already uses for its NEXT/QUEUE lines below, so this needs no new CSS.
// Numbered B, not 05: the four original zones (01-04) keep their original
// numbers unconditionally, because they render in #exp/stock too and a
// renumber would be a pixel change to a shell this run must leave untouched.
// A/B are this run's own new zones and sit outside that sequence on purpose.
function ZoneNextCall({ events, loading, archive }: {
  events: CalendarEvent[]; loading: boolean; archive: CallStats | null
}) {
  const next = events[0] ?? null
  const rest = Math.max(0, events.length - 1)

  if (loading) {
    return (
      <section className="td-zone" id="td-z-call">
        <ZoneHead n="B" title="Next call" right="" state="pending" />
        <div className="td-empty">Loading the calendar…</div>
      </section>
    )
  }

  if (!next) {
    return (
      <section className="td-zone" id="td-z-call">
        <ZoneHead n="B" title="Next call" right="none this week" state="done" />
        {/* The empty case is the COMMON case here: his calendar was clear for
            seven days on the day this was measured, and it is clear most
            weeks. So it does not get a placeholder, it gets the true second
            half of the answer. There are no calls ahead and there is a large
            archive behind, and the archive is now one tap away directly
            underneath, which is the only reason this state is worth reading
            at all. The count is stated only once it has actually been read;
            an unverified zero would be a lie on a screen whose whole job is
            not telling one. */}
        <div className="td-card">
          <div className="td-card-t">No calls booked in the next seven days</div>
          <div className="td-card-s">
            {archive === null
              ? 'A booking shows up here the moment it lands.'
              : archive.withActions > 0
                ? `A booking shows up here the moment it lands. ${archive.total} earlier calls are `
                  + `on record below, and ${archive.withActions} of them still carry something `
                  + 'that was agreed.'
                : `A booking shows up here the moment it lands. ${archive.total} earlier calls are `
                  + 'on record below.'}
          </div>
        </div>
      </section>
    )
  }

  const w = describeWhen(next)
  const soon = isStartingSoon(w)
  const type = resolveMeetingType(next)

  return (
    <section className="td-zone" id="td-z-call">
      <ZoneHead n="B" title="Next call" right={`${w.day} ${w.time}`} state={soon ? 'hot' : 'pending'} />
      <div className="td-next">
        <span className="lbl">{w.day.toUpperCase()}</span>
        <span className="txt">
          <b>{w.time}{w.endTime ? ` to ${w.endTime}` : ''}</b> {next.title}
          {soon && (
            <span className="td-kind" style={{ marginLeft: 8, color: SEV.slowing, fontWeight: 800 }}>
              starting soon
            </span>
          )}
        </span>
      </div>
      {next.attendees.length > 0 && (
        <div className="td-next">
          <span className="lbl">WITH</span>
          <span className="txt">{next.attendees.join(', ')}</span>
        </div>
      )}
      {type && (
        <div className="td-next">
          <span className="lbl">TYPE</span>
          <span className="txt">{MEETING_TYPE_LABEL[type]}</span>
        </div>
      )}
      {/* Free value the old dashboard's own UI never read (dashboard-port-audit.md
          §2): Calendly stamps `source` on every booking and nothing renders it.
          One field, already selected, cheap enough to include, so it is. */}
      {next.source && (
        <div className="td-next">
          <span className="lbl">SOURCE</span>
          <span className="txt">via {next.source}</span>
        </div>
      )}
      {next.meeting_url && (
        <div className="td-next">
          <span className="lbl">JOIN</span>
          <span className="txt"><a href={next.meeting_url} target="_blank" rel="noreferrer">{next.meeting_url}</a></span>
        </div>
      )}
      {rest > 0 && (
        <div className="td-next">
          <span className="lbl">THIS WEEK</span>
          <span className="txt">{rest} more call{rest === 1 ? '' : 's'}</span>
        </div>
      )}
    </section>
  )
}

// ---- zone 01: the calls on record ----
//
// Dashboard port #2 (dashboard-port-audit.md), the door half. 96 calls are
// transcribed and none of them was reachable from this app. The audit's own
// cheapest home for the list of calls that are NOT the next one is "a section
// inside the Calls area on Today", and this is it: it sits directly under the
// next-call card, which is what makes that card's empty state useful instead
// of merely honest.
//
// THE ORDER IS THE FEATURE. 96 rows sorted by date buries the 12 that still
// carry unfinished business, and those 12 are the only rows with anything left
// to do in them. So the default segment is the one that holds them, and the
// ranking inside every segment puts them first (lib/transcripts.ts, rankCalls).
//
// No new CSS on this screen: the rows are the `.td-qrow` / `.td-qmid` /
// `.td-qt` / `.td-qs` / `.td-qmeta` / `.td-chev` primitive the work queue above
// already uses, the count chip is the neutral `.td-qage` rather than the
// accent-painted `.td-qn` (an accent-weighted count here would spend a budget
// this screen has no primary action to spend), and the segment control is three
// `.wbb` controls.
const CALL_PAGE = 6

function CallRowLine({ row, onOpen }: { row: CallRow; onOpen: () => void }) {
  const n = actionItems(row).length
  const mine = owedByMe(row)
  const lead = leadLine(row)
  const who = people(row.participants)
  const when = new Date(row.date)
  const day = Number.isNaN(when.getTime())
    ? 'date not recorded'
    : when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const meta = [
    day,
    row.duration_minutes ? `${row.duration_minutes}m` : null,
    who.length > 0 ? who.slice(0, 3).join(', ') : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className="td-qrow tap" onClick={onOpen}>
      <div className="td-qmid">
        <div className="td-qt">
          <span className="td-nm">{callTitle(row.title)}</span>
          {n > 0 && (
            <span className="td-qage">
              {mine > 0 ? `${mine} yours` : `${n} open`}
            </span>
          )}
        </div>
        {lead && <div className="td-qs">{LEAD_LABEL[lead.kind]}: {lead.text}</div>}
        <div className="td-qmeta">{meta}</div>
      </div>
      <span className="td-chev">›</span>
    </div>
  )
}

function ZoneCallLog({ rows, loading, onOpen }: {
  rows: CallRow[]
  loading: boolean
  onOpen: (id: string, queue: CallRow[]) => void
}) {
  const stats = callStats(rows)
  // The default lands on unfinished business when there is any, and degrades
  // to the recent week when there is not. It is never "all" on arrival: a list
  // of 96 sorted by date is exactly the state this section exists to replace.
  const [seg, setSeg] = useState<CallSegment | null>(null)
  const [full, setFull] = useState(false)
  const active: CallSegment = seg ?? (stats.withActions > 0 ? 'open' : 'recent')
  const queue = segmentCalls(rows, active)
  const shown = full ? queue : queue.slice(0, CALL_PAGE)
  const hidden = queue.length - shown.length

  if (loading && rows.length === 0) {
    return (
      <section className="td-zone" id="td-z-calls">
        <ZoneHead n="B" title="Calls on record" right="" state="pending" />
        <div className="td-empty">Reading the call archive…</div>
      </section>
    )
  }

  if (rows.length === 0) {
    return (
      <section className="td-zone" id="td-z-calls">
        <ZoneHead n="B" title="Calls on record" right="none yet" state="done" />
        <div className="td-empty">
          No calls have been transcribed yet. One appears here after the first recording is
          written up.
        </div>
      </section>
    )
  }

  const counts: Record<CallSegment, number> = {
    open: stats.withActions,
    recent: stats.week,
    all: stats.total,
  }

  return (
    <section className="td-zone" id="td-z-calls">
      <ZoneHead
        n="B"
        title="Calls on record"
        right={`${stats.total} kept · ${stats.meanMinutes}m average`}
        state={stats.withActions > 0 ? 'pending' : 'done'}
      />
      <div className="cw-segs">
        {(['open', 'recent', 'all'] as CallSegment[]).map(s => (
          <button
            key={s}
            type="button"
            className={`wbb wbb-sm ${s === active ? 'wbb-secondary' : 'wbb-quiet'}`}
            aria-pressed={s === active}
            onClick={() => { setSeg(s); setFull(false) }}
          >
            {SEGMENT_LABEL[s]} {counts[s]}
          </button>
        ))}
      </div>
      {queue.length === 0 ? (
        <div className="td-empty">
          {active === 'open'
            ? 'Nothing was left open on any call. Every action item on record has an owner and a call behind it.'
            : 'No calls in the last seven days.'}
        </div>
      ) : (
        <>
          {shown.map(r => (
            <CallRowLine key={r.id} row={r} onOpen={() => onOpen(r.id, queue)} />
          ))}
          {hidden > 0 && (
            <div className="td-more" onClick={() => setFull(true)}>
              <span className="n">{hidden}</span>
              <span>more in this list</span>
              <span className="tail">show them</span>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function dmPreview(d: DmDraft | undefined): string | null {
  if (!d) return null
  return `${d.prospect_name} — ${d.message_text}`
}

function oldest(dates: (string | null | undefined)[]): string | null {
  const list = dates.filter((d): d is string => Boolean(d)).sort()
  return list[0] ?? null
}

// ---- zone 02: carried over ----
//
// The honest name for what this screen was already showing under the word TODAY.
// Nothing here is hidden or dropped — it is the same rows, grouped, with their
// age printed on them, BELOW the work that actually arrived today.
function ZoneCarried({ plate, aging, loading, brief, onOpenDrafts, onOpenOps }: {
  plate: TodayPlate; aging: number; loading: boolean; brief: Brief | null
  onOpenDrafts: () => void; onOpenOps: () => void
}) {
  const [showAuto, setShowAuto] = useState(false)
  const n = plate.carriedCount
  const autoCount = plate.autoreplies.length
  if (n === 0 && autoCount === 0 && aging === 0) {
    return (
      <section className="td-zone" id="td-z2">
        <ZoneHead n="02" title="Carried over" right="clear" state="done" />
        <div className="td-empty">
          {loading && !brief ? 'Loading the brief…' : 'Nothing carried over — the plate is today\u2019s only.'}
        </div>
      </section>
    )
  }
  return (
    <section className="td-zone" id="td-z2">
      <ZoneHead
        n="02"
        title="Carried over"
        // Short on purpose: the zone title already says CARRIED OVER, and the
        // long form clipped at 390 ("... OLDEST 35" with the d cut off).
        right={n === 0 ? 'clear' : `${n}${plate.oldest ? ` · oldest ${plate.oldest}` : ''}`}
        state={n === 0 ? 'done' : 'pending'}
      />
      {plate.urgencies.carried.map(u => <UrgencyRow key={u.id} u={u} />)}
      <ApprovalRows
        dms={plate.dms.carried} comments={plate.comments.carried} feed={plate.feed.carried}
        onOpenDrafts={onOpenDrafts} onOpenOps={onOpenOps}
      />
      {/* The reply detector demotes replies older than 3 days out of the urgency
          array entirely — the payload carries only a scalar, so there are no rows
          to render here. That used to print as "out of the count", which reads as
          a confession. It is a HAND-OFF: since DMs absorbed the conversation list
          those people are one tap away, listed and countable. */}
      {aging > 0 && (
        <HandOff
          n={aging}
          title={`${aging} older ${aging === 1 ? 'reply' : 'replies'}`}
          sub="Demoted out of the urgent count after 3 days — still owed."
          meta="not in the plate number above"
          owner="open them in DMs"
          onOpen={onOpenDrafts}
        />
      )}
      {autoCount > 0 && (
        <>
          <div className="td-more" onClick={() => setShowAuto(v => !v)}>
            <span className="n">{showAuto ? '−' : '+'}{autoCount}</span>
            <span>auto-replies</span>
            <span className="tail">out of office — not waiting on you</span>
          </div>
          {showAuto && plate.autoreplies.map(u => <UrgencyRow key={u.id} u={u} auto />)}
        </>
      )}
    </section>
  )
}

// The three approval groups, rendered for ONE age band. Same HandOff contract as
// before (single ownership: a count, a preview and a way in — never a second
// mutating affordance), now with the group's oldest age on the row itself.
function ApprovalRows({ dms, comments, feed, onOpenDrafts, onOpenOps }: {
  dms: DmDraft[]; comments: CommentDraft[]; feed: FeedDraft[]
  onOpenDrafts: () => void; onOpenOps: () => void
}) {
  const dOldest = oldest(dms.map(d => d.created_at))
  const cOldest = oldest(comments.map(c => c.drafted_at))
  const fOldest = oldest(feed.map(f => f.created_at))
  const dAging = dms.filter(d => d.is_aging).length
  const cAging = comments.filter(c => c.is_aging).length
  return (
    <>
      {dms.length > 0 && (
        <HandOff
          n={dms.length}
          title={dms.length === 1 ? 'DM draft' : 'DM drafts'}
          age={ageTag(dOldest)}
          sub={dmPreview(dms[0])}
          meta={`${dms.length} waiting${dOldest ? ` · oldest drafted ${ago(dOldest)} ago` : ''}${dAging > 0 ? ` · ${dAging} owed >7d` : ''}`}
          owner="live rows and Approve & send are in the DM queue — this list is the cached brief"
          onOpen={onOpenDrafts}
        />
      )}
      {comments.length > 0 && (
        <HandOff
          n={comments.length}
          title="Comment drafts"
          age={ageTag(cOldest)}
          sub={commentPreview(comments[0])}
          meta={`${comments.length} target${comments.length === 1 ? '' : 's'}${cOldest ? ` · oldest drafted ${ago(cOldest)} ago` : ''}${cAging > 0 ? ` · ${cAging} owed >7d` : ''}`}
          owner="posting is live on LinkedIn — approved in Ops"
          onOpen={onOpenOps}
        />
      )}
      {feed.length > 0 && (
        <HandOff
          n={feed.length}
          title="Feed drafts"
          age={ageTag(fOldest)}
          sub={feedPreview(feed[0])}
          meta={`${feed.length} pending${fOldest ? ` · oldest ${ago(fOldest)} ago` : ''}`}
          owner="approved in the feed lane, not here"
          onOpen={onOpenOps}
        />
      )}
    </>
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

// ---- zone 03: the schedule ----

function postLine(p: ScheduledPost): string {
  return [p.post_format, p.platform, p.status].filter(Boolean).join(' · ')
}

// Today's posts moved UP into "New today" (a post going out today is today's by
// definition), so this zone is what is COMING: the next slot, the send queue,
// and — new — any slot that was called off, which used to be silently counted as
// a thing going out.
function ZoneSchedule({ brief, loading, plate }: {
  brief: Brief | null; loading: boolean; plate: TodayPlate
}) {
  const posts = plate.posts
  const next = brief ? nextUp(brief, 'all') : null
  const queue = brief?.outreach_queue?.total ?? null

  return (
    <section className="td-zone" id="td-z3">
      <ZoneHead
        n="03"
        title="Schedule"
        right={posts.length === 0 ? 'nothing out today' : `${posts.length} out today`}
        state={posts.length === 0 ? 'done' : 'pending'}
      />
      {posts.length === 0 && plate.cancelled.length === 0 && (
        <div className="td-card">
          <div className="td-card-t">
            {loading && !brief ? 'Loading the brief…' : 'Nothing scheduled today'}
          </div>
          <div className="td-card-s">
            {loading && !brief
              ? ' '
              : 'No posts go out today. This zone stays clear until the next slot.'}
          </div>
        </div>
      )}
      {posts.length > 0 && (
        <div className="td-next">
          <span className="lbl">OUT TODAY</span>
          <span className="txt"><b>{posts.length}</b> listed under New today above</span>
        </div>
      )}
      {/* A called-off slot is not load, but it is news: before this, one of these
          was counted on the masthead as "1 going out". */}
      {plate.cancelled.length > 0 && (
        <div className="td-card">
          <div className="td-card-t">
            {plate.cancelled.length} slot{plate.cancelled.length === 1 ? '' : 's'} today cancelled
          </div>
          <div className="td-card-s">
            Called off, so {plate.cancelled.length === 1 ? 'it is' : 'they are'} not counted as going out.
          </div>
        </div>
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

function HealthStrip({ health, brief }: {
  health: TodayHealth | null; brief: Brief | null
}) {
  if (!health) {
    return (
      <section className="td-zone" id="td-z4">
        <ZoneHead n="04" title="Campaign health" right="" state="pending" />
        <div className="td-empty">Loading campaign health…</div>
      </section>
    )
  }

  // D21 mitigation: no per-lane scope to filter by (the chip is gone — see the
  // removal note in TodayScreen()), so this is every seat's data, unfiltered.
  const accept = health.accept
  const pipeline = health.pipeline
  const governors = health.governor
  const replies = health.replies

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
        right="both seats"
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

export function TodayScreen({
  onOpenDrafts, onOpenOps, threads, opsDrafts, onOpenThread, onOpenContent, onOpenCall,
}: {
  // A host that has its own navigation passes it in; the default app falls back to
  // its own hash routes (src/lib/route.ts). Either way a hand-off row has a way in
  // — a count with nowhere to go is worse than no count.
  onOpenDrafts?: () => void
  onOpenOps?: () => void
  // ---- the work queue (item 4, workbench-polish-2026-08-22) ----
  // All four are optional and all four arrive together or not at all: the
  // workbench Shell passes its own already-mounted `inbox.threads` /
  // `ops.drafts` (zero new fetch) plus real navigation. #exp/stock's call
  // site (App.tsx) passes none of them, so `threads === undefined` there and
  // the whole zone below renders nothing, and the escape hatch stays exactly
  // what it always was, same as every other opt-in prop this screen already
  // carries (see the D21 note below for the precedent).
  threads?: Thread[]
  opsDrafts?: OpsDraft[]
  onOpenThread?: (id: string) => void
  onOpenContent?: (lane: string) => void
  // The call reader (port #2). Optional and absent in #exp/stock exactly like
  // the four props above: without a host that can mount the takeover window
  // the section has nowhere to open, so it does not render at all rather than
  // render rows that do nothing when tapped.
  onOpenCall?: (id: string, queue: CallRow[]) => void
} = {}) {
  const t = useToday()
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, t.refresh)
  // '#dms' since the Inbox job was absorbed into it; the workbench overrides
  // both of these with in-app navigation.
  const openDrafts = onOpenDrafts ?? (() => { location.hash = '#drafts' })
  const openOps = onOpenOps ?? (() => { location.hash = '#ops' })

  // The two piles this screen has never carried: content review/error and
  // staged client ideas. Fetched only when the work queue is actually active
  // (threads !== undefined), so #exp/stock, which never passes threads,
  // never fires these reads. Read-only, see lib/workQueue.ts for the query
  // shape and the 1000-row clamp math.
  const [reviewPile, setReviewPile] = useState<Awaited<ReturnType<typeof fetchContentReviewPile>>>([])
  const [errorPile, setErrorPile] = useState<Awaited<ReturnType<typeof fetchContentErrorPile>>>([])
  const [ideaPile, setIdeaPile] = useState<Awaited<ReturnType<typeof fetchStagedIdeaPile>>>([])
  useEffect(() => {
    if (threads === undefined) return
    let alive = true
    Promise.all([fetchContentReviewPile(), fetchContentErrorPile(), fetchStagedIdeaPile()])
      .then(([review, error, ideas]) => {
        if (!alive) return
        setReviewPile(review); setErrorPile(error); setIdeaPile(ideas)
      })
      .catch(() => { /* additive, the DM/ops half of the queue still renders */ })
    return () => { alive = false }
  }, [threads !== undefined])

  const queue = threads === undefined ? null : rankQueue([
    ...buildReplyItems(threads, Date.now()),
    ...buildOpsItems(opsDrafts ?? [], Date.now()),
    ...pileItems(reviewPile, 'contentReview', Date.now()),
    ...pileItems(errorPile, 'contentError', Date.now()),
    ...pileItems(ideaPile, 'ideas', Date.now()),
  ])

  // Next call (dashboard port #1). Same gate as the work queue above: opt-in
  // on `threads !== undefined`, so #exp/stock never fires this read either.
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  useEffect(() => {
    if (threads === undefined) return
    let alive = true
    fetchUpcomingEvents()
      .then(rows => { if (alive) setEvents(rows) })
      .catch(() => { /* additive, the rest of Today still renders */ })
      .finally(() => { if (alive) setEventsLoading(false) })
    return () => { alive = false }
  }, [threads !== undefined])

  // The call archive (dashboard port #2). Same opt-in gate as the two reads
  // above, so #exp/stock never fires it. The query deliberately leaves the
  // transcript bodies behind: measured on the live table, selecting them turns
  // a 118KB read into a 16MB one, and the body is fetched per row only when
  // the reader's fold is opened.
  const [calls, setCalls] = useState<CallRow[]>([])
  const [callsLoading, setCallsLoading] = useState(true)
  useEffect(() => {
    if (threads === undefined) return
    let alive = true
    fetchCalls()
      .then(rows => { if (alive) setCalls(rows) })
      .catch(() => { /* additive, the rest of Today still renders */ })
      .finally(() => { if (alive) setCallsLoading(false) })
    return () => { alive = false }
  }, [threads !== undefined])

  // D21 mitigation (not the full fix): this screen used to run an Ivan/Rise/All
  // lane chip over these rows, but get-morning-brief's payload carries neither
  // client_id nor prospect_id on urgencies/dm_drafts/comment_drafts, and the
  // underlying tables (outreach_messages, commenting_log) have no client_id
  // column at all — tenancy is two hops away via outreach_campaigns.client_id,
  // and comment rows have no join path to it whatsoever. So the chip was a
  // proven no-op that banked every row onto Ivan and showed Rise as dead
  // (phase2-defect-ledger.md D21). The real fix is a JOIN inside
  // get-morning-brief (out of this run's write scope) — a derivation already
  // exists in-app for the DM/urgency side: the inbox_messages_v view resolves
  // a real client_id today. Until that ships, this screen shows everything,
  // unscoped, rather than mislabel it.
  const counts = t.brief ? countsFromBrief(t.brief, 'all') : t.counts
  // ONE derivation feeds the masthead number, the stacked bar AND each zone's own
  // header count. The masthead cannot drift from the zones because it is not a
  // second reading of the data — it is the sum of theirs.
  // The re-rank. One derivation for the whole screen: the masthead's split, both
  // banded zones and the schedule all read this, so "new today" cannot mean one
  // thing in the headline and another in the list.
  const plate = todayPlate(t.brief, 'all')
  const aging = t.brief?.aging_count ?? 0
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
      </div>

      <div className="rows td-rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {/* Above the masthead and above every zone, because an expiring OAuth
            grant outranks the day's queue: the queue waits, a lapsed grant
            cannot be recovered without the client clicking a new link. Renders
            nothing at all when nothing is open.
            `autoOpen` rides the SAME `threads === undefined` discriminator every
            other workbench-only prop on this screen already uses, so #exp/stock
            keeps the strip it has always had and only the workbench gets the
            narrowed auto-open. */}
        <SystemAlertStrip autoOpen={threads === undefined ? 'all' : 'critical'} />
        <Masthead c={counts} plate={t.brief ? plate : null} syncedAt={syncedAt} stale={stale} />

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

        <div className="td-zones">
          {queue !== null && (
            <ZoneQueue
              items={queue}
              onOpenThread={onOpenThread ?? (() => {})}
              onOpenOps={openOps}
              onOpenContent={onOpenContent ?? (() => {})}
            />
          )}
          {threads !== undefined && (
            <ZoneNextCall
              events={events}
              loading={eventsLoading}
              archive={callsLoading ? null : callStats(calls)}
            />
          )}
          {threads !== undefined && onOpenCall && (
            <ZoneCallLog rows={calls} loading={callsLoading} onOpen={onOpenCall} />
          )}
          <ZoneNew
            plate={plate}
            brief={t.brief}
            loading={t.loading || t.refreshing}
            onOpenDrafts={openDrafts}
            onOpenOps={openOps}
          />
          <ZoneCarried
            plate={plate}
            aging={aging}
            brief={t.brief}
            loading={t.loading || t.refreshing}
            onOpenDrafts={openDrafts}
            onOpenOps={openOps}
          />
          <ZoneSchedule brief={t.brief} loading={t.loading || t.refreshing} plate={plate} />
          <HealthStrip health={t.health} brief={t.brief} />
        </div>
      </div>
    </>
  )
}
