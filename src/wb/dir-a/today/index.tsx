/* ==========================================================================
   S01 Today, Direction A — the instrument.

   Same hooks, same reads, same writes, same navigation, same strings as
   src/screens/TodayScreen.tsx. What changed is the view: a compact sticky
   head, one masthead figure with its predicate under it, the counted splits
   as LEDGERS of cells sharing a baseline and a right edge, and every list
   zone as a GROUP with an uppercase eyebrow, a mono right-aligned count and
   dense hairline rows.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import {
  Avatar, Banner, EmptyState, Icon, IconButton, Segmented,
} from '../../../ds'
import {
  BarLine, Body, Cell, Dot, Group, Head, KV, Ledger, Row, Rows, Screen, StackBar,
  type Tone,
} from '../kit'
import { PullIndicator } from '../../../components/PullIndicator'
import { SystemAlertStrip } from './alerts'
import { usePullToRefresh } from '../../../hooks/usePullToRefresh'
import { useToday, type TodayHealth } from '../../../hooks/useToday'
import { label } from '../../../lib/labels'
import { acceptRate, laneLabel, type GovernorRow } from '../../../lib/kpis'
import type { Thread } from '../../../lib/inbox'
import type { OpsDraft } from '../../../lib/ops'
import {
  ago, ageTag, cleanSnippet, clockTime, countsFromBrief, dayTime,
  longDate, nextUp, todayLoad, todayPlate,
  type Brief, type BriefCounts, type CommentDraft, type DmDraft, type FeedDraft,
  type ScheduledPost, type TodayPlate, type Urgency,
} from '../../../lib/today'
import {
  buildOpsItems, buildReplyItems, fetchContentErrorPile, fetchContentReviewPile,
  fetchStagedIdeaPile, pileItems, rankQueue, type QueueItem,
} from '../../../lib/workQueue'
import {
  describeWhen, fetchUpcomingEvents, isStartingSoon, resolveMeetingType,
  MEETING_TYPE_LABEL, type CalendarEvent,
} from '../../../lib/nextCall'
import {
  LEAD_LABEL, SEGMENT_LABEL, actionItems, callStats, callTitle, fetchCalls, leadLine,
  owedByMe, people, segmentCalls,
  type CallRow, type CallSegment, type CallStats,
} from '../../../lib/transcripts'
import './today.css'

// Today = three staged zones (urgent, then approve, then today's content) plus a
// campaign-health strip. Deliberately absent: any n8n / workflow-error / system
// zone and any scan-report-open row — Ivan cut both from this surface.

// The three severity hexes this screen used to inline are the three system
// severity tokens under a name: stale = urgent, live = clear, slowing =
// attention. Nothing here paints a colour of its own.

const KIND: Record<string, { label: string; cls: string }> = {
  reply: { label: 'Reply', cls: 'reply' },
  approve: { label: 'Approve + send', cls: 'appr' },
  handraiser: { label: 'Hand raised', cls: 'hand' },
}

function kindOf(k: string) {
  return KIND[k] ?? { label: label(k), cls: 'reply' }
}

type ZoneState = 'done' | 'pending' | 'hot'

/** A group's eyebrow is `{n} {title}`; the tail is its count, in mono, right. */
function zoneLabel(n: string, title: string) {
  return `${n} ${title}`
}

function ZoneTail({ right, state }: { right: string; state: ZoneState }) {
  return (
    <span className="a-today-tail" data-state={state}>
      {right ? <span className="a-mono">{right}</span> : null}
      {state === 'done' ? <Icon name="check" size={16} /> : null}
    </span>
  )
}

/** One padded well: an empty line, a card, a note. */
function Pad({ children }: { children: React.ReactNode }) {
  return <div className="a-today-pad">{children}</div>
}

function Note({ children }: { children: React.ReactNode }) {
  return <Pad><span className="a-body-t a-dim">{children}</span></Pad>
}

// ---- masthead ----

// One primary number at the app's real top of scale, now the mono figure role
// (`--ds-fs-figure`) with its predicate directly under it. It is the SUM of the
// three zone loads and nothing else, and the stacked bar beneath it draws those
// same three counts, so the headline and the breakdown cannot disagree.
function Masthead({ c, plate, syncedAt, stale }: {
  c: BriefCounts | null; plate: TodayPlate | null; syncedAt: string | null; stale: boolean
}) {
  const load = todayLoad(c)
  const segs: Array<{ k: string; n: number; tone: Tone; l: string }> = [
    { k: 'urgent', n: load.urgent, tone: 'urgent', l: 'urgent' },
    { k: 'approvals', n: load.approvals, tone: 'clear', l: 'to approve' },
    { k: 'going', n: load.going, tone: 'quiet', l: 'going out' },
  ]
  // The clear segment when there is nothing on the plate at all, exactly as
  // before: an empty track would read as a missing reading, not as a clear day.
  const bar = load.total === 0
    ? [{ id: 'clear', n: 1, tone: 'clear' as Tone }]
    : segs.map(s => ({ id: s.k, n: s.n, tone: s.tone, note: `${s.n} ${s.l}` }))
  return (
    <Group pad>
      <div className="a-today-mast">
        <div className="a-today-fig">
          {/* '–' until the payload lands: a zero we have not verified is a lie, and
              this screen's whole job is telling the truth about a cached read. */}
          <span className="a-figure-t">{c ? load.total : '–'}</span>
          <span className="a-eyebrow">
            {!c ? 'still loading' : load.total === 1 ? 'thing on your plate' : 'things on your plate'}
          </span>
        </div>
        <div className="a-today-read">
          <StackBar segs={bar} />
          <div className="a-today-legend">
            {segs.map(s => (
              <span key={s.k} className="a-today-lg" data-off={s.n === 0 ? '' : undefined}>
                <Dot tone={s.tone} off={s.n === 0} />
                <span className="a-mono a-ink">{c ? s.n : '–'}</span>
                <span className="a-mono a-dim">{s.l}</span>
              </span>
            ))}
          </div>
          {/* The split Ivan actually asked about. The total above is unchanged —
              this says how much of it is TODAY'S. */}
          {c && plate && (
            <Ledger>
              <Cell label="New today" value={plate.newCount} />
              <Cell label="Carried over" value={plate.carriedCount} />
              <Cell label="Oldest" value={plate.oldest ?? undefined} />
            </Ledger>
          )}
          <span className={`a-mono ${stale ? 'a-sev-attention' : 'a-dim'}`}>
            {syncedAt ? `${stale ? 'Cached' : 'Synced'} ${clockTime(syncedAt)} · ${ago(syncedAt)}` : 'Syncing…'}
          </span>
        </div>
      </div>
    </Group>
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
    <Row
      lead={<Avatar name={u.name} size="sm" />}
      title={<>{u.name}<span className="a-mono a-dim"> {k.label}</span></>}
      // D23/D24: cleanSnippet strips the classifier's bracket tag and
      // decodes HTML entities so this reads as prose, not wire text.
      sub={u.snippet ? cleanSnippet(u.snippet) : undefined}
      meta={org || undefined}
      tail={<span className="a-mono">{ago(u.waiting_since)}</span>}
      onClick={open}
    />
  )
}

function ZoneNew({ plate, loading, brief, onOpenDrafts, onOpenOps }: {
  plate: TodayPlate; loading: boolean; brief: Brief | null
  onOpenDrafts: () => void; onOpenOps: () => void
}) {
  const n = plate.newCount
  return (
    <div className="a-today-z" id="td-z1">
      <Group
        label={zoneLabel('01', 'New today')}
        tail={<ZoneTail right={n === 0 ? 'nothing new' : `${n} since yesterday`} state={n > 0 ? 'hot' : 'done'} />}
      >
        {n === 0 ? (
          <Note>
            {loading && !brief
              ? 'Loading the brief…'
              : 'Nothing new since yesterday. Everything on your plate is carried over — and this is a live read, not a stall.'}
          </Note>
        ) : (
          <Rows>
            {plate.urgencies.fresh.map(u => <UrgencyRow key={u.id} u={u} />)}
            <ApprovalRows
              dms={plate.dms.fresh} comments={plate.comments.fresh} feed={plate.feed.fresh}
              onOpenDrafts={onOpenDrafts} onOpenOps={onOpenOps}
            />
            {plate.posts.map(p => (
              <Row
                key={p.id}
                lead={<span className="a-mono a-ink">{p.scheduled_at ? clockTime(p.scheduled_at) : '—'}</span>}
                title={p.post_text ?? 'Untitled post'}
                meta={postLine(p)}
              />
            ))}
          </Rows>
        )}
      </Group>
    </div>
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
  const lead = <span className="a-mono a-ink">{n}</span>
  const heading = <>{title}{age ? <span className="a-mono a-dim"> {age}</span> : null}</>
  const tail = <Icon name="forward" size={16} />
  const ownerLine = <span className="a-row-meta a-dim-2">{owner}</span>

  if (href && !onOpen) {
    return (
      <a className="a-row a-today-linkrow" data-interactive="" href={href} target="_blank" rel="noreferrer">
        <span className="a-row-lead">{lead}</span>
        <span className="a-row-main">
          <span className="a-row-title" data-wrap="">{heading}</span>
          {sub ? <span className="a-row-sub" data-wrap="">{sub}</span> : null}
          {meta ? <span className="a-row-meta">{meta}</span> : null}
          {ownerLine}
        </span>
        <span className="a-row-tail">{tail}</span>
      </a>
    )
  }
  return (
    <Row
      lead={lead}
      title={heading}
      titleWrap
      sub={sub ?? undefined}
      subWrap
      meta={meta ?? undefined}
      tail={tail}
      onClick={onOpen}
    >{ownerLine}</Row>
  )
}

// ---- zone 00: the work queue ----
//
// Measured: 552 rows across content drafts, client ideas, ops drafts and DMs
// are waiting on a human decision, and 449 of them cannot appear on Today at
// all. This zone is the answer: one ranked list that crosses every lane,
// built from data the app already fetches at the Shell level (`threads`,
// `opsDrafts`, zero new cost) plus three small read-only aggregate queries
// for the piles nothing else surfaces (content review/error, staged client
// ideas, see lib/workQueue.ts).
//
// RANKING RULE (defended in full in lib/workQueue.ts): severity tier first,
// oldest-first inside a tier. A person waiting always outranks a draft
// waiting, and a reply nobody has even opened (tier 0) always outranks one
// that was at least read (tier 1).
//
// THE ACTION IS THE CLICK. A reply row opens the exact thread (openId is the
// prospect_id). An ops row opens the Ops job. A content/idea pile row opens
// Content PRE-FILTERED TO ITS LANE.
function QueueReplyRow({ item, onOpen }: { item: QueueItem; onOpen: () => void }) {
  return (
    <Row
      lead={<Avatar name={item.title} size="sm" />}
      sev={item.tier === 0 ? 'urgent' : undefined}
      title={
        <>
          {item.title}
          {/* The one thing on this screen that has to be impossible to miss:
              a real person wrote in and this app has never once been opened
              to their message. The same severity the rest of the screen
              already uses, no new colour vocabulary, just the loudest one. */}
          {item.tier === 0 && (
            <span className="a-today-sev a-today-alarm">
              <Dot tone="urgent" />
              <span className="a-mono">never opened</span>
            </span>
          )}
          {item.lane !== 'ivan' && (
            <span className="a-mono a-dim"> {item.lane === 'risedtc' ? 'RISE' : 'ARCH'}</span>
          )}
        </>
      }
      sub={item.sub ?? undefined}
      tail={<span className="a-mono">{ago(item.waitingSince)}</span>}
      onClick={onOpen}
    />
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
    <div className="a-today-z" id="td-z0">
      <Group
        label={zoneLabel('A', 'Work queue')}
        tail={(
          <ZoneTail
            right={items.length === 0 ? 'clear' : `${items.length} across every lane`}
            state={items.length === 0 ? 'done' : 'hot'}
          />
        )}
      >
        {items.length === 0 ? (
          <Note>Nothing crossing every lane is waiting on you right now.</Note>
        ) : (
          <Rows>
            {neverOpened > 0 && (
              <Row
                sev="urgent"
                title={(
                  <span className="a-today-alarm">
                    {neverOpened} {neverOpened === 1 ? 'person' : 'people'} wrote and {neverOpened === 1 ? 'was' : 'were'} never opened here.
                  </span>
                )}
                titleWrap
              />
            )}
            {items.map(item => item.kind === 'reply'
              ? <QueueReplyRow key={item.id} item={item} onOpen={() => onOpenThread(item.openId!)} />
              : (
                <QueuePileRow
                  key={item.id}
                  item={item}
                  onOpen={item.kind === 'ops' ? onOpenOps : () => onOpenContent(item.openId!)}
                />
              ))}
          </Rows>
        )}
      </Group>
    </div>
  )
}

// ---- zone B: next call ----
//
// Dashboard port #1 (dashboard-port-audit.md): this inbox has never once
// read `calendar_events`, so it cannot answer "do I have a call today", the
// exact question the URL Ivan sent (`?section=today&sub=meetings`) was
// pointing at. Ported from personal-site (read-only reference), with its two
// known bugs deliberately not carried across, see lib/nextCall.ts for both.
//
// The lbl/txt lines are the kit's KV grid: an uppercase eyebrow key against a
// mono value, which is the same primitive Zone 03 "Schedule" reads below.
function ZoneNextCall({ events, loading, archive }: {
  events: CalendarEvent[]; loading: boolean; archive: CallStats | null
}) {
  const next = events[0] ?? null
  const rest = Math.max(0, events.length - 1)

  if (loading) {
    return (
      <div className="a-today-z" id="td-z-call">
        <Group label={zoneLabel('B', 'Next call')} tail={<ZoneTail right="" state="pending" />}>
          <Note>Loading the calendar…</Note>
        </Group>
      </div>
    )
  }

  if (!next) {
    return (
      <div className="a-today-z" id="td-z-call">
        <Group label={zoneLabel('B', 'Next call')} tail={<ZoneTail right="none this week" state="done" />}>
          {/* The empty case is the COMMON case here: his calendar was clear for
              seven days on the day this was measured, and it is clear most
              weeks. So it does not get a placeholder, it gets the true second
              half of the answer. The count is stated only once it has actually
              been read; an unverified zero would be a lie on a screen whose
              whole job is not telling one. */}
          <Pad>
            <div className="a-today-block">
              <span className="a-title-t">No calls booked in the next seven days</span>
              <span className="a-body-t a-dim">
                {archive === null
                  ? 'A booking shows up here the moment it lands.'
                  : archive.withActions > 0
                    ? `A booking shows up here the moment it lands. ${archive.total} earlier calls are `
                      + `on record below, and ${archive.withActions} of them still carry something `
                      + 'that was agreed.'
                    : `A booking shows up here the moment it lands. ${archive.total} earlier calls are `
                      + 'on record below.'}
              </span>
            </div>
          </Pad>
        </Group>
      </div>
    )
  }

  const w = describeWhen(next)
  const soon = isStartingSoon(w)
  const type = resolveMeetingType(next)

  const rows: Array<[React.ReactNode, React.ReactNode]> = [[
    w.day.toUpperCase(),
    <>
      <b>{w.time}{w.endTime ? ` to ${w.endTime}` : ''}</b> {next.title}
      {soon && <span className="a-sev-attention"> starting soon</span>}
    </>,
  ]]
  if (next.attendees.length > 0) rows.push(['WITH', next.attendees.join(', ')])
  if (type) rows.push(['TYPE', MEETING_TYPE_LABEL[type]])
  // Free value the old dashboard's own UI never read (dashboard-port-audit.md
  // §2): Calendly stamps `source` on every booking and nothing renders it.
  if (next.source) rows.push(['SOURCE', `via ${next.source}`])
  if (next.meeting_url) {
    rows.push(['JOIN', (
      <a className="a-link" href={next.meeting_url} target="_blank" rel="noreferrer">{next.meeting_url}</a>
    )])
  }
  if (rest > 0) rows.push(['THIS WEEK', `${rest} more call${rest === 1 ? '' : 's'}`])

  return (
    <div className="a-today-z" id="td-z-call">
      <Group
        label={zoneLabel('B', 'Next call')}
        tail={<ZoneTail right={`${w.day} ${w.time}`} state={soon ? 'hot' : 'pending'} />}
      >
        <Pad><KV rows={rows} /></Pad>
      </Group>
    </div>
  )
}

// ---- zone B: the calls on record ----
//
// Dashboard port #2 (dashboard-port-audit.md), the door half. 96 calls are
// transcribed and none of them was reachable from this app.
//
// THE ORDER IS THE FEATURE. 96 rows sorted by date buries the 12 that still
// carry unfinished business, and those 12 are the only rows with anything left
// to do in them. So the default segment is the one that holds them, and the
// ranking inside every segment puts them first (lib/transcripts.ts, rankCalls).
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
    <Row
      title={(
        <>
          {callTitle(row.title)}
          {n > 0 && (
            <span className="a-mono a-dim"> {mine > 0 ? `${mine} yours` : `${n} open`}</span>
          )}
        </>
      )}
      sub={lead ? `${LEAD_LABEL[lead.kind]}: ${lead.text}` : undefined}
      meta={meta}
      tail={<Icon name="forward" size={16} />}
      onClick={onOpen}
    />
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
      <div className="a-today-z" id="td-z-calls">
        <Group label={zoneLabel('B', 'Calls on record')} tail={<ZoneTail right="" state="pending" />}>
          <Note>Reading the call archive…</Note>
        </Group>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="a-today-z" id="td-z-calls">
        <Group label={zoneLabel('B', 'Calls on record')} tail={<ZoneTail right="none yet" state="done" />}>
          <Note>
            No calls have been transcribed yet. One appears here after the first recording is
            written up.
          </Note>
        </Group>
      </div>
    )
  }

  const counts: Record<CallSegment, number> = {
    open: stats.withActions,
    recent: stats.week,
    all: stats.total,
  }

  return (
    <div className="a-today-z" id="td-z-calls">
      <Group
        label={zoneLabel('B', 'Calls on record')}
        tail={(
          <ZoneTail
            right={`${stats.total} kept · ${stats.meanMinutes}m average`}
            state={stats.withActions > 0 ? 'pending' : 'done'}
          />
        )}
      >
        <Pad>
          <Segmented
            label="Calls on record"
            markerId="a-today-callseg"
            value={active}
            onChange={s => { setSeg(s as CallSegment); setFull(false) }}
            options={(['open', 'recent', 'all'] as CallSegment[]).map(s => ({
              id: s, label: SEGMENT_LABEL[s], count: counts[s],
            }))}
          />
        </Pad>
        {queue.length === 0 ? (
          <Note>
            {active === 'open'
              ? 'Nothing was left open on any call. Every action item on record has an owner and a call behind it.'
              : 'No calls in the last seven days.'}
          </Note>
        ) : (
          <Rows>
            {shown.map(r => (
              <CallRowLine key={r.id} row={r} onOpen={() => onOpen(r.id, queue)} />
            ))}
            {hidden > 0 && (
              <Row
                lead={<span className="a-mono a-ink">{hidden}</span>}
                title="more in this list"
                tail={<span className="a-mono">show them</span>}
                onClick={() => setFull(true)}
              />
            )}
          </Rows>
        )}
      </Group>
    </div>
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
      <div className="a-today-z" id="td-z2">
        <Group label={zoneLabel('02', 'Carried over')} tail={<ZoneTail right="clear" state="done" />}>
          <Note>
            {loading && !brief ? 'Loading the brief…' : 'Nothing carried over — the plate is today’s only.'}
          </Note>
        </Group>
      </div>
    )
  }
  return (
    <div className="a-today-z" id="td-z2">
      <Group
        label={zoneLabel('02', 'Carried over')}
        tail={(
          <ZoneTail
            // Short on purpose: the zone title already says CARRIED OVER, and the
            // long form clipped at 390 ("... OLDEST 35" with the d cut off).
            right={n === 0 ? 'clear' : `${n}${plate.oldest ? ` · oldest ${plate.oldest}` : ''}`}
            state={n === 0 ? 'done' : 'pending'}
          />
        )}
      >
        <Rows>
          {plate.urgencies.carried.map(u => <UrgencyRow key={u.id} u={u} />)}
          <ApprovalRows
            dms={plate.dms.carried} comments={plate.comments.carried} feed={plate.feed.carried}
            onOpenDrafts={onOpenDrafts} onOpenOps={onOpenOps}
          />
          {/* The reply detector demotes replies older than 3 days out of the urgency
              array entirely — the payload carries only a scalar, so there are no rows
              to render here. It is a HAND-OFF: since DMs absorbed the conversation
              list those people are one tap away, listed and countable. */}
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
              <Row
                lead={(
                  <span className="a-today-sev">
                    <Icon name={showAuto ? 'minus' : 'add'} size={16} />
                    <span className="a-mono a-ink">{autoCount}</span>
                  </span>
                )}
                title="auto-replies"
                tail={<span className="a-mono">out of office — not waiting on you</span>}
                onClick={() => setShowAuto(v => !v)}
              />
              {showAuto && plate.autoreplies.map(u => <UrgencyRow key={u.id} u={u} auto />)}
            </>
          )}
        </Rows>
      </Group>
    </div>
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

  const rows: Array<[React.ReactNode, React.ReactNode]> = []
  if (posts.length > 0) {
    rows.push(['OUT TODAY', <><b>{posts.length}</b> listed under New today above</>])
  }
  if (next) {
    rows.push(['NEXT', (
      <>
        <b>{next.scheduled_at ? dayTime(next.scheduled_at) : 'unscheduled'}</b>
        {next.post_format ? ` · ${next.post_format}` : ''}
        {next.post_text ? ` — ${next.post_text}` : ''}
      </>
    )])
  }
  if (queue != null) {
    rows.push(['QUEUE', <><b>{queue}</b> prospects ready to send</>])
  }

  return (
    <div className="a-today-z" id="td-z3">
      <Group
        label={zoneLabel('03', 'Schedule')}
        tail={(
          <ZoneTail
            right={posts.length === 0 ? 'nothing out today' : `${posts.length} out today`}
            state={posts.length === 0 ? 'done' : 'pending'}
          />
        )}
      >
        <Pad>
          <div className="a-today-blocks">
            {posts.length === 0 && plate.cancelled.length === 0 && (
              <div className="a-today-block">
                <span className="a-title-t">
                  {loading && !brief ? 'Loading the brief…' : 'Nothing scheduled today'}
                </span>
                <span className="a-body-t a-dim">
                  {loading && !brief
                    ? ' '
                    : 'No posts go out today. This zone stays clear until the next slot.'}
                </span>
              </div>
            )}
            {/* A called-off slot is not load, but it is news: before this, one of
                these was counted on the masthead as "1 going out". */}
            {plate.cancelled.length > 0 && (
              <div className="a-today-block">
                <span className="a-title-t">
                  {plate.cancelled.length} slot{plate.cancelled.length === 1 ? '' : 's'} today cancelled
                </span>
                <span className="a-body-t a-dim">
                  Called off, so {plate.cancelled.length === 1 ? 'it is' : 'they are'} not counted as going out.
                </span>
              </div>
            )}
            {rows.length > 0 && <KV rows={rows} />}
          </div>
        </Pad>
      </Group>
    </div>
  )
}

// ---- campaign / inbound health strip ----

function sum<T>(rows: T[], key: keyof T): number {
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0)
}

function govMode(g: GovernorRow | undefined): { label: string; cls: string } {
  if (!g) return { label: 'NO DATA', cls: 'a-dim-2' }
  if (g.mode === 'cold_paused') return { label: 'COLD-PAUSED', cls: 'a-sev-urgent' }
  if (g.mode === 'warm_only') return { label: 'WARM-ONLY', cls: 'a-sev-attention' }
  return { label: 'NORMAL', cls: 'a-sev-clear' }
}

function HealthStrip({ health, brief }: {
  health: TodayHealth | null; brief: Brief | null
}) {
  if (!health) {
    return (
      <div className="a-today-z" id="td-z4">
        <Group label={zoneLabel('04', 'Campaign health')} tail={<ZoneTail right="" state="pending" />}>
          <Note>Loading campaign health…</Note>
        </Group>
      </div>
    )
  }

  // D21 mitigation: no per-lane scope to filter by (the chip is gone — see the
  // removal note in Today()), so this is every seat's data, unfiltered.
  const accept = health.accept
  const pipeline = health.pipeline
  const governors = health.governor
  const replies = health.replies

  const r7 = acceptRate(sum(accept, 'sent_7d'), sum(accept, 'accepted_7d'))
  const r30 = acceptRate(sum(accept, 'sent_30d'), sum(accept, 'accepted_30d'))
  const trend = r7 - r30
  // Direction on a stat, not severity: the delta tokens, never the severity ones.
  const trendCls = trend > 0 ? 'a-up' : trend < 0 ? 'a-down' : 'a-dim'

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
    <div className="a-today-z" id="td-z4">
      <Group
        label={zoneLabel('04', 'Campaign health')}
        tail={<ZoneTail right="both seats" state="pending" />}
        foot={coldEmail && coldEmail.connected === false
          ? <span className="a-meta">Cold email: {coldEmail.note ?? 'not connected'}.</span>
          : undefined}
      >
        {!hasKpis ? (
          <Note>No campaign data for this scope.</Note>
        ) : (
          <>
            <Ledger>
              <Cell
                label="Replies"
                value={<>{repliesToday}<span className="a-dim"> today</span></>}
                note={`${repliesWeek} in 7d`}
              />
              <Cell
                label="Accept"
                value={<>{r7}<span className="a-dim">%</span></>}
                note={(
                  <>
                    7d · <span className={trendCls}>
                      {trend > 0 ? <Icon name="deltaUp" size={16} /> : trend < 0 ? <Icon name="deltaDown" size={16} /> : null}
                      {Math.abs(trend)}
                    </span> vs 30d ({r30}%)
                  </>
                )}
              />
              <Cell
                label="Governor"
                value={<>{gUsed}<span className="a-dim">/{gCap}</span></>}
                note={<><span className={mode.cls}>{mode.label}</span>{' · '}{gLeftDay} left today</>}
              />
            </Ledger>

            {lanes.length > 0 && (
              <Pad>
                <div className="a-today-lanes">
                  <span className="a-meta">
                    Sends this 7d vs the {capWindow} cap{gCap > 0 ? ` (${gCap})` : ''}
                  </span>
                  {lanes.map(([lane, e]) => (
                    <div key={lane} className="a-today-lane">
                      <div className="a-today-lane-top">
                        <span className="a-title-t a-grow a-nowrap">{laneLabel(lane)}</span>
                        <span className="a-mono a-ink">{e.sent7}</span>
                        <span className="a-mono a-dim">{e.sendable} sendable</span>
                      </div>
                      <BarLine
                        pct={Math.min(100, Math.round((e.sent7 / laneScale) * 100))}
                        tone={e.sent7 === 0 ? 'quiet' : 'clear'}
                      />
                    </div>
                  ))}
                </div>
              </Pad>
            )}
          </>
        )}

        {li && (
          <>
            <Pad><span className="a-meta">LinkedIn lane · all seats</span></Pad>
            <Ledger>
              <Counter n={li.fresh_supply} cap="Fresh supply" />
              <Counter n={li.sends_today} cap="Sent today" warnZero />
              <Counter n={li.accepts_today} cap="Accepts" />
              <Counter n={li.replies_today} cap="Replies" />
              <Counter n={li.needs_reply} cap="Need reply" warn />
              <Counter n={li.stuck} cap="Stuck" bad />
            </Ledger>
          </>
        )}
      </Group>
    </div>
  )
}

function Counter({ n, cap, warn, bad, warnZero }: {
  n: number | null | undefined; cap: string; warn?: boolean; bad?: boolean; warnZero?: boolean
}) {
  const v = n ?? null
  const tone: Tone | undefined = v == null ? undefined
    : v === 0 ? (warnZero ? 'attention' : undefined)
    : bad && v > 0 ? 'urgent'
    : warn && v > 0 ? 'attention'
    : undefined
  return <Cell label={cap} value={v == null ? undefined : v} tone={tone} />
}

// ---- screen ----

export function Today({
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
  // the whole zone below renders nothing.
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
  // underlying tables have no client_id column at all. So the chip was a proven
  // no-op that banked every row onto Ivan and showed Rise as dead
  // (phase2-defect-ledger.md D21). Until the real fix ships, this screen shows
  // everything, unscoped, rather than mislabel it.
  const counts = t.brief ? countsFromBrief(t.brief, 'all') : t.counts
  // ONE derivation feeds the masthead number, the stacked bar AND each zone's own
  // header count. The masthead cannot drift from the zones because it is not a
  // second reading of the data — it is the sum of theirs.
  const plate = todayPlate(t.brief, 'all')
  const aging = t.brief?.aging_count ?? 0
  const syncedAt = t.brief?.generated_at ?? t.counts?.generated_at ?? t.cachedAt ?? null
  const stale = t.fromCache || t.degraded || (t.error != null && t.brief != null)

  const nextCall = threads !== undefined
    ? <ZoneNextCall events={events} loading={eventsLoading} archive={callsLoading ? null : callStats(calls)} />
    : null
  const callLog = threads !== undefined && onOpenCall
    ? <ZoneCallLog rows={calls} loading={callsLoading} onOpen={onOpenCall} />
    : null

  return (
    <Screen>
      <Head
        title="Today"
        sub={longDate()}
        tail={<IconButton icon="refresh" label="Refresh" onClick={() => { t.refresh() }} />}
      />

      <Body innerRef={rowsRef}>
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
          <Banner tone="urgent" icon="lock">
            Signed out — showing the last brief saved on this device. Sign in again from Settings.
          </Banner>
        )}
        {!t.authError && t.degraded && (
          <Banner tone="attention" icon="guard">
            Counts only — this session isn’t authorised for the full brief. Sign in again to see the rows.
          </Banner>
        )}
        {!t.authError && !t.degraded && t.error && t.brief && (
          <Banner tone="attention" icon="alert">Couldn’t refresh — showing the last brief on this device.</Banner>
        )}
        {t.error && !t.brief && !t.refreshing && (
          <EmptyState icon="error" title={t.error} />
        )}

        <div className="a-stack">
          {queue !== null && (
            <ZoneQueue
              items={queue}
              onOpenThread={onOpenThread ?? (() => {})}
              onOpenOps={openOps}
              onOpenContent={onOpenContent ?? (() => {})}
            />
          )}
          {/* The two call zones read as one answer (what is ahead, what is
              behind), so above 1000px they sit beside each other and below it
              they stack in the order they already had. */}
          {nextCall && callLog
            ? <div className="a-cols" data-cols="2">{nextCall}{callLog}</div>
            : <>{nextCall}{callLog}</>}
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
      </Body>
    </Screen>
  )
}
