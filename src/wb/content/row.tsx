/* ==========================================================================
   ONE WORKING-LIST ROW, and one stage's rows as a group of them.

   Copied from the `Card` and `StageTable` pieces private to
   `src/exp/v2c/ContentList.tsx`. Everything the row knows it still knows: the
   anchor column carries the QA verdict so the stage of every row reads down a
   single column at 390 and at 1440; the meta line never reflows; the three
   facts (pillar, funnel, source) are COLUMNS on a pointer canvas and fold
   below 1000px; the capability list is written here, where the row's status,
   its lane and its board visibility are known, and never inferred by the bar.
   ========================================================================== */
import type { ReactNode } from 'react'
import {
  boardGroupOf, canPromote, draftExcerpt, draftFailure, elapsedMinutes, generatingSince,
  isStuckGenerating, reviewActionable, stageOf, STAGE_LABEL, taxonomyValue,
  type ContentDraft, type ContentLane, type ContentStage,
} from '../../lib/content'
import { draftScore } from '../../lib/contentFilters'
import { label } from '../../lib/labels'
import type { RowCap } from '../../exp/v2c/commandStore'
import { postTime, relTime, sourceLabel, tagLabel, typeLabel } from '../../exp/v2c/fmt'
import { Dot, Group, Row, Rows, Sep } from '../kit'
import { Icon } from '../../ds'
import { PromoteRow, ReviewActions, RetryDraft, RowDelete } from './actions'
import { RowSelect, useRowState } from './select'
import { CalmEmpty } from './parts'
import './content.css'

/** Opening a draft hands the window the QUEUE it was opened from, so j/k and
    the window's rail walk exactly the rows Ivan is looking at. */
export type OpenDraft = (id: string, label: string, queue: ContentDraft[]) => void

/** The stage's own mark on a group eyebrow: a dot, then the word. */
export function StageMark({ stage, children }: { stage: ContentStage | 'ideas'; children: ReactNode }) {
  return (
    <span className="a-wrapline">
      <Dot tone={stage === 'review' ? 'accent' : stage === 'error' || stage === 'stuck' ? 'attention' : undefined} off={stage === 'published'} />
      <span>{children}</span>
    </span>
  )
}

export function Card({ d, lane, refresh, onOpen, active, queue, glance }: {
  d: ContentDraft
  lane: ContentLane
  refresh: () => void
  onOpen: OpenDraft
  active: boolean
  /** The rows of the SECTION this card sits in, in render order. That order is
      what j/k walks and what the window's rail draws. */
  queue: ContentDraft[]
  /** AT-A-GLANCE. The body excerpt on the row, so a decision can be made
      without opening it. Needs-review only, and the scope is the point. */
  glance?: boolean
}) {
  const thumb = d.image_urls?.[0]
  const title = d.title || d.topic || 'Untitled'
  const score = draftScore(d)
  const stage = stageOf(d)
  const qa = d.qa_verdict?.trim().toUpperCase()
  // The corner mark carries the QA verdict in three states and severity tokens
  // only — green a literal PASS, amber anything that is not, grey no verdict at
  // all. Grey is the honest third state: "not judged" is not "judged fine".
  const qaState = qa ? (qa === 'PASS' ? 'pass' : 'fail') : 'none'
  // A generation that died mid-run. Its count joins the in-flight mark.
  const stalled = isStuckGenerating(d)
  const genMins = stalled ? elapsedMinutes(generatingSince(d)) : null
  const src = taxonomyValue(d.taxonomy, 'source')
  const pillar = taxonomyValue(d.taxonomy, 'pillar')
  const funnel = d.funnel_stage?.trim() || null
  const excerpt = glance ? draftExcerpt(d.post_body) : null
  // THE REASON COLUMN. The QA chip is a verdict CODE at best and a bare dash at
  // worst, and neither answers "why did this fail". This line does, on every
  // errored row, reading the TERMINAL agent_log entry rather than the stamp.
  const failure = stage === 'error' ? draftFailure(d) : null
  // WHAT A BULK ACTION MAY DO TO THIS ROW. Both rules are the ones the
  // single-row controls already obey, read from the same functions.
  const caps: RowCap[] = [
    ...(reviewActionable(d.status, lane) ? (['approve', 'skip'] as RowCap[]) : []),
    ...(canPromote(d.status, lane) && boardGroupOf(d) !== 'board' ? (['promote'] as RowCap[]) : []),
    ...(lane === 'ivan' || boardGroupOf(d) !== 'board' ? (['delete'] as RowCap[]) : []),
  ]
  const { selected, focused } = useRowState(d.id)

  return (
    <Row
      className={`a-ct-row${active ? ' a-ct-row-on' : ''}`}
      selected={selected || active}
      focused={focused}
      sev={stalled ? 'attention' : undefined}
      onClick={() => onOpen(d.id, title, queue)}
      lead={
        <span className="a-ct-anchor" data-st={stage} data-qa={qaState}>
          {/* The row's registration with the command layer: it writes
              data-wbrow on the row, which is what j/k walks and what x
              selects. */}
          <RowSelect
            id={d.id} kind="draft" label={title} caps={caps}
            taxonomy={d.taxonomy} lane={lane}
          />
          {thumb
            ? <img className="a-ct-thumb" src={thumb} alt="" />
            : <span className="a-ct-thumb" aria-hidden />}
          <span
            className="a-ct-qa" data-qa={qaState}
            title={qa ? `QA ${label(d.qa_verdict)}` : 'no QA verdict on this row'}
          />
        </span>
      }
      title={title}
      meta={
        <>
          {/* Slot one, and it never moves. Strictly, only a literal PASS is a
              pass. A row with no verdict still spends the slot, so the column
              stays a column. On a stalled generation the slot carries the age
              instead: for that row, that IS the verdict. */}
          {stalled
            ? (
              <span className="a-wrapline a-sev-attention">
                <Icon name="alert" size={16} />
                <span>{genMins}m</span>
              </span>
            )
            : (
              <span className={qa ? (qa === 'PASS' ? 'a-sev-clear' : 'a-sev-attention') : 'a-dim-2'}>
                {d.qa_verdict ? `${label(d.qa_verdict)}${score !== null ? ` ${score}` : ''}` : '—'}
              </span>
            )}
          <Sep />
          <span>{typeLabel(d.type)}</span>
        </>
      }
      sub={
        <span className="a-ct-subs">
          {/* The line the old board never made him open a row for. Absent, not
              blank, when the body has not been generated yet. */}
          {glance && excerpt && <span className="a-ct-ex">{excerpt}</span>}
          {/* SOURCE LEGIBILITY, client lanes only. The richer source (a whole
              sentence on most of his drafts) that used to live in the detail
              pane alone. It rides in the row's own stack, so it is never gated
              by the column breakpoint and reads at every width. */}
          {lane !== 'ivan' && d.source_label && (
            <span className="a-ct-src" title={d.source_label}>
              <Dot />
              <span className="a-nowrap">{d.source_label}</span>
            </span>
          )}
          {/* THE REASON, ON EVERY ERRORED ROW, sharing its line with Retry:
              the sentence and the one thing to do about it are the same
              thought. */}
          {failure && (
            <span className="a-ct-reasonrow" onClick={e => e.stopPropagation()}>
              <span className="a-ct-reason" data-kind={failure.kind} title={failure.reason}>
                {failure.reason}
              </span>
              <RetryDraft d={d} lane={lane} onDone={refresh} />
            </span>
          )}
        </span>
      }
      subWrap
      tail={
        <>
          {/* The three facts as COLUMNS, one fixed x each, '—' when absent so
              the column stays a column. Desktop only. */}
          <span className="a-ct-cols">
            <span className="a-ct-colv" title={pillar ? `Pillar: ${tagLabel(pillar)}` : undefined}>{pillar ? tagLabel(pillar) : '—'}</span>
            <span className="a-ct-colv" title={funnel ? `Funnel stage: ${tagLabel(funnel)}` : undefined}>{funnel ? tagLabel(funnel) : '—'}</span>
            <span className="a-ct-colv" title={src ? `Source: ${sourceLabel(src)}` : undefined}>{src ? sourceLabel(src) : '—'}</span>
          </span>
          {/* The armed time, right-aligned and tabular, and only when the row
              HAS one. It shows the CLOCK, not "in 2d": the question asked of an
              armed row is which day and what time. */}
          {d.scheduled_at && (
            <span className="a-ink" title={`Scheduled for ${d.scheduled_at}`}>{postTime(d.scheduled_at)}</span>
          )}
          <span className="a-dim">{relTime(d.updated_at)}</span>
        </>
      }
      actions={
        <>
          {/* The two review controls stay INSIDE the row rather than growing a
              button bar underneath it, which is what keeps a 285-row list
              inside the density band. */}
          {reviewActionable(d.status, lane) && (
            <ReviewActions id={d.id} onDone={refresh} demoteApprove={stage === 'error'} />
          )}
          {/* The client lane's equivalent, in the same slot. The two are
              mutually exclusive by lane. */}
          {boardGroupOf(d) !== 'board' && <PromoteRow d={d} lane={lane} onDone={refresh} />}
          <RowDelete d={d} lane={lane} onDone={refresh} />
        </>
      }
    />
  )
}

/** One stage's rows as a group. No chevron: the tab above it is the open and
    closed answer. An empty stage says so in a sentence rather than rendering
    nothing, because in tab mode "nothing there" and "I clicked the wrong
    thing" look identical on a blank screen. */
export function StageTable({ s, rows, lane, refresh, onOpen, openId, sub, empty, groupLabel }: {
  s: ContentStage
  rows: ContentDraft[]
  lane: ContentLane
  refresh: () => void
  onOpen: OpenDraft
  openId: string | null
  sub?: string | null
  empty?: string
  groupLabel?: string
}) {
  return (
    <div id={`wb-s-${s}`} className="a-stack">
      {sub && <div className="a-ct-sub">{sub}</div>}
      {rows.length === 0
        ? <CalmEmpty line={empty ?? `Nothing at ${STAGE_LABEL[s].toLowerCase()}.`} loadedAt={null} />
        : (
          <Group
            label={<StageMark stage={s}>{groupLabel ?? STAGE_LABEL[s]}</StageMark>}
            tail={rows.length}
            stickyHead
          >
            <div className="a-ct-colhead" aria-hidden>
              <span className="a-ct-colhead-t a-eyebrow">Title</span>
              <span className="a-ct-colhead-c a-eyebrow">Pillar</span>
              <span className="a-ct-colhead-c a-eyebrow">Funnel</span>
              <span className="a-ct-colhead-c a-eyebrow">Source</span>
            </div>
            <Rows>
              {rows.map(d => (
                <Card
                  key={d.id} d={d} lane={lane} refresh={refresh} onOpen={onOpen}
                  active={openId === d.id} queue={rows}
                  // The decision surface, and only it.
                  glance={s === 'review'}
                />
              ))}
            </Rows>
          </Group>
        )}
    </div>
  )
}
