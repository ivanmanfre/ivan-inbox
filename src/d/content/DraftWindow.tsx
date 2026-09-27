import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDraftDetail } from '../../hooks/useContent'
import {
  STAGE_LABEL, boardGroupOf, canPromote, canUnpromote, clientDeletable, clientEditable, clientStageLabel,
  normalizeQa, reviewActionable, stageOf, type ContentDraftDetail,
} from '../../lib/content'
import { DIcon } from '../ui/icons'
import { Key } from '../ui/Key'
import { Empty, Failed, Skeleton } from '../ui/states'
import { Evidence, verdictWord } from './Evidence'
import { FixMenu } from './FixMenu'
import { LANE_NAME, OWNER, POSS, age, kindOf, nextFreeWeekday, titleOf, type Lane, type WallDay } from './model'
import { Conflict, Preview } from './Preview'
import { ScheduleRow, localInput } from './ScheduleRow'
import { useDraftVerbs } from './useDraftVerbs'

// THE DRAFT WINDOW. Desktop: docked right of the wall. Phone: the page itself
// (takeover), keys at the foot of the content. j/k walk the queue, Esc closes.
type Props = {
  id: string; lane: Lane; queue: string[]
  onPick: (id: string) => void; onClose: () => void; refresh: () => void
  days: WallDay[]; armed: Set<string> | null; armedFailed: boolean
}

export function DraftWindow(p: Props) {
  const [reload, setReload] = useState(0)
  const { detail, missing, loading, error } = useDraftDetail(p.id, reload)
  const retry = useCallback(() => setReload(n => n + 1), [])
  const refresh = useCallback(() => { p.refresh(); setReload(n => n + 1) }, [p])
  const shell = (body: React.ReactNode) => (
    <section className="cn-dw" aria-label="Draft">
      <div className="cn-dwh"><div className="cn-who"><b>{LANE_NAME[p.lane]} draft</b></div><button type="button" className="cn-x" aria-label="Close" onClick={p.onClose}><DIcon name="x" /></button></div>
      <div className="cn-dwb">{body}</div>
    </section>
  )
  if (error) return shell(<Failed what="this draft" detail={error} onRetry={retry} />)
  if (missing) return shell(<Empty title="This draft is gone." reason="It was deleted or moved out of reach since the list loaded." />)
  if (loading && (!detail || detail.id !== p.id)) return shell(<Skeleton lines={8} label="Reading the draft" />)
  if (!detail) return shell(<Skeleton lines={8} label="Reading the draft" />)
  return <Loaded key={detail.id} {...p} d={detail} refresh={refresh} />
}

function Loaded({ d, lane, queue, onPick, onClose, refresh, days, armed, armedFailed }: Props & { d: ContentDraftDetail }) {
  const at = queue.indexOf(d.id)
  const advance = useCallback(() => {
    const next = at >= 0 && at + 1 < queue.length ? queue[at + 1] : null
    if (next) onPick(next); else onClose()
  }, [at, onClose, onPick, queue])
  const v = useDraftVerbs(d, lane, advance, refresh)
  const [fix, setFix] = useState(false)
  const slot = useMemo(() => (armed ? nextFreeWeekday(armed) : armedFailed ? nextFreeWeekday(new Set()) : null), [armed, armedFailed])
  const [when, setWhen] = useState(() => localInput(d.scheduled_at ? new Date(d.scheduled_at) : nextFreeWeekday(new Set()).at))
  useEffect(() => { if (!d.scheduled_at && slot) setWhen(localInput(slot.at)) }, [d.scheduled_at, slot])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || v.editing || fix) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (document.querySelector('.d-confirm, .d-sheet')) return
      if (e.key === 'j' && at >= 0 && at + 1 < queue.length) { e.preventDefault(); onPick(queue[at + 1]) }
      else if (e.key === 'k' && at > 0) { e.preventDefault(); onPick(queue[at - 1]) }
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [at, fix, onClose, onPick, queue, v.editing])

  const stage = stageOf(d)
  const qa = normalizeQa(d.qa)
  const stateChip = lane === 'ivan' ? (d.status === 'review' ? 'Needs review' : STAGE_LABEL[stage])
    : clientStageLabel(stage, boardGroupOf({ board_visible: v.visible }))
  const line = [
    lane !== 'ivan' ? (v.visible ? `On ${POSS[lane]} board` : `Not on ${POSS[lane]} board`) : null,
    lane !== 'ivan' && qa?.score != null ? `QA: ${verdictWord(qa.verdict).toLowerCase()}, ${qa.score}` : null,
    `edited ${age(d.updated_at)} ago`,
    d.funnel_stage ? `Aim: ${d.funnel_stage[0].toUpperCase()}${d.funnel_stage.slice(1)}` : null,
  ].filter(Boolean).join(' · ')
  const actionable = reviewActionable(d.status, lane)
  const whenAt = new Date(when)

  let keys: React.ReactNode
  let foot: React.ReactNode
  if (v.editing) {
    keys = <><Key verb="cancel-edit" onClick={v.cancelEdit} disabled={v.busy}>Cancel</Key><Key primary verb="save" onClick={() => v.save()} disabled={v.busy}>{v.busy ? 'Saving…' : 'Save'}</Key></>
    foot = 'Save or cancel the edit first. Approve, Skip and j/k wait until the edit ends.'
  } else if (lane === 'ivan') {
    keys = <>
      <Key verb="skip" onClick={() => v.decide('skip')} disabled={!actionable || v.busy}>Skip</Key>
      <Key verb="edit" onClick={v.startEdit} disabled={v.busy}>Edit</Key>
      <Key verb="approve" onClick={() => v.decide('approve')} disabled={!actionable || v.busy} sub="no date yet">Approve</Key>
      <Key primary verb="schedule" onClick={() => v.schedule(whenAt)} disabled={v.busy || Number.isNaN(whenAt.getTime())}
        sub={Number.isNaN(whenAt.getTime()) ? 'pick a time' : `${whenAt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${when.slice(11)}`}>
        {d.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
      </Key>
    </>
    foot = <>{!actionable && `Approve and Skip act on drafts in review; this one is ${STAGE_LABEL[stage].toLowerCase()}. `}<button type="button" data-verb="fix" onClick={() => setFix(true)}>Fix or remove: Regenerate · Swap image · Back to idea · Delete draft</button>. Esc closes, j/k walks.</>
  } else {
    const promotable = canPromote(d.status, lane) && !v.visible
    keys = <>
      {clientDeletable(lane, v.visible) && <Key verb="delete" onClick={v.removeClient} disabled={v.busy}>Delete</Key>}
      {clientEditable(d.status, lane) && <Key verb="edit" onClick={v.startEdit} disabled={v.busy}>Edit</Key>}
      {promotable && <Key primary verb="board-on" onClick={() => v.board(true)} disabled={v.busy} sub={`${OWNER[lane]} sees it`}>Put on {POSS[lane]} board</Key>}
      {canUnpromote(lane, v.visible) && <Key verb="board-off" onClick={() => v.board(false)} disabled={v.busy}>Take off {POSS[lane]} board</Key>}
    </>
    foot = v.visible ? `On his board: ${OWNER[lane]} decides from there. Take it off to delete it.`
      : `The only act here that reaches a client. Nothing publishes: ${OWNER[lane]} approves, edits or schedules it on his board.`
  }

  return (
    <section className="cn-dw" aria-label="Draft">
      <div className="cn-dwh">
        <div className="cn-av">{lane === 'ivan' ? 'IM' : lane === 'arch' ? 'DS' : 'MD'}</div>
        <div className="cn-who"><b title={titleOf(d)}>{titleOf(d)}</b><small>{LANE_NAME[lane]} · {kindOf(d.type)} · created {age(d.created_at)} ago</small></div>
        <span className="cn-jk">
          <button type="button" aria-label="Previous (k)" disabled={at <= 0} onClick={() => at > 0 && onPick(queue[at - 1])}>k</button>
          <button type="button" aria-label="Next (j)" disabled={at < 0 || at + 1 >= queue.length} onClick={() => at >= 0 && at + 1 < queue.length && onPick(queue[at + 1])}>j</button>
          {at >= 0 ? `${at + 1} of ${queue.length}` : 'not in this queue'}
        </span>
        <button type="button" className="cn-x" aria-label="Close" data-verb="close" onClick={onClose}><DIcon name="x" /></button>
      </div>
      <div className="cn-chips"><span className="cn-st">{stateChip}</span><span>{line}</span>{v.editing && <span className="cn-st">Editing</span>}</div>
      <div className="cn-dwb">
        <Preview d={d} lane={lane} body={v.shown} editing={v.editing} text={v.text} setText={v.setText} />
        {v.conflict && <Conflict c={v.conflict} busy={v.busy} onTheirs={v.takeTheirs} onMine={v.keepMine} />}
      </div>
      {!v.editing && <Evidence d={d} initial={lane === 'ivan' ? 'qa' : 'src'} />}
      {lane === 'ivan' && !v.editing && (
        <ScheduleRow slot={d.scheduled_at ? null : slot} when={when} setWhen={setWhen} days={days} taken={armed} armedFailed={armedFailed} current={d.status === 'scheduled' ? d.scheduled_at : null} />
      )}
      {v.err && <p className="cn-say cn-bad" role="alert">{v.err}</p>}
      <div className="cn-acts">{keys}</div>
      <div className="cn-foot">{foot}</div>
      {lane === 'ivan' && <FixMenu d={d} open={fix} onClose={() => setFix(false)} onDone={refresh} />}
    </section>
  )
}
