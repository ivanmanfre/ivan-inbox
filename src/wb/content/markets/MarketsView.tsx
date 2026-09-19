/* ==========================================================================
   MARKETS — Strategy's sixth view. One client's market, live, in one call.

   `operator_market_readout('clientops', lane)` (db/100) returns the whole
   screen, so this view makes exactly one request and every number on it comes
   out of that one payload. The static readout in
   tools/client-research/readout renders the same reading as a PDF-shaped page;
   this is the same reading in the inbox's own grammar.

   THE ORDER IS THE ANSWER FIRST. One number, its sentence, the ask ledger,
   then the stored readings, then the offers one block at a time, then the
   ideas that repeat, then the lane's own posts, then what we would test. Each
   section opens with its own number, so nothing needs a scroll to be read.

   TWO POPULATIONS, NEVER MIXED. The accounts we follow for you are the roster
   the client and Ivan agreed on. The wider feed is every other author the
   harvest stored, it is unvetted, and it closes the screen in a table of its
   own. Every sentence says which of the two it counts.

   All arithmetic and every sentence live in src/lib/markets.ts. This file
   selects and arranges.
   ========================================================================== */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '../../../ds'
import { Group } from '../../kit'
import { readSwr, writeSwr } from '../../../lib/swr'
import {
  ACCOUNTS, INSIGHTS_EMPTY, answer, askLabel, askRows, coverageLine, dec, fetchMarketReadout,
  firstLine, floorReason, int, marketCards, offerLine, one, ownState, planThinLine, plu,
  shapeLine, shownTests, testCopy, themeLine, widerLine, widerNote, widerTitle,
  type MarketOffer, type MarketRead, type MarketReadout,
} from '../../../lib/markets'
import '../content.css'
import './markets.css'

export type MarketsState = 'loading' | 'ready' | 'denied' | 'failed'

const swrQuery = (lane: string) => `market:${lane}`

/* ---------------------------------------------------------------- pieces */

function Figure({ value, unit }: { value: string; unit: string }) {
  return (
    <p className="a-mk-fig">
      <b className="a-mk-n">{value}</b>
      <span className="a-mk-u">{unit}</span>
    </p>
  )
}

/** Where one offer sits against the median of the ranked ones. */
function Reach({ value, median, max }: { value: number | null; median: number | null; max: number | null }) {
  const top = Number(max || 0)
  if (!top || value === null) return null
  const w = Math.max(1, Math.round((Number(value) / top) * 100))
  const m = median === null ? null : Math.min(100, Math.round((Number(median) / top) * 100))
  return (
    <div className="a-mk-reach" role="img"
      aria-label={`${one(value)} comments for every thousand followers, against a median of ${one(median)}.`}>
      <span className="a-mk-reach-fill" style={{ width: `${w}%` }} />
      {m === null ? null : <span className="a-mk-reach-med" style={{ insetInlineStart: `${m}%` }} />}
    </div>
  )
}

function OfferBlock({ o, i, m }: { o: MarketOffer; i: number; m: MarketReadout }) {
  const rank = m.offers.rank
  const cta = o.cta_kind === 'link' ? m.offers.cta.link
    : o.cta_kind === 'comment_gate' ? m.offers.cta.comment_gate
      : o.cta_kind === 'dm_gate' ? m.offers.cta.dm_gate : 0
  return (
    <li className="a-mk-offer">
      <p className="a-mk-rank">{String(i + 1).padStart(2, '0')}</p>
      <div className="a-mk-omain">
        <h4 className="a-mk-ot">{o.offer ? `“${o.offer}”` : 'An offer we could not name'}</h4>
        <p className="a-mk-ow">
          {o.author} published it and asked for {askLabel(o.cta_kind)}
          {o.gate_keyword ? `, by writing “${o.gate_keyword}”` : ''}
          {'. '}
          {int(o.follower_count)} {plu(o.follower_count, 'person', 'people')} followed the account when we read it,
          {' '}and {int(o.comments)} {plu(o.comments, 'comment')} came back.
        </p>
        <Reach value={o.per_1k} median={rank.median_per1k} max={rank.max_per1k} />
        <p className="a-mk-legend">
          <span>This offer {one(o.per_1k)}</span>
          <span>Median of the {int(m.offers.ranked_count)} we could rank {one(rank.median_per1k)}</span>
        </p>
        {o.post_ref ? <a className="a-mk-open" href={o.post_ref} target="_blank" rel="noreferrer">Open the post</a> : null}
      </div>
      <div className="a-mk-oside">
        <p className="a-mk-k">What we would copy</p>
        <p className="a-mk-take">
          {one(o.per_1k)} comments for every thousand followers
          {o.vs_median && m.offers.ranked_count > 1 ? `, ${one(o.vs_median)} times the median of ${one(rank.median_per1k)}.` : '.'}
          {' '}The ask was {askLabel(o.cta_kind)}, which {int(cta)} of the {int(m.offers.roster_offers)} offers from {ACCOUNTS} used.
        </p>
      </div>
    </li>
  )
}

function OfferLine({ o, m }: { o: MarketOffer; m: MarketReadout }) {
  return (
    <li className="a-mk-row">
      <p className="a-mk-t">
        {o.post_ref
          ? <a className="a-mk-t-a" href={o.post_ref} target="_blank" rel="noreferrer">{o.offer || 'An offer we could not name'}</a>
          : (o.offer || 'An offer we could not name')}
      </p>
      <p className="a-mk-figs">
        <span className="a-mk-f">{o.author}</span>
        {o.follower_count ? <span className="a-mk-f">{int(o.follower_count)} {plu(o.follower_count, 'follower')}</span> : null}
        <span className="a-mk-f">{int(o.comments)} {plu(o.comments, 'comment')}</span>
        <span className="a-mk-f">{o.per_1k === null ? 'unranked' : `${one(o.per_1k)} per 1,000`}</span>
      </p>
      {o.why_followers || o.why_comments
        ? <p className="a-mk-why">We did not rank it because {floorReason(o, m.floor)}.</p>
        : null}
    </li>
  )
}

/* ---------------------------------------------------------------- the panel */

/** The whole surface, pure: the read goes in, nothing is fetched. The tests render this one. */
export function MarketsPanel({ read, onRetry }: { read: MarketRead | null; onRetry?: () => void }) {
  const state: MarketsState = !read ? 'loading' : read.kind === 'ready' ? 'ready' : read.kind
  const [showWider, setShowWider] = useState(false)

  const m = read && read.kind === 'ready' ? read.data : null
  const a = useMemo(() => (m ? answer(m) : null), [m])
  const own = useMemo(() => (m ? ownState(m) : null), [m])
  const cards = useMemo(() => (m ? marketCards(m, m.display_name) : []), [m])
  const tests = useMemo(() => (m ? shownTests(m) : []), [m])

  if (!m || !a || !own) {
    return (
      <div className="a-mk" data-mk-state={state}>
        <Group className="a-mk-g" label="Markets" pad>
          {state === 'loading'
            ? <p className="a-mk-sub">Reading this market\u2026</p>
            : (
              <div className="a-mk-fail">
                <p className="a-mk-sub">{read && read.kind !== 'ready' ? read.message : 'The market readout failed.'}</p>
                {onRetry ? <Button size="sm" variant="quiet" onClick={onRetry}>Read it again</Button> : null}
              </div>
            )}
        </Group>
      </div>
    )
  }

  const top3 = m.offers.ranked.slice(0, 3)
  const restRanked = m.offers.ranked.slice(3)
  const test = tests[0] ?? null
  const testCopyOne = test ? testCopy(test, m) : null

  return (
    <div className="a-mk" data-mk-state={state} data-mk-lane={m.client_id}>
      <Group className="a-mk-g" label={`${m.display_name}, what works in this market`} pad>
        <div className="a-mk-body">

          {/* 1. THE ANSWER. One number and one sentence, and nothing else. */}
          <section className="a-mk-fold">
            <Figure value={a.figure} unit={a.unit} />
            <p className="a-mk-lede">{a.line}</p>
          </section>

          {/* 2. WHAT PULLS COMMENTS HERE. Three cards, market readings only: the
              own-side, outreach, gap and cross-client readings are about us and
              never belong on a screen about the market. */}
          <section className="a-mk-sec">
            <h3 className="a-mk-h">What pulls comments here</h3>
            {cards.length === 0
              ? <p className="a-mk-empty">{INSIGHTS_EMPTY}</p>
              : (
                <ul className="a-mk-cards">
                  {cards.map(c => (
                    <li className="a-mk-card" key={c.section}>
                      <h4 className="a-mk-ch">{c.headline}</h4>
                      {c.figure ? (
                        <p className="a-mk-cf">
                          {c.figure}
                          {c.base ? <span className="a-mk-cb">{c.base}</span> : null}
                        </p>
                      ) : null}
                      {c.change ? <p className="a-mk-cd"><b>we do:</b> {c.change}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
          </section>

          {/* 3. THE LOUDEST OFFERS, as lines. The blocks keep everything they
              carried, behind one disclosure. */}
          <section className="a-mk-sec">
            <h3 className="a-mk-h">
              Loudest offers
              <span className="a-mk-tag">{int(m.offers.ranked_count)} ranked of {int(m.offers.roster_offers)}</span>
            </h3>
            {top3.length ? (
              <ul className="a-mk-lines">
                {top3.map(o => (
                  <li className="a-mk-line" key={o.post_ref}>
                    {o.post_ref
                      ? <a className="a-mk-t-a" href={o.post_ref} target="_blank" rel="noreferrer">{offerLine(o)}</a>
                      : offerLine(o)}
                  </li>
                ))}
              </ul>
            ) : <p className="a-mk-empty">{shapeLine(m)}</p>}
            {restRanked.length || m.offers.below.length ? (
              <details className="a-mk-d2">
                <summary>{int(restRanked.length + m.offers.below.length)} more</summary>
                <div className="a-mk-dd">
                  <p className="a-mk-sub">{shapeLine(m)}</p>
                  <ul className="a-mk-offers">
                    {restRanked.map((o, i) => <OfferBlock key={o.post_ref} o={o} i={i + 3} m={m} />)}
                  </ul>
                  {m.offers.below.length ? (
                    <ul className="a-mk-tbl">{m.offers.below.map(o => <OfferLine key={o.post_ref} o={o} m={m} />)}</ul>
                  ) : null}
                </div>
              </details>
            ) : null}
          </section>

          {/* 4. ONE TEST. */}
          <section className="a-mk-sec">
            <h3 className="a-mk-h">First test</h3>
            {testCopyOne && test ? (
              <div className="a-mk-test">
                <h4 className="a-mk-ch">{testCopyOne.title}</h4>
                <p className="a-mk-sub">{testCopyOne.body}</p>
                <p className="a-mk-cb">on a base of {int(test.base)}</p>
              </div>
            ) : <p className="a-mk-empty">{planThinLine(m)}</p>}
          </section>

          {/* 5. THE WORKING. Everything true that the first screen does not need:
              how they ask, the ideas that repeat, this lane's own posts against
              the market, the offers below the floor, the unvetted feed, and how
              much of the window we have read. */}
          <details className="a-mk-work">
            <summary>The working</summary>
            <div className="a-mk-dd">

              <section className="a-mk-sec">
                <h3 className="a-mk-h">How the accounts we follow ask</h3>
                <ul className="a-mk-asklist">
                  {askRows(m).map(r => (
                    <li className="a-mk-ask" key={r.id}>
                      <b className="a-mk-askv">{int(r.value)}</b>
                      <span className="a-mk-askl">{r.label}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="a-mk-sec">
                <h3 className="a-mk-h">
                  Ideas that came back
                  <span className="a-mk-tag">{int(m.themes.total)} named</span>
                </h3>
                <p className="a-mk-sub">{themeLine(m)}</p>
                {m.themes.rows.length ? (
                  <div className="a-mk-tiles">
                    {m.themes.rows.slice(0, 6).map(t => (
                      <article className="a-mk-tile" key={t.theme}>
                        <h4 className="a-mk-tt">{t.theme}</h4>
                        <p className="a-mk-figs">
                          <span className="a-mk-f">{int(t.posts)} {plu(t.posts, 'post')}</span>
                          <span className="a-mk-f">{int(t.authors)} {plu(t.authors, 'account')}</span>
                          <span className="a-mk-f">median {dec(t.med)} comments</span>
                        </p>
                        {firstLine(t.ex_text) ? (
                          <p className="a-mk-q">
                            {t.ex_url
                              ? <a className="a-mk-t-a" href={t.ex_url} target="_blank" rel="noreferrer">{firstLine(t.ex_text)}</a>
                              : firstLine(t.ex_text)}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="a-mk-sec">
                <h3 className="a-mk-h">
                  Your own posts against that
                  <span className="a-mk-tag">{int(m.own.posts)} {plu(m.own.posts, 'post')}</span>
                </h3>
                <p className="a-mk-sub">{own.line}</p>
                {own.kind === 'withheld' ? <p className="a-mk-withheld">{own.measured}</p> : null}
                {own.kind === 'ready' ? (
                  <ul className="a-mk-tbl">
                    {own.rows.map(r => (
                      <li key={r.id}>
                        <div className="a-mk-row" data-mk-you={r.you ? 'true' : undefined}>
                          <p className="a-mk-t">{r.label}<span className="a-mk-tag">{r.display}</span></p>
                          <p className="a-mk-note">{r.base}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {m.own.best?.url ? (
                  <p className="a-mk-note">
                    <a className="a-mk-t-a" href={m.own.best.url} target="_blank" rel="noreferrer">Open your best post</a>
                    {m.own.best.comments === null ? null : `, ${int(m.own.best.comments)} ${plu(m.own.best.comments, 'comment')}.`}
                  </p>
                ) : null}
              </section>

              {m.offers.wider.length ? (
                <section className="a-mk-sec">
                  <h3 className="a-mk-h">
                    {widerTitle}
                    <span className="a-mk-tag">{int(m.offers.wider_offers)} {plu(m.offers.wider_offers, 'offer')}</span>
                  </h3>
                  <p className="a-mk-sub">{widerNote(m)}</p>
                  <div className="a-mk-more">
                    <Button size="sm" variant="quiet" onClick={() => setShowWider(v => !v)} aria-expanded={showWider}>
                      {showWider ? 'Hide' : 'Show'} the {int(m.offers.wider.length)} unvetted {plu(m.offers.wider.length, 'offer')}
                    </Button>
                  </div>
                  {showWider
                    ? <ul className="a-mk-tbl">{m.offers.wider.map(o => <OfferLine key={o.post_ref} o={o} m={m} />)}</ul>
                    : null}
                </section>
              ) : null}

              <section className="a-mk-sec">
                <h3 className="a-mk-h">How much of this market we have read</h3>
                <p className="a-mk-sub">{coverageLine(m)}</p>
                <p className="a-mk-sub">{widerLine(m)}</p>
                {tests.length > 1 ? (
                  <>
                    <h3 className="a-mk-h">The other tests</h3>
                    <ol className="a-mk-plan">
                      {tests.slice(1).map(t => {
                        const c = testCopy(t, m)
                        return (
                          <li className="a-mk-plan-i" key={t.kind}>
                            <h4 className="a-mk-tt">{c.title}</h4>
                            <p className="a-mk-sub">{c.body}</p>
                            <p className="a-mk-cb">on a base of {int(t.base)}</p>
                          </li>
                        )
                      })}
                    </ol>
                  </>
                ) : null}
              </section>

            </div>
          </details>
        </div>
      </Group>
    </div>
  )
}

/* ---------------------------------------------------------------- the view */

/**
 * SWR first paint, the shape DMs uses (src/hooks/useInbox.ts): a cached payload
 * seeds state synchronously inside a useMemo so the first frame already carries
 * the market, then the live read replaces it and is written back only after it
 * resolved. A failed read never becomes a cache.
 */
export function MarketsView({ lane }: { lane: string }) {
  const seed = useMemo(() => readSwr<MarketReadout>(swrQuery(lane)), [lane])
  const [read, setRead] = useState<MarketRead | null>(
    seed ? { kind: 'ready', data: seed.payload, readAt: seed.savedAt } : null,
  )
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    void fetchMarketReadout(lane).then(r => {
      if (!live) return
      setRead(r)
      if (r.kind === 'ready') writeSwr(swrQuery(lane), r.data)
    })
    return () => { live = false }
  }, [lane, tick])

  const retry = useCallback(() => setTick(t => t + 1), [])
  return <MarketsPanel read={read} onRetry={retry} />
}
