// Coming up (SPEC-dms §2.3.4): one timeline for Due, the next three days and Later, grouped by day,
// a time column and a status pill per row; the shared next step said once, under the name, only when
// it says something. Items come from the SAME computation as the legacy sections (Column.tsx: due /
// future / later). Presentation only: no hooks of its own, no writes; a row opens through c.open.
import { Fragment } from 'react'
import type { LaterItem } from '../later'
import { firstLine } from '../model'
import { Quiet, Row } from '../Row'
import { Section, type Folds } from '../Section'
import { dayMonth, type RowCtx } from '../threadRows'
import type { UpcomingItem } from '../upcoming'
import { warsawDay, warsawHm } from '../../ui/time'
import { linePill, nextStepOf, type PillTone } from './pill'

type Item = { key: string; t: UpcomingItem['t']; group: string; time: string; pill: { text: string; tone: PillTone; title?: string } | null; next: string | null }

export function comingItems(due: UpcomingItem[], future: UpcomingItem[], later: LaterItem[], now: number): Item[] {
  const fromLine = (i: UpcomingItem, group: string, time: string): Item => {
    const p = linePill(i.line)
    return { key: i.t.prospect_id, t: i.t, group, time, pill: p ? { text: p.label, tone: p.tone, title: i.line } : null, next: p ? nextStepOf(p.rest) : i.line }
  }
  return [
    ...due.map(i => fromLine(i, 'Due now', warsawHm(i.at))),
    ...future.map(i => fromLine(i, warsawDay(i.at) === warsawDay(now) ? 'Today' : dayMonth(i.at), warsawHm(i.at))),
    ...later.map(i => ({
      key: i.t.prospect_id, t: i.t, group: 'Later', time: dayMonth(i.at),
      pill: i.kind === 'draft' ? { text: 'Draft returns', tone: 'info' as const, title: 'Draft returns for review' } : { text: 'Scheduled return', tone: 'info' as const, title: 'A follow-up drafts that morning' },
      next: i.kind === 'draft' ? firstLine(i.t.draft?.message_text) || null : null,
    })),
  ]
}

export function ComingUp({ c, folds, due, future, later, failed, loaded }: {
  c: RowCtx; folds: Folds; due: UpcomingItem[]; future: UpcomingItem[]; later: LaterItem[]; failed: boolean; loaded: boolean
}) {
  const items = comingItems(due, future, later, c.now)
  let prev = ''
  const rows = items.map((it, i) => {
    const head = it.group !== prev
    prev = it.group
    return (
      <Fragment key={it.key}>
        {head && <div className="dx-day" role="presentation">{it.group}</div>}
        <Row v4 index={i} pre={it.time} pill={it.pill} id={it.t.prospect_id} name={it.t.prospect_name} company={it.t.prospect_company}
          line={it.next ?? undefined} selected={c.selected === it.t.prospect_id} onOpen={() => c.open(it.t)} />
      </Fragment>
    )
  })
  return (
    <Section id="coming" foldable label="Coming up" n={failed ? '?' : items.length} folds={folds} rows={rows}
      before={failed ? <Quiet>Could not refresh the follow-up schedule. Use Refresh to try again.</Quiet>
        : !loaded ? <Quiet><span className="dx-busy">Reading the follow-up schedule…</span></Quiet>
          : items.length === 0 ? <Quiet>No follow-ups scheduled in the next three days.</Quiet> : null} />
  )
}
