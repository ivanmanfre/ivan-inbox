import { BrainDraftBadge } from './BrainDraftBadge'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDraftDetail } from '../../hooks/useContent'
import { useUnsavedNavigation } from '../../hooks/useUnsavedNavigation'
import { useDConfirm } from '../ui/confirm'
import {
  STAGE_LABEL, boardGroupOf, canPromote, canUnpromote, clientDeletable, clientEditable, clientStageLabel,
  normalizeQa, pictureEditable, reviewActionable, stageOf, type ContentDraftDetail,
} from '../../lib/content'
import { DIcon } from '../ui/icons'
import { warsawDm, warsawDow } from '../ui/time'
import { Key } from '../ui/Key'
import { Empty, Failed, Skeleton } from '../ui/states'
import { Evidence, verdictWord } from './Evidence'
import { ClientFixRow, FixRow } from './FixMenu'
import { LANE_NAME, OWNER, POSS, age, canSchedule, kindOf, nextFreeWeekday, scheduleOpenByDefault, titleOf, type Lane, type WallDay } from './model'
import { Conflict, Preview } from './Preview'
import { PictureRow } from './PictureRow'
import { AboveThePost, clientWhyNot, internalOnly, postsChip } from './DraftNotes'
import { ScheduleRow, localInput } from './ScheduleRow'
import { useDraftVerbs } from './useDraftVerbs'
import { EarlyReadChip } from './EarlyReadChip'
import { useEarlyReads } from './useEarlyReads'
import { useJudged, retryVerdict, markShown } from './verdictStore'
import { useVerdicts } from './useVerdicts'
import { brainNeedsVerdict } from '../../lib/brainVerdictGate'

// THE DRAFT WINDOW. Desktop: docked right of the wall. Phone: the page itself
// (takeover), keys at the foot of the content. j/k walk the queue, Esc closes.
type Props = {
  id: string; lane: Lane; queue: string[]
  onPick: (id: string) => void; onClose: () => void; refresh: () => void
  days: WallDay[]; armed: Set<string> | null; armedFailed: boolean
  /** Titles of the queue's rows, for the queue rail (today's persisted `wb-draft-rail`). */
  titles?: Record<string, string>
  /** Brief 4 review desk: `e` opens the post with its editor already open (today's startEdit, UI only). */
  startInEdit?: boolean
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

const RAIL_KEY = 'wb-draft-rail'

function Loaded({ d, lane, queue, onPick: pick, onClose: close, refresh, days, armed, armedFailed, titles, startInEdit = false }: Props & { d: ContentDraftDetail }) {
  const at = queue.indexOf(d.id)
  const [rail, setRailState] = useState(() => { try { return localStorage.getItem(RAIL_KEY) === '1' } catch { return false } })
  const setRail = (v: boolean) => { setRailState(v); try { localStorage.setItem(RAIL_KEY, v ? '1' : '0') } catch { /* private mode */ } }
  const advance = useCallback(() => {
    const next = at >= 0 && at + 1 < queue.length ? queue[at + 1] : null
    if (next) pick(next); else close()
  }, [at, close, pick, queue])
  const v = useDraftVerbs(d, lane, advance, refresh)
  // Once per opened draft: the desk's Edit lands in the editor (the same rule as Enter here).
  const editOnce = useRef(startInEdit)
  useEffect(() => {
    if (!editOnce.current) return
    editOnce.current = false
    if (lane === 'ivan' || clientEditable(d.status, lane)) v.startEdit()
  }, [d.status, lane, v])
  const earlyReads = useEarlyReads([{ ...d, post_body: v.shown }])
  const confirm = useDConfirm()
  const dirty = v.editing && (v.text !== v.shown || v.busy)
  const { canLeave } = useUnsavedNavigation(dirty, useCallback(() => v.busy ? Promise.resolve(false) : confirm({
    title: 'Discard unsaved edits?', message: 'Your changed copy has not been saved. Keep editing to save it, or discard these changes.',
    confirmText: 'Discard edits', cancelText: 'Keep editing', danger: true,
  }), [confirm, v.busy]))
  const onClose = useCallback(() => {
    if (v.busy) return
    if (!dirty) close()
    else void canLeave().then(ok => { if (ok) close() })
  }, [canLeave, close, dirty, v.busy])
  const onPick = useCallback((id: string) => {
    if (v.busy) return
    if (!dirty) pick(id)
    else void canLeave().then(ok => { if (ok) pick(id) })
  }, [canLeave, dirty, pick, v.busy])
  // The Picture row's optimistic picture: shown in the preview from the tap
  // until the refetch lands (or the write fails and the row clears it).
  const [pic, setPic] = useState<string[] | undefined>(undefined)
  useEffect(() => { setPic(undefined) }, [d.image_urls])
  // TODAY'S SCHEDULE TOGGLE: open by default at review / approved, folded on
  // an armed row, and (27 Sep ruling) not offered at all on a draft that is
  // published, errored, generating, an idea or skipped.
  const schedulable = lane === 'ivan' && canSchedule(d)
  const [dateOpen, setDateOpen] = useState(() => scheduleOpenByDefault(d))
  const slot = useMemo(() => (armed ? nextFreeWeekday(armed) : armedFailed ? nextFreeWeekday(new Set()) : null), [armed, armedFailed])
  const [when, setWhen] = useState(() => localInput(d.scheduled_at ? new Date(d.scheduled_at) : nextFreeWeekday(new Set()).at))
  useEffect(() => { if (!d.scheduled_at && slot) setWhen(localInput(slot.at)) }, [d.scheduled_at, slot])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || v.editing) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (document.querySelector('.d-confirm, .d-sheet')) return
      // The window owns j/k/Enter/Esc while it is open: the list's command layer under it must not also walk.
      const own = () => { e.preventDefault(); e.stopImmediatePropagation() }
      if (e.key === 'j') { own(); if (at >= 0 && at + 1 < queue.length) onPick(queue[at + 1]) }
      else if (e.key === 'k') { own(); if (at > 0) onPick(queue[at - 1]) }
      else if (e.key === 'Escape') { own(); onClose() }
      else if (e.key === 'Enter' && (lane === 'ivan' || clientEditable(d.status, lane)) && !(el && /^(BUTTON|A|SUMMARY)$/.test(el.tagName))) { own(); v.startEdit() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [at, d.status, lane, onClose, onPick, queue, v])

  const stage = stageOf(d)
  const qa = normalizeQa(d.qa)
  const stateChip = lane === 'ivan' ? (d.status === 'review' ? 'Needs review' : STAGE_LABEL[stage])
    : clientStageLabel(stage, boardGroupOf({ board_visible: v.visible }))
  const line = [
    postsChip(d),
    lane !== 'ivan' ? (v.visible ? `On ${POSS[lane]} board` : `Not on ${POSS[lane]} board`) : null,
    qa?.score != null ? `QA: ${verdictWord(qa.verdict).toLowerCase()}, ${qa.score}` : null,
    `edited ${age(d.updated_at)} ago`,
    d.funnel_stage ? `Aim: ${d.funnel_stage[0].toUpperCase()}${d.funnel_stage.slice(1)}` : null,
  ].filter(Boolean).join(' · ')
  const actionable = reviewActionable(d.status, lane)
  // RUN 39: a brain draft in review or error is judged, never approved, skipped
  // or deleted. `entry` is this session's tap on it (held, saving, saved or failed).
  const judgeable = brainNeedsVerdict(d)
  // Time to verdict starts when the open post shows a draft to judge (first time only).
  const draftId = d.id
  useEffect(() => { if (judgeable) markShown(draftId) }, [judgeable, draftId])
  const entry = useJudged().get(d.id)
  // A verdict saved earlier (another tab, a reload) counts as judged too.
  const saved = useVerdicts(judgeable).map.get(d.id)
  const fresh = judgeable && !entry && !saved
  const dropKey = fresh ? <Key verb="dw-drop" onClick={() => void v.verdict('drop')} disabled={v.busy}>Drop</Key> : null
  const keepKey = fresh ? <Key primary verb="dw-keep" onClick={() => void v.verdict('keep')} disabled={v.busy} sub={lane === 'ivan' ? 'no date yet' : undefined}>Approve</Key> : null
  const verdictNote = !judgeable || (!entry && !saved) ? null : entry?.phase === 'failed'
    ? <Key primary verb="dw-verdict-retry" onClick={() => retryVerdict(d.id)}>Try again</Key>
    : <span className="cn-dim" data-verb="dw-verdict-done">{(entry ?? saved)?.verdict === 'drop' ? 'Dropped' : 'Approved'}</span>
  const whenAt = new Date(when)

  let keys: React.ReactNode
  let foot: React.ReactNode
  if (v.editing) {
    keys = <><Key verb="cancel-edit" onClick={v.cancelEdit} disabled={v.busy}>Cancel</Key><Key primary verb="save" onClick={() => v.save()} disabled={v.busy}>{v.busy ? 'Saving…' : 'Save'}</Key></>
    foot = 'Save or cancel the edit first. Approve, Skip and j/k wait until the edit ends.'
  } else if (lane === 'ivan') {
    keys = <>
      {/* Skip and Approve only where they act (a draft in review); greyed keys on a scheduled post were noise. */}
      {judgeable ? dropKey : actionable && <Key verb="skip" onClick={() => v.decide('skip')} disabled={v.busy}>Skip</Key>}
      <Key verb="edit" onClick={v.startEdit} disabled={v.busy}>Edit</Key>
      {judgeable ? <>{keepKey}{verdictNote}</>
        : actionable && <Key primary={!schedulable} verb="approve" onClick={() => v.decide('approve')} disabled={v.busy} sub="no date yet">Approve</Key>}
      {schedulable && (dateOpen ? (
        <Key primary={!judgeable} verb="schedule" onClick={() => v.schedule(whenAt)} disabled={v.busy || Number.isNaN(whenAt.getTime())}
          sub={Number.isNaN(whenAt.getTime()) ? 'pick a time' : `${warsawDow(whenAt)} ${warsawDm(whenAt)} · ${when.slice(11)}`}>
          {d.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
        </Key>
      ) : (
        <Key verb="schedule-open" onClick={() => setDateOpen(true)} disabled={v.busy} sub={d.scheduled_at ? 'change the time' : 'pick a time'}>
          {d.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
        </Key>
      ))}
    </>
    foot = <>{judgeable ? 'Approve approves it and Drop deletes it. Nothing publishes until it is scheduled. '
      : null}
      {!schedulable && `Schedule is not offered: this draft is ${d.published_at ? 'published' : STAGE_LABEL[stage].toLowerCase()}. `}
      {schedulable && dateOpen && d.status === 'scheduled' && <><button type="button" data-verb="schedule-hide" onClick={() => setDateOpen(false)}>Hide date</button>. </>}<span className="cn-kk-hint">Esc closes, j/k walks.</span></>
  } else {
    const promotable = canPromote(d.status, lane) && !v.visible
    const why = clientWhyNot(d, lane, stage, { promotable, unpromotable: canUnpromote(lane, v.visible), editable: clientEditable(d.status, lane) })
    keys = <>
      {judgeable ? <>{dropKey}{keepKey}{verdictNote}</>
        : clientDeletable(lane, v.visible) && <Key verb="delete" onClick={v.removeClient} disabled={v.busy}>Delete</Key>}
      {clientEditable(d.status, lane) && <Key verb="edit" onClick={v.startEdit} disabled={v.busy}>Edit</Key>}
      {promotable && <Key primary verb="board-on" onClick={() => v.board(true)} disabled={v.busy} sub={`${OWNER[lane]} sees it`}>Put on {POSS[lane]} board</Key>}
      {canUnpromote(lane, v.visible) && <Key verb="board-off" onClick={() => v.board(false)} disabled={v.busy}>Take off {POSS[lane]} board</Key>}
    </>
    foot = <>{judgeable && `Approve records your verdict only, ${OWNER[lane]} sees nothing. Drop deletes the draft. `}{v.visible ? `On his board: ${OWNER[lane]} decides from there. Take it off to delete it.`
      : promotable ? `The only act here that reaches a client. Nothing publishes: ${OWNER[lane]} approves, edits or schedules it on his board.` : null}
      {why.map(w => <span key={w} className="cn-why2">{w}</span>)}</>
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
          {queue.length > 1 && <button type="button" data-verb="rail" aria-expanded={rail} onClick={() => setRail(!rail)} title="Show the queue">{rail ? 'hide list' : 'list'}</button>}
        </span>
        <button type="button" className="cn-x" aria-label="Close" data-verb="close" onClick={onClose}><DIcon name="x" /></button>
      </div>
      {rail && queue.length > 1 && (
        <ol className="cn-qrail" aria-label="Queue">
          {queue.map((id, i) => (
            <li key={id}><button type="button" className={id === d.id ? 'cn-on' : ''} aria-current={id === d.id ? 'true' : undefined} onClick={() => id !== d.id && onPick(id)}>
              <small>{i + 1}</small>{titles?.[id] ?? (id === d.id ? titleOf(d) : 'Draft')}
            </button></li>
          ))}
        </ol>
      )}
      <div className="cn-chips"><span className={`cn-st${stage === 'error' || stage === 'stuck' ? ' cn-st-bad' : ''}`}>{stateChip}</span><span>{line}</span>
        {internalOnly(d, stage) && <span className="cn-st cn-st-bad">Internal copy only · not approved for publication</span>}
        {v.editing && <span className="cn-st">Editing</span>}
        <EarlyReadChip read={earlyReads.get(d.id)} lane={lane} unsaved={dirty} /></div>
      <div className="cn-dwb">
        <AboveThePost d={d} stage={stage} lane={lane} />
        <BrainDraftBadge draft={d} />
        {lane !== 'ivan' && !v.visible && (stage === 'error' || stage === 'stuck') && <ClientFixRow d={d} lane={lane} onDone={refresh} disabled={v.editing || v.busy} />}
        <Preview d={pic ? { ...d, image_urls: pic } : d} lane={lane} body={v.shown} editing={v.editing} busy={v.busy} text={v.text} setText={v.setText}
          onStartEdit={lane === 'ivan' || clientEditable(d.status, lane) ? v.startEdit : null} onCancel={v.cancelEdit} onSave={() => void v.save()} />
        {v.conflict && <Conflict c={v.conflict} busy={v.busy} onTheirs={v.takeTheirs} onMine={v.keepMine} onDismiss={v.dismissConflict} />}
        {/* THE PICTURE, NEXT TO THE POST IT BELONGS TO, on every lane (29 Sep:
            it sat inside "Fix or remove" on Ivan's lane and did not exist on the
            client lanes). Offered only where db/230 accepts the write, so never
            on a carousel: one pinned photo would replace the whole deck. */}
        {pictureEditable(d, lane) && !v.editing && (
          <PictureRow d={d} lane={lane} onShow={setPic} onDone={refresh} disabled={v.busy} />
        )}
        {!v.editing && <Evidence d={d} initial={lane === 'ivan' ? 'qa' : 'src'} noteable={lane === 'ivan'} onNote={refresh} />}
        {lane === 'ivan' && !v.editing && <FixRow d={d} onDone={refresh} onDeleted={() => { refresh(); advance() }} disabled={v.busy} />}
      </div>
      <div className="cn-dwbar">
        {schedulable && dateOpen && !v.editing && (
          <ScheduleRow slot={d.scheduled_at ? null : slot} when={when} setWhen={setWhen} days={days} taken={armed} armedFailed={armedFailed} current={d.status === 'scheduled' ? d.scheduled_at : null} />
        )}
        {v.err && <p className="cn-say cn-bad" role="alert">{v.err}</p>}
        {judgeable && entry?.phase === 'failed' && entry.error && <p className="cn-say cn-bad" role="alert">{entry.error}</p>}
        <div className="cn-acts">{keys}</div>
        <div className="cn-foot">{foot}</div>
      </div>
    </section>
  )
}
