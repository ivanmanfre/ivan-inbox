import { useMemo, useState, type ReactNode } from 'react'
import { setScheduleDateAt } from '../../../lib/content'
import { moveSlotWeek, planDay, type PlanRead } from '../../../lib/contentPlan'
import { dHash } from '../../route'
import { Sheet } from '../../ui/Sheet'
import { useToast } from '../../ui/toast'
import { dayIn, hmIn, zonedToUtc } from '../laneTime'
import type { Lane } from '../model'
import { FlagChip, GuessBlock } from './PlanList'
import { MoveDay } from './MoveDay'
import {
  ACCT_NAME, NO_DAY_LINE, ST_WORD, angleLine, briefLine, dayWhy, dimsOf, engagedLine, factsLine, firstLineChecks, firstLines, flagsFor,
  itemsOf, metaLine, photoLine, qaLine, quoteFor, reasonFor, replacedLine, shapeLine, sourceLine, traitLine, tzOf, weekWhy, writerRuleLine,
  type Acct, type PlanItem,
} from './planBrain'

// THE DETAIL PANEL (spec 2026-10-12 §3c, R2.4, R3.3 to R3.5, R4; mock v3 `panelHtml()`). The shared Sheet: a right
// panel on the desktop, a bottom sheet with a grab bar and swipe-down on the phone. Status, title, the meta line,
// the flags, then the seven questions (How it did only for published posts), the first lines, and the keys pinned
// at the bottom. "Will it do well" shows the brain guess only: the helps / hurts list is never shown.
// The one write is Move day: a dated post gets a new day at the same local time (operator_set_schedule_date,
// which writes the date and keeps the status); a planned slot moves to another week with room (db/263). Either
// way the toast offers Undo. Nothing here schedules or publishes a post.
// A dated Rise post still waiting for OK gets no Move day: on Mattan's board a date arms it to publish (db/242),
// and a move must keep the status.

const MOVE_ERR: Record<string, string> = {
  past_date: 'That time has already passed. Nothing changed.',
  no_room: 'That week is full. Nothing changed.',
  same_week: 'It is already in that week. Nothing changed.',
  out_of_horizon: 'That week is not in the plan. Nothing changed.',
  bad_week: 'That week is not in the plan. Nothing changed.',
  bad_status: 'This post can no longer be moved. Nothing changed.',
  not_found: 'This post is no longer in the plan. Nothing changed.',
  bad_gate: 'The app could not confirm it is you. Nothing changed.',
}
function moveError(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code
  if (typeof code === 'string' && MOVE_ERR[code]) return MOVE_ERR[code]
  const msg = e instanceof Error ? e.message : ''
  // The one refusal content.ts already says in plain words (a Rise idea flagged for Mattan).
  if (/Mattan/.test(msg) && !msg.includes('—')) return msg
  return 'Could not move it. Nothing changed.'
}

function Q({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return <li className="pl2-pn-q"><span className="pl2-pn-n" aria-hidden="true">{n}</span><div><h5>{title}</h5>{children}</div></li>
}
const P = ({ s, muted }: { s: string | null | undefined; muted?: boolean }) => (s ? <p className={muted ? 'pl2-no' : undefined}>{s}</p> : null)
const n0 = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-GB') : '–')

type Props = { item: PlanItem; read: PlanRead; lane: Lane; onClose: () => void; onChanged: () => void }

export function PlanPanel({ item, read, lane, onClose, onChanged }: Props) {
  const toast = useToast()
  const [moving, setMoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const all = useMemo(() => itemsOf(read), [read])

  const acct = read.account as Acct
  const tz = tzOf(read)
  const strip = read.brain_strip ?? null
  const b = item.brain
  const published = item.st === 'published'

  // 1. Why this post
  const reason = reasonFor(item, acct)
  const source = sourceLine(item, reason)
  const quote = quoteFor(item)
  const brief = item.whyNow ? briefLine(item) : null
  const replaced = replacedLine(item)
  // 2-3. Why this week, why this day
  const wk = all.find(i => i.key === item.key) ? all : [...all, item]
  const week = weekWhy(wk, item.week) || null
  const day = dayWhy(item, acct, strip, tz) || NO_DAY_LINE
  // 4. How it is written
  const written = [angleLine(item), traitLine(item, acct), shapeLine(item), ...firstLineChecks(item), writerRuleLine(acct, strip), photoLine(item, acct)].filter((s): s is string => !!s)
  // 5. Is it good
  const qa = qaLine(item)
  const facts = factsLine(item)
  const dims = dimsOf(item)
  // 7. How it did
  const res = b?.result ?? null
  const median = strip?.views?.median
  const engaged = engagedLine(item, acct)
  const first = firstLines(item)
  const flags = flagsFor(item, strip, acct)

  // Keys
  const approve = item.st === 'review' && item.draftId ? dHash('content', 'now', { draft: item.draftId, lane }) : null
  const openDraft = !published && item.draftId ? dHash('content', 'calendar', { draft: item.draftId, lane }) : null
  const linkedin = published && res?.url ? res.url : null
  const canMove = !published && item.st !== 'failed' && (item.kind === 'planned'
    ? !!item.slotId
    : !!item.draftId && !!item.at && !(acct === 'risedtc' && item.st === 'review'))

  const movePost = async (to: string) => {
    const id = item.draftId!, prev = item.at!
    const when = zonedToUtc(to, hmIn(prev, tz.name), tz.name)
    setBusy(true)
    try {
      const stored = await setScheduleDateAt(id, when)
      setMoving(false)
      const said = `${planDay(dayIn(stored, tz.name))} · ${hmIn(stored, tz.name)} ${tz.label}`
      toast.show({
        message: `Moved to ${said}.`, sub: ACCT_NAME[acct],
        action: {
          label: 'Undo', verb: 'plan-move-undo', run: () => {
            void setScheduleDateAt(id, prev)
              .then(() => toast.show({ message: `Put back on ${planDay(dayIn(prev, tz.name))} · ${hmIn(prev, tz.name)} ${tz.label}.`, sub: ACCT_NAME[acct] }))
              .catch(e => toast.show({ message: moveError(e), tone: 'failed' }))
              .finally(onChanged)
          },
        },
      })
      onChanged()
    } catch (e) {
      toast.show({ message: moveError(e), tone: 'failed' })
    } finally {
      setBusy(false)
    }
  }
  const moveSlot = async (to: string) => {
    const id = item.slotId!, from = item.week
    setBusy(true)
    try {
      const r = await moveSlotWeek(id, to)
      setMoving(false)
      const back = r.from_week || from
      toast.show({
        message: `Moved to the week of ${planDay(r.to_week || to).replace(/^\w+ /, '')}.`, sub: ACCT_NAME[acct],
        action: {
          label: 'Undo', verb: 'plan-move-undo', run: () => {
            void moveSlotWeek(id, back)
              .then(() => toast.show({ message: `Put back in the week of ${planDay(back).replace(/^\w+ /, '')}.`, sub: ACCT_NAME[acct] }))
              .catch(e => toast.show({ message: moveError(e), tone: 'failed' }))
              .finally(onChanged)
          },
        },
      })
      onChanged()
    } catch (e) {
      toast.show({ message: moveError(e), tone: 'failed' })
    } finally {
      setBusy(false)
    }
  }

  const keys = <div className="pl2-pn-keys">
    {approve && <a className="cv2-k cv2-k-p" href={approve} data-verb="plan-approve">Read and approve</a>}
    {linkedin && <a className="cv2-k" href={linkedin} target="_blank" rel="noopener noreferrer" data-verb="plan-linkedin">Open on LinkedIn</a>}
    {openDraft && <a className="cv2-k" href={openDraft} data-verb="plan-open-draft">Open draft</a>}
    {canMove && <button type="button" className="cv2-k" data-verb="plan-move" onClick={() => setMoving(true)}>Move day</button>}
  </div>
  const hasKeys = !!(approve || linkedin || openDraft || canMove)
  const foot = moving
    ? <MoveDay item={item} read={read} busy={busy} onCancel={() => setMoving(false)} onPick={to => { void (item.kind === 'planned' ? moveSlot(to) : movePost(to)) }} />
    : hasKeys ? keys : undefined

  return <Sheet open onClose={onClose} className="pl2-pn" label={item.title || 'Post'}
    title={<span className={`pl2-st pl2-s-${item.st}`}><i className="pl2-dot" aria-hidden="true" />{ST_WORD[item.st]}</span>}
    foot={foot}>
    <div className="pl2-pn-body">
      <h3 className="pl2-pn-t">{item.title || 'Untitled post'}</h3>
      {metaLine(item, tz) && <p className="pl2-pn-meta">{metaLine(item, tz)}</p>}
      {flags.length > 0 && <div className="pl2-pn-flags">{flags.map(f => <FlagChip key={f.key} f={f} />)}</div>}
      <ol className="pl2-pn-qs">
        <Q n={1} title="Why this post">
          <P s={reason ?? 'No reason saved for this post.'} muted={!reason} />
          <P s={replaced} />
          <P s={source} muted />
          {quote && <blockquote className="pl2-q pl2-pn-quote">{quote}</blockquote>}
          <P s={brief} />
        </Q>
        <Q n={2} title="Why this week"><P s={week ?? 'One of the posts of this week.'} /></Q>
        <Q n={3} title="Why this day"><P s={day} /></Q>
        <Q n={4} title="How it is written">
          {written.length ? written.map(s => <p key={s}>{s}</p>) : <P s="Not saved for this draft yet." muted />}
        </Q>
        <Q n={5} title="Is it good">
          {qa || facts ? <>{qa && <p>{qa}</p>}{facts && <p>{facts}</p>}</> : <P s="No score saved for this draft." muted />}
          {dims.length > 0 && <div className="pl2-bars">
            {dims.map(d => <div key={d.key} className="pl2-bar" data-low={d.low ? 'true' : undefined}>
              <span>{d.label}</span><b>{d.v}</b>
              <i aria-hidden="true"><u style={{ width: `${Math.max(0, Math.min(100, d.v * 10))}%` }} /></i>
            </div>)}
          </div>}
        </Q>
        <Q n={6} title="Will it do well"><GuessBlock it={item} acct={acct} /></Q>
        {published && <Q n={7} title="How it did">
          {res && typeof res.views === 'number' && Number.isFinite(res.views) && <div className="pl2-res">
            <div><b>{n0(res.views)}</b><span>{typeof median === 'number' && Number.isFinite(median) ? `views (normal: ${n0(median)})` : 'views'}</span></div>
            <div><b>{n0(res.reactions)}</b><span>reactions</span></div>
            <div><b>{n0(res.comments)}</b><span>comments</span></div>
          </div>}
          {res?.viral && <p>Went viral.</p>}
          <P s={engaged} />
          {res?.young ? <P s="Numbers are still coming in." muted />
            : !res || typeof res.views !== 'number' ? <P s="No numbers yet." muted /> : null}
        </Q>}
      </ol>
      {first && <div className="pl2-pn-fl"><h5>First lines</h5><div className="pl2-pn-first">{first}</div></div>}
    </div>
  </Sheet>
}
