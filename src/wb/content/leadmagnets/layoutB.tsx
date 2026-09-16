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
import { Button } from '../../../ds'
import { Failed } from '../parts'
import { num } from '../../../lib/benchmark'
import { LM_TOP, type LmWindow } from '../../../lib/leadMagnets'
import {
  CallsNote, EMPTY_ROSTER, EYEBROW_OWN, EYEBROW_ROSTER, GatedDetail, LmCard,
  emptyOwn, ownSub, rosterLine,
  type OwnView, type RosterView,
} from './parts'

export function LayoutB({ own, roster, ownFail, rosterFail, weeks, thisYear, showAll, onShowAll, onRetry }: {
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

  return (
    <>
      <div className="a-lm-sec" data-lm-sec="roster">
        <div className="a-eyebrow">{EYEBROW_ROSTER}</div>
        {rosterFail
          ? <Failed what="The gated posts read" message={rosterFail} onRetry={onRetry} />
          : roster ? (
            <>
              <div className="a-lm-sub">{rosterLine(roster.sized, roster.roster.length, roster.judged)}</div>
              {roster.roster.length ? (
                <>
                  <ul className="a-lm-tbl" data-cols="3">
                    {shown.map(p => <GatedDetail key={p.post_ref} p={p} thisYear={thisYear} />)}
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

      <div className="a-lm-sec" data-lm-sec="own">
        <div className="a-eyebrow">{EYEBROW_OWN}</div>
        {ownFail
          ? <Failed what="The lead magnets read" message={ownFail} onRetry={onRetry} />
          : own ? (
            <>
              <div className="a-lm-sub">{ownSub(own, thisYear)}</div>
              {own.posted.length
                ? <div className="a-lm-cards">{own.posted.map(r => <LmCard key={r.slug} row={r} thisYear={thisYear} />)}</div>
                : <div className="a-lm-empty">{emptyOwn(weeks)}</div>}
              <CallsNote note={own.callsNote} />
            </>
          ) : null}
      </div>
    </>
  )
}
