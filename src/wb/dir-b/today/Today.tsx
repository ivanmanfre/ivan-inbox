/* =========================================================================
   S01 Today — Direction B ("surface").

   The data layer is untouched: every hook, every fetch, every effect and its
   dependency array, every guard and early return, and every user-visible
   string is the shipped screen's. Only the view changed:

     · the masthead is a figure card whose number counts up on a motion value
       and whose stacked bar springs each segment's scaleX (never its width)
     · every zone is a block of CARDS with a layoutId, the payload quoted, at
       two densities (a person gets the full card, a read-only pile gets the
       quiet one with a mono age)
     · KPI figures animate on mount on a 30ms stagger
     · banners are Banner, empty states are EmptyState with ghost rows
     · the zone heads stick and condense on scroll
   ========================================================================= */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { SystemAlertStrip } from '../../../components/SystemAlertStrip'
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
import {
  Avatar, Badge, Banner, Button, Card, EmptyState, Header, Icon, IconButton,
  Segmented, StatTile, Working, cx, fade, list, rise, spring, stagger,
} from '../../../ds'
import { Block, DirB } from '../shell'
import './today.css'

// Today = three staged zones (urgent, then approve, then today's content) plus a
// campaign-health strip. Deliberately absent: any n8n / workflow-error / system
// zone and any scan-report-open row — Ivan cut both from this surface.

// Severity is a token now, not a literal: the three hex values this screen used
// to carry are the same three the design system publishes.
const SEV = { live: 'clear', slowing: 'attention', stale: 'urgent' } as const

const KIND: Record<string, { label: string; cls: string }> = {
  reply: { label: 'Reply', cls: 'reply' },
  approve: { label: 'Approve + send', cls: 'appr' },
  handraiser: { label: 'Hand raised', cls: 'hand' },
}

function kindOf(k: string) {
  return KIND[k] ?? { label: label(k), cls: 'reply' }
}

/** A number that counts up to its reading on mount, on the one spring. */
function Figure({ value, delay = 0, className }: {
  value: number; delay?: number; className?: string
}) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(reduce ? value : 0)
  const text = useTransform(mv, v => String(Math.round(v)))
  useEffect(() => {
    if (reduce) { mv.set(value); return }
    const run = animate(mv, value, { ...spring, delay })
    return () => { run.stop() }
  }, [value, delay, reduce, mv])
  return <motion.span className={cx('dirb-figure', className)}>{text}</motion.span>
}

// The zone head. Block's own head cannot carry the id anchor these zones have
// always had, nor the sticky/condensing behaviour, so this draws Block's exact
// head shape instead (see NOTES.md, seam request).
function ZoneHead({ n, title, right, state }: {
  n: string; title: string; right: string; state: 'done' | 'pending' | 'hot'
}) {
  return (
    <div className="tdb-zh dirb-sticky">
      <span className="ds-t-mono tdb-zn">{n}</span>
      <span className="ds-t-eyebrow tdb-zt">{title}</span>
      <span className="tdb-zrule" />
      <span className="ds-t-meta tdb-zc" data-state={state}>{right}</span>
      {state === 'done' ? <Icon name="check" size={16} className="tdb-zmark" /> : null}
    </div>
  )
}

/** A zone: the id anchor, its head, and its column of cards. */
function Zone({ id, head, children }: { id: string; head: ReactNode; children: ReactNode }) {
  return (
    <section className="dirb-block" id={id}>
      {head}
      <motion.div className="dirb-cards" variants={list} initial="hidden" animate="show">
        {children}
      </motion.div>
    </section>
  )
}

/** One card in a zone column: it rises on mount and lifts into its detail. */
function Item({ lid, live, className, children }: {
  lid: string; live?: boolean; className?: string; children: ReactNode
}) {
  return (
    <motion.div layoutId={lid} variants={rise} className={className} data-live={live}>
      {children}
    </motion.div>
  )
}

// ---- masthead ----

// One primary number at the app's real top of scale (the display step), now
// counted up from zero on mount. It is the SUM of the three zone loads and
// nothing else, and the segments beneath it are a stacked bar of those same
// three counts, so the headline and the breakdown cannot disagree.
function Masthead({ c, plate, syncedAt, stale }: {
  c: BriefCounts | null; plate: TodayPlate | null; syncedAt: string | null; stale: boolean
}) {
  const load = todayLoad(c)
  const segs = [
    { k: 'urgent', d: 'urgent', n: load.urgent, l: 'urgent' },
    { k: 'approvals', d: 'approve', n: load.approvals, l: 'to approve' },
    { k: 'going', d: 'going', n: load.going, l: 'going out' },
  ]
  const denom = Math.max(1, load.total)
  return (
    <div className="dirb-mast">
      <div className="tdb-mast-l">
        {/* '–' until the payload lands: a zero we have not verified is a
            lie, and this screen's whole job is telling the truth about a
            cached read. */}
        {c
          ? <Figure value={load.total} className="ds-t-display" />
          : <span className="ds-t-display dirb-figure">{'–'}</span>}
        <div className="ds-t-body tdb-mast-cap">
          {!c ? 'still loading' : load.total === 1 ? 'thing on your plate' : 'things on your plate'}
        </div>
      </div>
      <div className="dirb-mast-bar">
        {segs.map(s => (
          <motion.span
            key={s.k}
            className="dirb-mast-seg"
            data-k={s.d}
            data-n={s.n}
            style={{ flexBasis: `${(s.n / denom) * 100}%`, transformOrigin: 'left center' }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={spring}
            title={`${s.n} ${s.l}`}
          />
        ))}
        {load.total === 0 && (
          <motion.span
            className="dirb-mast-seg"
            data-k="clear"
            style={{ flexBasis: '100%', transformOrigin: 'left center' }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={spring}
          />
        )}
      </div>
      <div className="dirb-legend ds-t-meta">
        {segs.map((s, i) => (
          <span key={s.k} className="dirb-legend-item" data-off={s.n === 0}>
            <span className="dirb-legend-dot" data-k={s.d} />
            {c ? <b><Figure value={s.n} delay={stagger(i)} /></b> : <b>{'–'}</b>} {s.l}
          </span>
        ))}
      </div>
      {/* The split Ivan actually asked about. The total above is unchanged —
          this says how much of it is TODAY'S. */}
      {c && plate && (
        <div className="tdb-split ds-t-meta">
          <b>{plate.newCount}</b> new today
          <span className="dirb-dim">{'·'}</span>
          <b>{plate.carriedCount}</b> carried over
          {plate.oldest && <span className="dirb-dim">oldest {plate.oldest}</span>}
        </div>
      )}
      {syncedAt
        ? (
          <span className="ds-t-meta dirb-dim tdb-sync" data-stale={stale}>
            {`${stale ? 'Cached' : 'Synced'} ${clockTime(syncedAt)} · ${ago(syncedAt)}`}
          </span>
        )
        : <Working live>Syncing…</Working>}
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
    <Item lid={`tdb-u-${u.id}`}>
      <Card
        className={cx('dirb-lift', open && 'dirb-tap')}
        onClick={open}
        lead={<Avatar name={u.name} />}
        title={
          <span className="dirb-row-wrap">
            <span className="dirb-truncate">{u.name}</span>
            <Badge tone={k.cls === 'appr' ? 'accent' : 'neutral'}>{k.label}</Badge>
          </span>
        }
        tail={<span className="ds-t-mono dirb-dim">{ago(u.waiting_since)}</span>}
        sub={org || undefined}
      >
        {/* D23/D24: cleanSnippet strips the classifier's bracket tag and
            decodes HTML entities so this reads as prose, not wire text. */}
        {u.snippet && <div className="dirb-quote dirb-clamp2">{cleanSnippet(u.snippet)}</div>}
      </Card>
    </Item>
  )
}

function ZoneNew({ plate, loading, brief, onOpenDrafts, onOpenOps }: {
  plate: TodayPlate; loading: boolean; brief: Brief | null
  onOpenDrafts: () => void; onOpenOps: () => void
}) {
  const n = plate.newCount
  return (
    <Zone
      id="td-z1"
      head={
        <ZoneHead
          n="01"
          title="New today"
          right={n === 0 ? 'nothing new' : `${n} since yesterday`}
          state={n > 0 ? 'hot' : 'done'}
        />
      }
    >
      {n === 0 ? (
        loading && !brief
          ? <EmptyState icon="loading" title="Loading the brief…" ghosts />
          : (
            <EmptyState
              icon="inbox"
              title="Nothing new since yesterday. Everything on your plate is carried over — and this is a live read, not a stall."
              ghosts
            />
          )
      ) : (
        <>
          {plate.urgencies.fresh.map(u => <UrgencyRow key={u.id} u={u} />)}
          <ApprovalRows
            dms={plate.dms.fresh} comments={plate.comments.fresh} feed={plate.feed.fresh} scope="new"
            onOpenDrafts={onOpenDrafts} onOpenOps={onOpenOps}
          />
          {plate.posts.map(p => (
            <Item key={p.id} lid={`tdb-p-${p.id}`}>
              <Card
                tone="quiet"
                lead={<span className="ds-t-mono dirb-dim">{p.scheduled_at ? clockTime(p.scheduled_at) : '—'}</span>}
                title={<span className="dirb-clamp2">{p.post_text ?? 'Untitled post'}</span>}
                sub={postLine(p)}
              />
            </Item>
          ))}
        </>
      )}
    </Zone>
  )
}

// ---- the counted hand-off ----
//
// SINGLE OWNERSHIP. One pending item has one owning surface; every other
// appearance of it is a count, a preview and a way in — never a second
// mutating affordance. This screen used to carry an inline "Approve & send" on
// DM drafts, and the row it acted on came from the CACHED morning brief, which
// is ~12s stale on a cold open and arbitrarily stale after a failed refresh.
// That is the U1 replay landmine with a friendly button on it: the dispatcher's
// real predicate is `approved_at NOT NULL AND sent_at IS NULL`, so a stale
// approve here sent a message Ivan had already discarded in the Drafts queue.
//
// The DB guard added to approveDraft is the belt; this is the braces.
// Approving DMs now happens only where the rows are live.
//
// Direction B density: this is the QUIET card. A person gets the full card
// above; a read-only pile gets one quiet line, its count and a mono age.
function HandOff({ n, title, sub, meta, owner, href, onOpen, age, lid }: {
  n: number
  title: string
  // Two zones can hold a group with the same title (a DM draft is both new and
  // carried), and a shared-layout id has to be unique in one tree.
  lid?: string
  sub?: string | null
  meta?: string | null
  // Where this pending item actually lives. An aggregating surface that shows
  // you something it cannot act on has to say where the action is, inline, or
  // it reads as a broken button that someone forgot to draw.
  owner: string
  href?: string | null
  onOpen?: () => void
  // The group's oldest item, printed ON the row. The age used to live only
  // inside the meta sentence, which is where "16d ago" goes to not be read.
  age?: string | null
}) {
  const body = (
    <>
      {sub && <div className="dirb-quote dirb-clamp2">{sub}</div>}
      {meta && <div className="ds-t-meta dirb-dim">{meta}</div>}
      <div className="ds-t-meta dirb-quiet">{owner}</div>
    </>
  )
  const id = `tdb-h-${lid ?? title}`
  const head = {
    lead: <Badge tone="accent">{n}</Badge>,
    title: (
      <span className="dirb-row-wrap">
        <span className="dirb-truncate">{title}</span>
        {age && <span className="ds-t-mono dirb-dim">{age}</span>}
      </span>
    ),
  }
  if (onOpen) {
    return (
      <Item lid={id}>
        <Card
          tone="quiet"
          className="dirb-lift dirb-tap"
          onClick={onOpen}
          lead={head.lead}
          title={head.title}
          tail={<Icon name="next" size={16} />}
        >
          {body}
        </Card>
      </Item>
    )
  }
  if (href) {
    return (
      <Item lid={id}>
        <a className="dirb-tap" href={href} target="_blank" rel="noreferrer">
          <Card tone="quiet" className="dirb-lift" lead={head.lead} title={head.title} tail={<Icon name="next" size={16} />}>
            {body}
          </Card>
        </a>
      </Item>
    )
  }
  return (
    <Item lid={id}>
      <Card tone="quiet" lead={head.lead} title={head.title}>{body}</Card>
    </Item>
  )
}

// ---- zone 00: the work queue ----
//
// Measured: 552 rows across content drafts, client ideas, ops drafts and DMs
// are waiting on a human decision, and 449 of them cannot appear on Today at
// all. This zone is the answer: one ranked list that crosses every lane, built
// from data the app already fetches at the Shell level (`threads`, `opsDrafts`,
// zero new cost) plus three small read-only aggregate queries.
//
// RANKING RULE: severity tier first, oldest-first inside a tier. A person
// waiting always outranks a draft waiting, and a reply nobody has even opened
// (tier 0) always outranks one that was at least read (tier 1).
//
// THE ACTION IS THE CLICK. A reply row opens the exact thread, an ops row opens
// the Ops job, a content/idea pile row opens Content PRE-FILTERED TO ITS LANE.
function QueueReplyRow({ item, onOpen }: { item: QueueItem; onOpen: () => void }) {
  return (
    <Item lid={`tdb-q-${item.id}`}>
      <Card
        className="dirb-lift dirb-tap"
        onClick={onOpen}
        lead={<Avatar name={item.title} />}
        title={
          <span className="dirb-row-wrap">
            <span className="dirb-truncate">{item.title}</span>
            {/* The one thing on this screen that has to be impossible to miss:
                a real person wrote in and this app has never once been opened
                to their message. The severity token every other marker on this
                screen already uses, no new colour vocabulary. */}
            {item.tier === 0 && (
              <Badge tone={SEV.stale}>
                <Icon name="dot" size={16} />never opened
              </Badge>
            )}
            {item.lane !== 'ivan' && (
              <Badge>{item.lane === 'risedtc' ? 'RISE' : 'ARCH'}</Badge>
            )}
          </span>
        }
        tail={<span className="ds-t-mono dirb-dim">{ago(item.waitingSince)}</span>}
      >
        {item.sub && <div className="dirb-quote dirb-clamp2">{item.sub}</div>}
      </Card>
    </Item>
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
      lid={item.id}
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
    <Zone
      id="td-z0"
      head={
        <ZoneHead
          n="A"
          title="Work queue"
          right={items.length === 0 ? 'clear' : `${items.length} across every lane`}
          state={items.length === 0 ? 'done' : 'hot'}
        />
      }
    >
      {neverOpened > 0 && (
        <Banner tone={SEV.stale} icon="alert">
          {neverOpened} {neverOpened === 1 ? 'person' : 'people'} wrote and {neverOpened === 1 ? 'was' : 'were'} never opened here.
        </Banner>
      )}
      {items.length === 0 ? (
        <EmptyState icon="inbox" title="Nothing crossing every lane is waiting on you right now." ghosts />
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
    </Zone>
  )
}

/** One labelled line inside a card: the LBL / value primitive both call zones use. */
function Line({ lbl, children }: { lbl: string; children: ReactNode }) {
  return (
    <div className="tdb-line">
      <span className="ds-t-eyebrow tdb-lbl">{lbl}</span>
      <span className="ds-t-body tdb-val">{children}</span>
    </div>
  )
}

// ---- zone B: next call ----
//
// Dashboard port #1: this inbox has never once read `calendar_events`, so it
// cannot answer "do I have a call today", the exact question the URL Ivan sent
// was pointing at.
function ZoneNextCall({ events, loading, archive }: {
  events: CalendarEvent[]; loading: boolean; archive: CallStats | null
}) {
  const next = events[0] ?? null
  const rest = Math.max(0, events.length - 1)

  if (loading) {
    return (
      <Zone id="td-z-call" head={<ZoneHead n="B" title="Next call" right="" state="pending" />}>
        <EmptyState icon="loading" title="Loading the calendar…" ghosts />
      </Zone>
    )
  }

  if (!next) {
    return (
      <Zone id="td-z-call" head={<ZoneHead n="B" title="Next call" right="none this week" state="done" />}>
        {/* The empty case is the COMMON case here: his calendar was clear for
            seven days on the day this was measured, and it is clear most weeks.
            So it does not get a placeholder, it gets the true second half of
            the answer. The count is stated only once it has actually been read;
            an unverified zero would be a lie on a screen whose whole job is not
            telling one. */}
        <EmptyState
          icon="calendar"
          title="No calls booked in the next seven days"
          ghosts
          sub={
            archive === null
              ? 'A booking shows up here the moment it lands.'
              : archive.withActions > 0
                ? `A booking shows up here the moment it lands. ${archive.total} earlier calls are `
                  + `on record below, and ${archive.withActions} of them still carry something `
                  + 'that was agreed.'
                : `A booking shows up here the moment it lands. ${archive.total} earlier calls are `
                  + 'on record below.'
          }
        />
      </Zone>
    )
  }

  const w = describeWhen(next)
  const soon = isStartingSoon(w)
  const type = resolveMeetingType(next)

  return (
    <Zone
      id="td-z-call"
      head={<ZoneHead n="B" title="Next call" right={`${w.day} ${w.time}`} state={soon ? 'hot' : 'pending'} />}
    >
      <Item lid="tdb-nextcall" className={cx(soon && 'dirb-working')} live={soon}>
        <Card className="dirb-lift">
          <Line lbl={w.day.toUpperCase()}>
            <b>{w.time}{w.endTime ? ` to ${w.endTime}` : ''}</b> {next.title}
            {soon && (
              <> <Badge tone={SEV.slowing}>starting soon</Badge></>
            )}
          </Line>
          {next.attendees.length > 0 && (
            <Line lbl="WITH">{next.attendees.join(', ')}</Line>
          )}
          {type && (
            <Line lbl="TYPE">{MEETING_TYPE_LABEL[type]}</Line>
          )}
          {/* Free value the old dashboard's own UI never read: Calendly stamps
              `source` on every booking and nothing renders it. */}
          {next.source && (
            <Line lbl="SOURCE">via {next.source}</Line>
          )}
          {next.meeting_url && (
            <Line lbl="JOIN">
              <a href={next.meeting_url} target="_blank" rel="noreferrer">{next.meeting_url}</a>
              {' '}<Icon name="external" size={16} />
            </Line>
          )}
          {rest > 0 && (
            <Line lbl="THIS WEEK">{rest} more call{rest === 1 ? '' : 's'}</Line>
          )}
        </Card>
      </Item>
    </Zone>
  )
}

// ---- zone B: the calls on record ----
//
// Dashboard port #2, the door half. 96 calls are transcribed and none of them
// was reachable from this app.
//
// THE ORDER IS THE FEATURE. 96 rows sorted by date buries the 12 that still
// carry unfinished business, and those 12 are the only rows with anything left
// to do in them. So the default segment is the one that holds them, and the
// ranking inside every segment puts them first.
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
    <Item lid={`tdb-c-${row.id}`}>
      <Card
        tone="quiet"
        className="dirb-lift dirb-tap"
        onClick={onOpen}
        lead={<Icon name="call" size={20} />}
        title={
          <span className="dirb-row-wrap">
            <span className="dirb-truncate">{callTitle(row.title)}</span>
            {n > 0 && (
              <span className="ds-t-mono dirb-dim">
                {mine > 0 ? `${mine} yours` : `${n} open`}
              </span>
            )}
          </span>
        }
        tail={<Icon name="next" size={16} />}
      >
        {lead && <div className="dirb-quote dirb-clamp2">{LEAD_LABEL[lead.kind]}: {lead.text}</div>}
        <div className="ds-t-meta dirb-dim">{meta}</div>
      </Card>
    </Item>
  )
}

function ZoneCallLog({ rows, loading, onOpen }: {
  rows: CallRow[]
  loading: boolean
  onOpen: (id: string, queue: CallRow[]) => void
}) {
  const stats = callStats(rows)
  // The default lands on unfinished business when there is any, and degrades
  // to the recent week when there is not. It is never "all" on arrival.
  const [seg, setSeg] = useState<CallSegment | null>(null)
  const [full, setFull] = useState(false)
  const active: CallSegment = seg ?? (stats.withActions > 0 ? 'open' : 'recent')
  const queue = segmentCalls(rows, active)
  const shown = full ? queue : queue.slice(0, CALL_PAGE)
  const hidden = queue.length - shown.length

  if (loading && rows.length === 0) {
    return (
      <Zone id="td-z-calls" head={<ZoneHead n="B" title="Calls on record" right="" state="pending" />}>
        <EmptyState icon="loading" title="Reading the call archive…" ghosts />
      </Zone>
    )
  }

  if (rows.length === 0) {
    return (
      <Zone id="td-z-calls" head={<ZoneHead n="B" title="Calls on record" right="none yet" state="done" />}>
        <EmptyState
          icon="call"
          ghosts
          title="No calls have been transcribed yet. One appears here after the first recording is written up."
        />
      </Zone>
    )
  }

  const counts: Record<CallSegment, number> = {
    open: stats.withActions,
    recent: stats.week,
    all: stats.total,
  }

  return (
    <Zone
      id="td-z-calls"
      head={
        <ZoneHead
          n="B"
          title="Calls on record"
          right={`${stats.total} kept · ${stats.meanMinutes}m average`}
          state={stats.withActions > 0 ? 'pending' : 'done'}
        />
      }
    >
      <Segmented
        label="Calls on record"
        markerId="tdb-callseg"
        value={active}
        onChange={s => { setSeg(s as CallSegment); setFull(false) }}
        options={(['open', 'recent', 'all'] as CallSegment[]).map(s => ({
          id: s, label: SEGMENT_LABEL[s], count: counts[s],
        }))}
      />
      {queue.length === 0 ? (
        <EmptyState
          icon="tasks"
          ghosts
          title={active === 'open'
            ? 'Nothing was left open on any call. Every action item on record has an owner and a call behind it.'
            : 'No calls in the last seven days.'}
        />
      ) : (
        <>
          {shown.map(r => (
            <CallRowLine key={r.id} row={r} onOpen={() => onOpen(r.id, queue)} />
          ))}
          <AnimatePresence>
            {hidden > 0 && (
              <motion.div variants={rise} initial="hidden" animate="show" exit="exit">
                <Button variant="quiet" block onClick={() => setFull(true)}>
                  <span className="ds-t-mono">{hidden}</span>
                  <span>more in this list</span>
                  <span className="dirb-dim">show them</span>
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </Zone>
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
// The honest name for what this screen was already showing under the word
// TODAY. Nothing here is hidden or dropped — it is the same rows, grouped, with
// their age printed on them, BELOW the work that actually arrived today.
function ZoneCarried({ plate, aging, loading, brief, onOpenDrafts, onOpenOps }: {
  plate: TodayPlate; aging: number; loading: boolean; brief: Brief | null
  onOpenDrafts: () => void; onOpenOps: () => void
}) {
  const [showAuto, setShowAuto] = useState(false)
  const n = plate.carriedCount
  const autoCount = plate.autoreplies.length
  if (n === 0 && autoCount === 0 && aging === 0) {
    return (
      <Zone id="td-z2" head={<ZoneHead n="02" title="Carried over" right="clear" state="done" />}>
        {loading && !brief
          ? <EmptyState icon="loading" title="Loading the brief…" ghosts />
          : <EmptyState icon="inbox" title={'Nothing carried over — the plate is today’s only.'} ghosts />}
      </Zone>
    )
  }
  return (
    <Zone
      id="td-z2"
      head={
        <ZoneHead
          n="02"
          title="Carried over"
          // Short on purpose: the zone title already says CARRIED OVER, and the
          // long form clipped at 390.
          right={n === 0 ? 'clear' : `${n}${plate.oldest ? ` · oldest ${plate.oldest}` : ''}`}
          state={n === 0 ? 'done' : 'pending'}
        />
      }
    >
      {plate.urgencies.carried.map(u => <UrgencyRow key={u.id} u={u} />)}
      <ApprovalRows
        dms={plate.dms.carried} comments={plate.comments.carried} feed={plate.feed.carried} scope="carried"
        onOpenDrafts={onOpenDrafts} onOpenOps={onOpenOps}
      />
      {/* The reply detector demotes replies older than 3 days out of the
          urgency array entirely — the payload carries only a scalar, so there
          are no rows to render here. It is a HAND-OFF: since DMs absorbed the
          conversation list those people are one tap away, listed and countable. */}
      {aging > 0 && (
        <HandOff
          n={aging}
          title={`${aging} older ${aging === 1 ? 'reply' : 'replies'}`}
          sub={'Demoted out of the urgent count after 3 days — still owed.'}
          meta="not in the plate number above"
          owner="open them in DMs"
          onOpen={onOpenDrafts}
        />
      )}
      {autoCount > 0 && (
        <>
          <Button variant="quiet" block onClick={() => setShowAuto(v => !v)}>
            <Icon name={showAuto ? 'minus' : 'add'} size={16} />
            <span className="ds-t-mono">{autoCount}</span>
            <span>auto-replies</span>
            <span className="dirb-dim">{'out of office — not waiting on you'}</span>
          </Button>
          <AnimatePresence>
            {showAuto && (
              <motion.div
                className="dirb-cards"
                variants={list}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                {plate.autoreplies.map(u => <UrgencyRow key={u.id} u={u} auto />)}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </Zone>
  )
}

// The three approval groups, rendered for ONE age band. Same HandOff contract
// as before (single ownership: a count, a preview and a way in — never a second
// mutating affordance), with the group's oldest age on the row itself.
function ApprovalRows({ dms, comments, feed, scope, onOpenDrafts, onOpenOps }: {
  dms: DmDraft[]; comments: CommentDraft[]; feed: FeedDraft[]
  scope: string
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
          lid={`${scope}-dm`}
          title={dms.length === 1 ? 'DM draft' : 'DM drafts'}
          age={ageTag(dOldest)}
          sub={dmPreview(dms[0])}
          meta={`${dms.length} waiting${dOldest ? ` · oldest drafted ${ago(dOldest)} ago` : ''}${dAging > 0 ? ` · ${dAging} owed >7d` : ''}`}
          owner={'live rows and Approve & send are in the DM queue — this list is the cached brief'}
          onOpen={onOpenDrafts}
        />
      )}
      {comments.length > 0 && (
        <HandOff
          n={comments.length}
          lid={`${scope}-comment`}
          title="Comment drafts"
          age={ageTag(cOldest)}
          sub={commentPreview(comments[0])}
          meta={`${comments.length} target${comments.length === 1 ? '' : 's'}${cOldest ? ` · oldest drafted ${ago(cOldest)} ago` : ''}${cAging > 0 ? ` · ${cAging} owed >7d` : ''}`}
          owner={'posting is live on LinkedIn — approved in Ops'}
          onOpen={onOpenOps}
        />
      )}
      {feed.length > 0 && (
        <HandOff
          n={feed.length}
          lid={`${scope}-feed`}
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
// and any slot that was called off, which used to be silently counted as a
// thing going out.
function ZoneSchedule({ brief, loading, plate }: {
  brief: Brief | null; loading: boolean; plate: TodayPlate
}) {
  const posts = plate.posts
  const next = brief ? nextUp(brief, 'all') : null
  const queue = brief?.outreach_queue?.total ?? null

  return (
    <Zone
      id="td-z3"
      head={
        <ZoneHead
          n="03"
          title="Schedule"
          right={posts.length === 0 ? 'nothing out today' : `${posts.length} out today`}
          state={posts.length === 0 ? 'done' : 'pending'}
        />
      }
    >
      {posts.length === 0 && plate.cancelled.length === 0 && (
        loading && !brief
          ? <EmptyState icon="loading" title="Loading the brief…" sub=" " ghosts />
          : (
            <EmptyState
              icon="scheduled"
              title="Nothing scheduled today"
              sub="No posts go out today. This zone stays clear until the next slot."
              ghosts
            />
          )
      )}
      {posts.length > 0 && (
        <Item lid="tdb-out-today">
          <Card>
            <Line lbl="OUT TODAY"><b>{posts.length}</b> listed under New today above</Line>
          </Card>
        </Item>
      )}
      {/* A called-off slot is not load, but it is news: before this, one of
          these was counted on the masthead as "1 going out". */}
      {plate.cancelled.length > 0 && (
        <Item lid="tdb-cancelled">
          <Card
            tone="quiet"
            title={`${plate.cancelled.length} slot${plate.cancelled.length === 1 ? '' : 's'} today cancelled`}
            sub={`Called off, so ${plate.cancelled.length === 1 ? 'it is' : 'they are'} not counted as going out.`}
          />
        </Item>
      )}
      {next && (
        <Item lid="tdb-next-up">
          <Card>
            <Line lbl="NEXT">
              <b>{next.scheduled_at ? dayTime(next.scheduled_at) : 'unscheduled'}</b>
              {next.post_format ? ` · ${next.post_format}` : ''}
              {next.post_text ? ` — ${next.post_text}` : ''}
            </Line>
          </Card>
        </Item>
      )}
      {queue != null && (
        <Item lid="tdb-queue">
          <Card>
            <Line lbl="QUEUE"><b>{queue}</b> prospects ready to send</Line>
          </Card>
        </Item>
      )}
    </Zone>
  )
}

// ---- campaign / inbound health strip ----

function sum<T>(rows: T[], key: keyof T): number {
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0)
}

function govMode(g: GovernorRow | undefined): { label: string; tone: string } {
  if (!g) return { label: 'NO DATA', tone: 'quiet' }
  if (g.mode === 'cold_paused') return { label: 'COLD-PAUSED', tone: SEV.stale }
  if (g.mode === 'warm_only') return { label: 'WARM-ONLY', tone: SEV.slowing }
  return { label: 'NORMAL', tone: SEV.live }
}

function HealthStrip({ health, brief }: {
  health: TodayHealth | null; brief: Brief | null
}) {
  if (!health) {
    return (
      <Zone id="td-z4" head={<ZoneHead n="04" title="Campaign health" right="" state="pending" />}>
        <EmptyState icon="loading" title="Loading campaign health…" ghosts />
      </Zone>
    )
  }

  // D21 mitigation: no per-lane scope to filter by, so this is every seat's
  // data, unfiltered.
  const accept = health.accept
  const pipeline = health.pipeline
  const governors = health.governor
  const replies = health.replies

  const r7 = acceptRate(sum(accept, 'sent_7d'), sum(accept, 'accepted_7d'))
  const r30 = acceptRate(sum(accept, 'sent_30d'), sum(accept, 'accepted_30d'))
  const trend = r7 - r30
  const trendTone = trend > 0 ? SEV.live : trend < 0 ? SEV.slowing : 'neutral'

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
    <Zone
      id="td-z4"
      head={<ZoneHead n="04" title="Campaign health" right="both seats" state="pending" />}
    >
      {!hasKpis ? (
        <EmptyState icon="chart" title="No campaign data for this scope." ghosts />
      ) : (
        <>
          <div className="dirb-tiles" data-cols="3">
            <StatTile
              label="Replies"
              value={<><Figure value={repliesToday} delay={stagger(0)} /><span className="dirb-dim"> today</span></>}
              note={`${repliesWeek} in 7d`}
            />
            <StatTile
              label="Accept"
              value={<><Figure value={r7} delay={stagger(1)} /><span className="dirb-dim">%</span></>}
              note={
                <>
                  7d{' · '}
                  <span className="tdb-tone tdb-strong" data-tone={trendTone}>
                    <Icon name={trend > 0 ? 'deltaUp' : trend < 0 ? 'deltaDown' : 'minus'} size={16} />
                    {Math.abs(trend)}
                  </span> vs 30d ({r30}%)
                </>
              }
            />
            <StatTile
              label="Governor"
              value={<><Figure value={gUsed} delay={stagger(2)} /><span className="dirb-dim">/{gCap}</span></>}
              note={
                <>
                  <span className="tdb-tone tdb-strong" data-tone={mode.tone}>{mode.label}</span>
                  {' · '}{gLeftDay} left today
                </>
              }
            />
          </div>

          {lanes.length > 0 && (
            <Block label={`Sends this 7d vs the ${capWindow} cap${gCap > 0 ? ` (${gCap})` : ''}`}>
              {lanes.map(([lane, e]) => (
                <div key={lane} className="tdb-lane dirb-working" data-live={e.sent7 > 0}>
                  <div className="tdb-lane-top">
                    <span className="ds-t-body">{laneLabel(lane)}</span>
                    <span className="ds-t-mono">{e.sent7}</span>
                    <span className="ds-t-meta tdb-lane-cap">{e.sendable} sendable</span>
                  </div>
                  <div className="tdb-bar">
                    <motion.div
                      className="tdb-bar-f"
                      data-zero={e.sent7 === 0}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: Math.min(100, Math.round((e.sent7 / laneScale) * 100)) / 100 }}
                      transition={spring}
                    />
                  </div>
                </div>
              ))}
            </Block>
          )}
        </>
      )}

      {li && (
        <Block label={'LinkedIn lane · all seats'}>
          <div className="dirb-tiles" data-cols="3">
            <Counter i={0} n={li.fresh_supply} cap="Fresh supply" />
            <Counter i={1} n={li.sends_today} cap="Sent today" warnZero />
            <Counter i={2} n={li.accepts_today} cap="Accepts" />
            <Counter i={3} n={li.replies_today} cap="Replies" />
            <Counter i={4} n={li.needs_reply} cap="Need reply" warn />
            <Counter i={5} n={li.stuck} cap="Stuck" bad />
          </div>
          {coldEmail && coldEmail.connected === false && (
            <div className="ds-t-meta dirb-dim">Cold email: {coldEmail.note ?? 'not connected'}.</div>
          )}
        </Block>
      )}
    </Zone>
  )
}

function Counter({ n, cap, warn, bad, warnZero, i }: {
  n: number | null | undefined; cap: string; warn?: boolean; bad?: boolean; warnZero?: boolean; i: number
}) {
  const v = n ?? null
  const tone = v == null ? 'quiet'
    : v === 0 ? (warnZero ? SEV.slowing : 'quiet')
    : bad && v > 0 ? SEV.stale
    : warn && v > 0 ? SEV.slowing
    : 'neutral'
  return (
    <span className="tdb-ct" data-tone={tone}>
      <StatTile
        label={cap}
        value={v == null ? undefined : <Figure value={v} delay={stagger(i)} />}
        emptyText={'—'}
      />
    </span>
  )
}

// ---- pull to refresh ----
//
// The same `usePullToRefresh` hook and the same three states; only the mark is
// redrawn, on Working and Icon instead of the old glyph markup.
function Pull({ pull, refreshing, trigger }: {
  pull: number; refreshing: boolean; trigger: number
}) {
  if (pull <= 0 && !refreshing) return null
  const ready = pull >= trigger
  return (
    <div className="tdb-ptr" style={{ height: pull }}>
      {refreshing
        ? <Working live />
        : (
          <span style={{ opacity: Math.min(1, pull / trigger) }}>
            <Icon name={ready ? 'up' : 'down'} size={20} />
          </span>
        )}
    </div>
  )
}

// ---- screen ----

export function Today({
  onOpenDrafts, onOpenOps, threads, opsDrafts, onOpenThread, onOpenContent, onOpenCall,
}: {
  // A host that has its own navigation passes it in; the default app falls back
  // to its own hash routes. Either way a hand-off row has a way in — a count
  // with nowhere to go is worse than no count.
  onOpenDrafts?: () => void
  onOpenOps?: () => void
  // ---- the work queue ----
  // All four are optional and all four arrive together or not at all: the
  // workbench Shell passes its own already-mounted threads / ops drafts (zero
  // new fetch) plus real navigation. #exp/stock's call site passes none of
  // them, so `threads === undefined` there and the whole zone below renders
  // nothing.
  threads?: Thread[]
  opsDrafts?: OpsDraft[]
  onOpenThread?: (id: string) => void
  onOpenContent?: (lane: string) => void
  // The call reader. Optional and absent in #exp/stock exactly like the four
  // props above: without a host that can mount the takeover window the section
  // has nowhere to open, so it does not render at all rather than render rows
  // that do nothing when tapped.
  onOpenCall?: (id: string, queue: CallRow[]) => void
} = {}) {
  const t = useToday()
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, t.refresh)
  // '#dms' since the Inbox job was absorbed into it; the workbench overrides
  // both of these with in-app navigation.
  const openDrafts = onOpenDrafts ?? (() => { location.hash = '#drafts' })
  const openOps = onOpenOps ?? (() => { location.hash = '#ops' })

  // The zone heads condense once the column has moved: one listener on the one
  // scroller, opacity only, never a layout property.
  const [condensed, setCondensed] = useState(false)
  useEffect(() => {
    const el = rowsRef.current
    if (!el) return
    const onScroll = () => { setCondensed(el.scrollTop > 8) }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll) }
  }, [])

  // The two piles this screen has never carried: content review/error and
  // staged client ideas. Fetched only when the work queue is actually active
  // (threads !== undefined), so #exp/stock, which never passes threads, never
  // fires these reads. Read-only.
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

  // Next call. Same gate as the work queue above: opt-in on
  // `threads !== undefined`, so #exp/stock never fires this read either.
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

  // The call archive. Same opt-in gate as the two reads above. The query
  // deliberately leaves the transcript bodies behind: selecting them turns a
  // 118KB read into a 16MB one.
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
  // lane chip over these rows, but the brief payload carries neither client_id
  // nor prospect_id on urgencies/dm_drafts/comment_drafts. So the chip was a
  // proven no-op that banked every row onto Ivan and showed Rise as dead. Until
  // the join ships, this screen shows everything, unscoped, rather than
  // mislabel it.
  const counts = t.brief ? countsFromBrief(t.brief, 'all') : t.counts
  // ONE derivation feeds the masthead number, the stacked bar AND each zone's
  // own header count. The masthead cannot drift from the zones because it is
  // not a second reading of the data — it is the sum of theirs.
  const plate = todayPlate(t.brief, 'all')
  const aging = t.brief?.aging_count ?? 0
  const syncedAt = t.brief?.generated_at ?? t.counts?.generated_at ?? t.cachedAt ?? null
  const stale = t.fromCache || t.degraded || (t.error != null && t.brief != null)

  return (
    <DirB>
      <Header
        sticky
        title="Today"
        sub={longDate()}
        tail={<IconButton icon="refresh" label="Refresh" onClick={() => { t.refresh() }} />}
      />

      <div className="dirb-surface" ref={rowsRef} data-condensed={condensed}>
        <AnimatePresence>
          {(ptr.pull > 0 || ptr.refreshing) && (
            <motion.div key="ptr" variants={fade} initial="hidden" animate="show" exit="exit">
              <Pull pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
            </motion.div>
          )}
        </AnimatePresence>
        {/* Above the masthead and above every zone, because an expiring OAuth
            grant outranks the day's queue: the queue waits, a lapsed grant
            cannot be recovered without the client clicking a new link. Renders
            nothing at all when nothing is open. `autoOpen` rides the SAME
            `threads === undefined` discriminator every other workbench-only
            prop on this screen already uses. */}
        <SystemAlertStrip autoOpen={threads === undefined ? 'all' : 'critical'} />
        <Masthead c={counts} plate={t.brief ? plate : null} syncedAt={syncedAt} stale={stale} />

        <AnimatePresence>
          {t.authError && (
            <motion.div key="auth" variants={rise} initial="hidden" animate="show" exit="exit">
              <Banner tone="attention" icon="lock">
                Signed out — showing the last brief saved on this device. Sign in again from Settings.
              </Banner>
            </motion.div>
          )}
          {!t.authError && t.degraded && (
            <motion.div key="degraded" variants={rise} initial="hidden" animate="show" exit="exit">
              <Banner tone="attention" icon="guard">
                Counts only — this session isn’t authorised for the full brief. Sign in again to see the rows.
              </Banner>
            </motion.div>
          )}
          {!t.authError && !t.degraded && t.error && t.brief && (
            <motion.div key="stale" variants={rise} initial="hidden" animate="show" exit="exit">
              <Banner tone="attention" icon="alert">
                Couldn’t refresh — showing the last brief on this device.
              </Banner>
            </motion.div>
          )}
        </AnimatePresence>
        {t.error && !t.brief && !t.refreshing && (
          <EmptyState icon="error" title={t.error} ghosts />
        )}

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
    </DirB>
  )
}
