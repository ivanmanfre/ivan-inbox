/* ==========================================================================
   The audience block — READ-ONLY, under the Strategy sections (W16).

   Ivan, 2026-09-09T14:22Z, asked where the audience read should live: "not in
   dms but in strategy maybe". So it sits here, beneath the sections he writes
   and above the live filter spec, and it writes nothing: the Strategy editor
   stays the only writer on this screen, and a recommendation is decided
   through the idea flow that already exists, not from here. What this block
   adds is the decision LOG, so the choice and the reason are visible next to
   the numbers that prompted it.

   Three things this surface refuses to do:

     · show a number without the set it was counted over (every figure carries
       its denominator, and the operator-excluded count sits beside the raw
       one rather than replacing it),
     · call an unread thing empty (zero people for a lane the census says has
       191 renders as a load failure with a retry, not as a calm empty state),
     · say "return" for anything weaker than a bounded pair of posts
       ("observed across posts" is a different line, with its own words).

   Today, live, this renders `unavailable` on every lane: the audn_* views are
   built but not deployed. That is the honest state and it is the one the
   screenshots in OUT/inbox/screenshots show.
   ========================================================================== */
import { Badge } from '../../ds'
import { Cell, Group, Ledger, Row, relAge } from '../kit'
import { CalmEmpty, Failed } from './parts'
import { useAudience } from '../../hooks/useAudience'
import type { AudienceSummary, RecLine } from '../../lib/audience'
import type { ContentLane } from '../../lib/content'
import './content.css'

const DECISION_WORD: Record<string, string> = {
  accepted: 'accepted', rejected: 'rejected', deferred: 'deferred',
}

// How far the recommendation got, in words. Migration 08's ladder, said plainly
// — each phrase names the EVIDENCE, so none of them can be read as a promise
// about what happens next:
//   published    a published post resolved at the end of the chain
//   drafted      a draft row exists and no published post resolved
//   idea         the idea row exists and no draft does
//   recommended  a decision is on record for a ref with no idea row behind it
//   unknown      the chain could not be evaluated — SAID, never smoothed over
const LINK_WORD: Record<string, string> = {
  published: 'reached a published post',
  drafted: 'a draft exists',
  idea: 'idea only',
  recommended: 'recommended, no idea row',
  unknown: 'link unknown',
}

// The same ladder again, short enough to sit in a badge. Two vocabularies for
// one fact would be worse than one, so these are the SAME words cut down, never
// different ones: the badge is the glance target, the meta line is the sentence.
const LINK_BADGE: Record<string, string> = {
  published: 'published',
  drafted: 'drafted',
  idea: 'idea only',
  recommended: 'no idea row',
  unknown: 'link unknown',
}

// Run 04 A2, from Seat D's look at the real screen: the badge used to repeat
// the decision word the meta line already opens with, while the ladder state —
// the one fact nothing else on the row carries — had no badge at all. So the
// badge is the ladder now, and the decision word is said once.
//
// The decision log is a record, not a live signal, so every badge here is the
// neutral ring: a severity tone on this surface would claim something is
// happening now (ds/Badge: "severity tones are live signals only").
function LinkBadge({ r }: { r: RecLine }) {
  return <Badge tone="neutral" variant="ring">{LINK_BADGE[r.link_state] ?? 'link unknown'}</Badge>
}

function Numbers({ s }: { s: AudienceSummary }) {
  const { people, labels, returns } = s
  const of = `of ${people.adjusted} people`
  return (
    <>
      <Ledger>
        <Cell
          label="Relevant people"
          value={people.adjusted}
          note={`${people.raw} raw · ${people.operators} operator excluded`}
        />
        <Cell label="Positive" value={labels.positive} note={of} />
        <Cell label="Borderline" value={labels.borderline} note={of} />
        <Cell label="Negative" value={labels.negative} note={of} />
        <Cell
          label="Unknown"
          value={labels.unknown}
          note={`${of} · never counted as a no`}
        />
      </Ledger>
      <Ledger>
        <Cell
          label="Confirmed returns"
          value={returns.confirmed}
          note={`${of} · a second post at least 24h after the first`}
        />
        <Cell
          label="Observed across posts"
          value={returns.observedAcrossPosts}
          note="seen on 2+ posts · weaker than a confirmed return"
        />
        <Cell
          label="Return timing unknown"
          value={returns.timingUnknown}
          note={`${of} · could not be bounded`}
        />
      </Ledger>
    </>
  )
}

function Ranks({ s }: { s: AudienceSummary }) {
  if (!s.ranks.length) {
    return (
      <div className="a-ct-sub">
        No matched-age snapshots yet. Ranks appear after the first 7/14-day captures.
      </div>
    )
  }
  return (
    <>
      {s.ranks.map(r => (
        <Row
          key={r.post_social_id}
          title={r.rank == null || r.eligible_n == null
            ? 'unranked'
            : `#${r.rank} of ${r.eligible_n} eligible`}
          sub={<span className="a-aud-id">{r.post_social_id}</span>}
          subWrap
          tail={
            <span className="a-mono a-dim">
              {r.reactions == null ? 'no reading' : `${r.reactions} reactions`}
              {r.target_age_days == null ? '' : ` at ${r.target_age_days}d`}
            </span>
          }
        />
      ))}
    </>
  )
}

/** Exported for the unit suite ONLY. A phrase that has never been rendered is
    a phrase nobody has checked, and `recommended, no idea row` / `link unknown`
    were exactly that until Run 04 A2 — type-checked, unit-tested on the state
    machine, and never once produced as text. The tests render THIS, so the
    assertion is about the shipped markup rather than about a copy of it. */
export function Recommendations({ s }: { s: AudienceSummary }) {
  if (s.recommendationsBlocked) {
    // Signed out, PostgREST answers this lane's idea bank with zero rows and no
    // error. "None yet" would be a sentence about a table nobody read.
    return (
      <div className="a-ct-sub a-sev-urgent">
        This lane's idea bank read as empty over a store that is not empty, so the
        recommendations were not read. Sign in and refresh.
      </div>
    )
  }
  if (!s.recommendations.length) {
    return (
      <div className="a-ct-sub">
        No audience recommendation has been written into this lane's idea bank yet.
      </div>
    )
  }
  return (
    <>
      {s.recommendations.map(r => (
        <Row
          key={r.id}
          title={r.title}
          titleWrap
          sub={r.sub ?? undefined}
          subWrap
          meta={
            /* The ladder state sits SECOND, ahead of the reason. At 375px the
               reason wraps to three lines, and behind it the strongest new fact
               on this row ("reached a published post") broke across the last
               two and read as the tail of a sentence about something else.
               A row with no decision says so and names the status it is
               actually sitting at — never a decision word nobody chose. */
            <span className="a-aud-meta">
              {r.decision
                ? <>{DECISION_WORD[r.decision]}{r.decided_at ? ` ${relAge(r.decided_at)}` : ''}</>
                : r.undecided_status
                  ? `no decision · ${r.undecided_status}`
                  : 'no decision recorded'}
              {' · '}{LINK_WORD[r.link_state] ?? 'link unknown'}
              {r.reason ? <> · {r.reason}</> : null}
            </span>
          }
          tail={<LinkBadge r={r} />}
        />
      ))}
      {/* The note says which of the two readings produced the states above, and
          it changes when the reading does. A fixed sentence here would go on
          claiming the link view is unavailable long after it was applied — or,
          worse, imply publication is tracked on a screen that could not read
          the view. `linkSource` is the summary's own record of what happened. */}
      <div className="a-ct-sub">
        {s.linkSource === 'view'
          ? <>
              Decisions are made in the idea flow. How far each one got is read from
              the recommendation link view: idea → draft → published post, for a
              client lane and for Ivan's alike. A line with no row in that view yet
              shows only what its own idea store proves.
            </>
          : <>
              Decisions are made in the idea flow. The recommendation link view was
              not read, so "a draft exists" is as far as this can follow a
              recommendation. Nothing on this screen can see whether a post went live.
            </>}
      </div>
    </>
  )
}

export function AudienceBlock({ lane }: { lane: ContentLane }) {
  // The one hook, at the top, before any branch. A hook placed after an early
  // return blanked every DM conversation in this app on 2026-09-09.
  const a = useAudience(lane)

  const head = {
    className: 'a-aud',
    label: 'Audience (read-only)',
    tail: <span className="a-dim a-mono">{lane} · read {relAge(a.loadedAt)}</span>,
  }

  if (a.loading && !a.summary) {
    return (
      <Group {...head} pad>
        <div className="a-ct-sub a-aud-hold">Reading the audience views…</div>
      </Group>
    )
  }

  if (a.error || !a.summary) {
    return (
      <Group {...head} pad>
        <Failed
          what="The audience block"
          message={a.error ?? 'audience unavailable'}
          onRetry={a.refresh}
          loadedAt={a.loadedAt}
        />
      </Group>
    )
  }

  const s = a.summary

  if (s.state === 'unavailable') {
    return (
      <Group {...head} pad>
        <Failed
          what="The audience block"
          message={s.message ?? 'audience unavailable'}
          onRetry={a.refresh}
          loadedAt={null}
        >
          <span className="a-dim">Views not deployed yet.</span>
        </Failed>
      </Group>
    )
  }

  if (s.state === 'failed_nonempty_expected') {
    return (
      <Group {...head} pad>
        {/* The rule this exists for: an empty result over a set we KNOW is not
            empty is a failure, and it must never be rendered as a calm zero. */}
        <Failed
          what="The audience block"
          message={s.message ?? 'no rows for a lane that has people on record'}
          onRetry={a.refresh}
          loadedAt={null}
        />
      </Group>
    )
  }

  if (s.state === 'empty') {
    return (
      <Group {...head} pad>
        <CalmEmpty
          line="No audience rows for this lane."
          sub="Nothing has engaged with a post in this lane yet, and nothing was expected to."
          loadedAt={a.loadedAt}
        />
      </Group>
    )
  }

  return (
    <Group
      className="a-aud"
      label={head.label}
      tail={
        <span className="a-aud-tail">
          {s.state === 'unknown' && <Badge tone="neutral" variant="ring">all labels unknown</Badge>}
          <span className="a-dim a-mono">{lane} · read {relAge(a.loadedAt)}</span>
        </span>
      }
      pad
    >
      <div className="a-ct-sub">
        Who engaged, what they were judged to be, and what came of the recommendations.
        Read-only: this block never writes an idea, a decision or a schedule.
      </div>

      {s.state === 'unknown' && (
        <div className="a-ct-sub">{s.message}</div>
      )}

      <Numbers s={s} />

      <div className="a-aud-sec">
        <div className="a-eyebrow">Top posts by matched-age rank</div>
        <Ranks s={s} />
      </div>

      <div className="a-aud-sec">
        <div className="a-eyebrow">Monthly median reactions</div>
        {s.monthly.length ? s.monthly.map(m => (
          <Row
            key={`${m.month}-${m.target_age_days}`}
            title={m.month ?? 'unknown month'}
            sub={`${m.n ?? 0} posts${m.target_age_days == null ? '' : ` at ${m.target_age_days}d`}${m.basis ? ` · ${m.basis}` : ''}`}
            subWrap
            tail={
              <span className="a-mono a-dim">
                {m.median_reactions == null ? 'no reading' : `${m.median_reactions} median`}
              </span>
            }
          />
        )) : (
          <div className="a-ct-sub">No month has enough matched-age snapshots to take a median.</div>
        )}
      </div>

      <div className="a-aud-sec">
        <div className="a-eyebrow">Topics</div>
        {s.topics.length ? s.topics.map(t => (
          <Row
            key={t.label}
            title={t.label}
            titleWrap
            sub={`${t.events ?? 0} events · ${t.posts ?? 0} posts`}
            subWrap
            tail={<span className="a-mono a-dim">{t.people ?? 0} people</span>}
          />
        )) : (
          <div className="a-ct-sub">No post in this lane carries a topic yet.</div>
        )}
      </div>

      <div className="a-aud-sec">
        <div className="a-eyebrow">Recommendations and decisions</div>
        <Recommendations s={s} />
      </div>

      {/* A source that failed while the core held is NAMED. A section that
          silently rendered nothing would read as "no rows", which is the exact
          lie this block is built to refuse. */}
      {s.partial.length > 0 && (
        <div className="a-ct-sub a-aud-partial">
          Some of this did not load: {s.partial.join(' · ')}
        </div>
      )}
    </Group>
  )
}
