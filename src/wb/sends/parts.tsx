/* ==========================================================================
   src/wb/sends/parts.tsx — the pieces the Sends overview and the Control
   sections BOTH draw with.

   These three lived inside `./Overview.tsx`. `./Control.tsx` needs the same
   eyebrow, the same gauge and the same table-or-records pair, and importing
   them from Overview would be a cycle (Overview renders Control). They are one
   module now, so the two surfaces cannot drift into two vocabularies.
   ========================================================================== */
import type { ReactNode } from 'react'
import { Table, type TableColumn } from '../../ds'
import { Row, Rows, Sep, type Tone } from '../kit'

/** An eyebrow line and its predicate, over one instrument. */
export function Section({ label, tail, wrapTail, children }: {
  label: ReactNode; tail?: ReactNode
  /** Let a long predicate wrap onto its own line instead of being clipped by
      the nowrap the short legacy tails ("last 7 days · UTC") are sized for. */
  wrapTail?: boolean
  children: ReactNode
}) {
  return (
    <section className="a-sends-sec">
      <div className="a-sends-h" data-wrap={wrapTail ? '' : undefined}>
        <span className="a-eyebrow">{label}</span>
        {tail !== undefined && tail !== null && <span className="a-sends-h-s">{tail}</span>}
      </div>
      {children}
    </section>
  )
}

/** A plain percentage gauge (no overflow logic). */
export function BarGauge({ pct, tone, sm }: { pct: number; tone?: Tone; sm?: boolean }) {
  return (
    <span className="a-sends-g" data-sm={sm ? '' : undefined}>
      <span className="a-sends-g-f" data-tone={tone} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  )
}

/**
 * One table, drawn twice and shown once. Above 767px it is the design system's
 * `Table`; at or below, the same columns become a run of records — the first
 * column names the record, every other column is its header and its value on
 * the meta line under it. Nothing is dropped and nothing scrolls sideways.
 *
 * Both forms read the SAME `columns` array, so they cannot drift apart, and
 * they are mutually exclusive in CSS, so a screen reader meets exactly one.
 */
export function TableOrRecords<R>({ label, columns, rows, rowKey }: {
  label: string
  columns: Array<TableColumn<R>>
  rows: R[]
  rowKey: (r: R) => string
}) {
  return (
    <>
      <div className="a-sends-wide">
        <Table label={label} columns={columns} rows={rows} rowKey={rowKey} />
      </div>
      <div className="a-sends-narrow">
        <Rows>
          {rows.map(r => (
            <Row
              key={rowKey(r)}
              titleWrap
              title={columns[0].cell(r)}
              meta={columns.slice(1).map((c, i, all) => (
                <span className="a-sends-pair" key={c.id}>
                  <span className="a-sends-pk a-eyebrow">{c.header}</span>
                  <span className="a-sends-pv">{c.cell(r)}</span>
                  {/* The middot trails its pair rather than leading the next
                      one, so a line that wraps starts on a word. */}
                  {i < all.length - 1 && <Sep />}
                </span>
              ))}
            />
          ))}
        </Rows>
      </div>
    </>
  )
}
