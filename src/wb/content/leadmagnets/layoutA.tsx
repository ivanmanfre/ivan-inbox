/* ==========================================================================
   LAYOUT A — LEDGER FIRST. `?lm=a`, and the default.

   The three numbers that answer "is the gate working" sit at the top as a
   ledger, each carrying its own denominator. Then the lane's own lead magnets,
   one row each, then the roster of other accounts running the same play.
   Reading order: what we did, then what everyone else did.
   ========================================================================== */
import { Cell, Ledger } from '../../kit'
import { Failed } from '../parts'
import { num } from '../../../lib/benchmark'
import { dayLabel } from '../../../lib/reach'
import { LM_TOP, perThousand, type LmWindow } from '../../../lib/leadMagnets'
import {
  CallsNote, EMPTY_ROSTER, EYEBROW_OWN, EYEBROW_ROSTER, Fold, GatedLine, LmLine,
  activeLine, emptyOwn, gatedCounts, ownSub, plural, rankLine,
  type OwnView, type RosterView,
} from './parts'

export function LayoutA({ own, roster, ownFail, rosterFail, weeks, thisYear, showAll, onShowAll, showAllOwn, onShowAllOwn, onRetryLm, onRetryGated }: {
  own: OwnView | null
  roster: RosterView | null
  ownFail: string | null
  rosterFail: string | null
  weeks: LmWindow
  thisYear: number
  showAll: boolean
  onShowAll: () => void
  showAllOwn: boolean
  onShowAllOwn: () => void
  onRetryLm?: () => void
  onRetryGated?: () => void
}) {
  const shown = roster ? (showAll ? roster.roster : roster.roster.slice(0, LM_TOP)) : []
  const hidden = roster ? roster.roster.length - shown.length : 0
  const ownShown = own ? (showAllOwn ? own.rows : own.rows.slice(0, LM_TOP)) : []
  const ownHidden = own ? own.rows.length - ownShown.length : 0
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
          value={own && own.rows.length ? num(own.clicks) : null}
          emptyText={own ? 'No clicks yet' : 'No read'}
          note={!own
            ? 'The lead magnets read did not land'
            : own.rows.length
              ? `over ${plural(own.rows.length, 'lead magnet')} since ${sinceLabel}`
              : `No lead magnet shows a post or a click since ${sinceLabel}`}
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
          ? <Failed what="The lead magnets read" message={ownFail} onRetry={onRetryLm} />
          : own ? (
            <>
              <div className="a-lm-sub">{ownSub(own, thisYear, weeks)}</div>
              {/* db/086: how much of the lane's own output names the lead magnet it carries.
                  Quiet sub line under the section summary; absent on an older RPC. */}
              {own.attribution ? <div className="a-lm-foot" data-lm-attribution="1">{own.attribution}</div> : null}
              {own.rows.length
                ? <>
                    <ul className="a-lm-tbl" data-cols="4">
                      {ownShown.map(r => <LmLine key={r.row.slug} row={r.row} posted={r.posted} weeks={weeks} thisYear={thisYear} />)}
                    </ul>
                    <Fold hidden={ownHidden} noun="lead magnets" open={showAllOwn} onToggle={onShowAllOwn} />
                    <CallsNote note={own.callsNote} />
                  </>
                : <div className="a-lm-empty">{emptyOwn(own.since, thisYear)}</div>}
            </>
          ) : null}
      </div>

      <div className="a-lm-sec" data-lm-sec="roster">
        <div className="a-eyebrow">{EYEBROW_ROSTER}</div>
        {rosterFail
          ? <Failed what="The gated posts read" message={rosterFail} onRetry={onRetryGated} />
          : roster ? (
            <>
              <div className="a-lm-sub">{gatedCounts(roster, thisYear)} {rankLine(roster.sized, roster.roster.length)}</div>
              {roster.roster.length ? (
                <>
                  <ul className="a-lm-tbl" data-cols="3">
                    {shown.map(p => <GatedLine key={p.post_ref} p={p} thisYear={thisYear} />)}
                  </ul>
                  <Fold hidden={hidden} noun="roster posts" open={showAll} onToggle={onShowAll} />
                </>
              ) : <div className="a-lm-empty">{EMPTY_ROSTER}</div>}
            </>
          ) : null}
      </div>
    </>
  )
}
