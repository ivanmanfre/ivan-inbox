/* ==========================================================================
   LAYOUT B — ROSTER FIRST. `?lm=b`.

   The ranking leads: whose gated post pulled the most comments per 1,000
   followers, one dense line each, the offer and the rest of the numbers one
   tap away. The lane's own lead magnets follow as compact cards, because on
   every lane today they are few and the roster is the longer read.

   There is no post text here: `operator_gated_posts` returns the offer, the
   keyword and the counts, not the body, so the disclosure shows the offer the
   judge read rather than an invented excerpt.
   ========================================================================== */
import { Failed } from '../parts'
import { LM_TOP, type LmWindow } from '../../../lib/leadMagnets'
import {
  CallsNote, EMPTY_ROSTER, EYEBROW_OWN, EYEBROW_ROSTER, Fold, GatedDetail, LmCard,
  emptyOwn, gatedCounts, ownSub, rankLine,
  type OwnView, type RosterView,
} from './parts'

export function LayoutB({ own, roster, ownFail, rosterFail, weeks, thisYear, showAll, onShowAll, showAllOwn, onShowAllOwn, onRetryLm, onRetryGated }: {
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

  return (
    <>
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
                    {shown.map(p => <GatedDetail key={p.post_ref} p={p} thisYear={thisYear} />)}
                  </ul>
                  <Fold hidden={hidden} noun="roster posts" open={showAll} onToggle={onShowAll} />
                </>
              ) : <div className="a-lm-empty">{EMPTY_ROSTER}</div>}
            </>
          ) : null}
      </div>

      <div className="a-lm-sec" data-lm-sec="own">
        <div className="a-eyebrow">{EYEBROW_OWN}</div>
        {ownFail
          ? <Failed what="The lead magnets read" message={ownFail} onRetry={onRetryLm} />
          : own ? (
            <>
              <div className="a-lm-sub">{ownSub(own, thisYear, weeks)}</div>
              {own.rows.length
                ? <>
                    <div className="a-lm-cards">
                      {ownShown.map(r => <LmCard key={r.row.slug} row={r.row} posted={r.posted} weeks={weeks} thisYear={thisYear} />)}
                    </div>
                    <Fold hidden={ownHidden} noun="lead magnets" open={showAllOwn} onToggle={onShowAllOwn} />
                    <CallsNote note={own.callsNote} />
                  </>
                : <div className="a-lm-empty">{emptyOwn(own.since, thisYear)}</div>}
            </>
          ) : null}
      </div>
    </>
  )
}
