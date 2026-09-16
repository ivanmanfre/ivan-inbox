/* ==========================================================================
   LAYOUT A — LEDGER FIRST. `?lm=a`, and the default.

   The three numbers that answer "is the gate working" sit at the top as a
   ledger, each carrying its own denominator. Then the lane's own lead magnets,
   one row each, then the roster of other accounts running the same play.
   Reading order: what we did, then what everyone else did.
   ========================================================================== */
import { Button } from '../../../ds'
import { Cell, Ledger } from '../../kit'
import { Failed } from '../parts'
import { num } from '../../../lib/benchmark'
import { dayLabel } from '../../../lib/reach'
import { LM_TOP, perThousand, type LmWindow } from '../../../lib/leadMagnets'
import {
  CallsNote, EMPTY_ROSTER, EYEBROW_OWN, EYEBROW_ROSTER, GatedLine, LmLine,
  activeLine, emptyOwn, gatedCounts, ownSub, plural, rankLine,
  type OwnView, type RosterView,
} from './parts'

export function LayoutA({ own, roster, ownFail, rosterFail, weeks, thisYear, showAll, onShowAll, onRetry }: {
  own: OwnView | null
  roster: RosterView | null
  ownFail: string | null
  rosterFail: string | null
  weeks: LmWindow
  thisYear: number
  showAll: boolean
  onShowAll: () => void
  onRetry?: () => void
}) {
  const shown = roster ? (showAll ? roster.roster : roster.roster.slice(0, LM_TOP)) : []
  const hidden = roster ? roster.roster.length - shown.length : 0
  const best = roster?.best ?? null
  const sinceLabel = own ? dayLabel(own.since, thisYear) : ''
  const bestRate = best ? perThousand(best.comments, best.follower_count) : null

  return (
    <>
      <Ledger>
        <Cell
          label="Lead magnets posted"
          value={own ? num(own.postedInWindow) : null}
          emptyText="No read"
          note={own
            ? activeLine(own.rows.length, own.total, own.since, thisYear)
            : 'The lead magnets read did not land'}
        />
        <Cell
          label="CTA clicks"
          value={own ? num(own.clicks) : null}
          emptyText="No read"
          note={own
            ? `over ${plural(own.rows.length, 'lead magnet')} since ${sinceLabel}`
            : 'The lead magnets read did not land'}
        />
        <Cell
          label="Gated posts on the roster"
          value={roster ? num(roster.roster.length) : null}
          emptyText="No read"
          note={roster ? gatedCounts(roster, thisYear) : 'The roster read did not land'}
        />
        <Cell
          label="Best per 1k followers"
          value={bestRate === null ? null : bestRate.toFixed(1)}
          emptyText={roster ? 'No sized author' : 'No read'}
          note={roster
            ? `${best && bestRate !== null ? `${best.author}, ` : ''}${num(roster.sized)} of ${num(roster.roster.length)} carry a follower count`
            : 'The roster read did not land'}
        />
      </Ledger>

      <div className="a-lm-sec" data-lm-sec="own">
        <div className="a-eyebrow">{EYEBROW_OWN}</div>
        {ownFail
          ? <Failed what="The lead magnets read" message={ownFail} onRetry={onRetry} />
          : own ? (
            <>
              <div className="a-lm-sub">{ownSub(own, thisYear, weeks)}</div>
              {own.rows.length
                ? <>
                    <ul className="a-lm-tbl" data-cols="4">
                      {own.rows.map(r => <LmLine key={r.row.slug} row={r.row} posted={r.posted} weeks={weeks} thisYear={thisYear} />)}
                    </ul>
                    <CallsNote note={own.callsNote} />
                  </>
                : <div className="a-lm-empty">{emptyOwn(own.since, thisYear)}</div>}
            </>
          ) : null}
      </div>

      <div className="a-lm-sec" data-lm-sec="roster">
        <div className="a-eyebrow">{EYEBROW_ROSTER}</div>
        {rosterFail
          ? <Failed what="The gated posts read" message={rosterFail} onRetry={onRetry} />
          : roster ? (
            <>
              <div className="a-lm-sub">{gatedCounts(roster, thisYear)} {rankLine(roster.sized, roster.roster.length)}</div>
              {roster.roster.length ? (
                <>
                  <ul className="a-lm-tbl" data-cols="3">
                    {shown.map(p => <GatedLine key={p.post_ref} p={p} thisYear={thisYear} />)}
                  </ul>
                  {hidden > 0 || showAll ? (
                    <div className="a-lm-more">
                      <Button variant="quiet" onClick={onShowAll}>
                        {showAll ? 'Show fewer' : `Show ${num(hidden)} more`}
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : <div className="a-lm-empty">{EMPTY_ROSTER}</div>}
            </>
          ) : null}
      </div>
    </>
  )
}
