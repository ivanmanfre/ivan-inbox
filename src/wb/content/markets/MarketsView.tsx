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
  firstLine, floorReason, insightBase, insightRows, int, one, ownState, planThinLine, plu,
  shapeLine, testCopy, themeLine, widerNote, widerTitle,
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
  const [showRest, setShowRest] = useState(false)

  const m = read && read.kind === 'ready' ? read.data : null
  const a = useMemo(() => (m ? answer(m) : null), [m])
  const own = useMemo(() => (m ? ownState(m) : null), [m])
  const readings = useMemo(() => (m ? insightRows(m) : []), [m])

  if (!m || !a || !own) {
    return (
      <div className="a-mk" data-mk-state={state}>
        <Group className="a-mk-g" label="Markets" pad>
          {state === 'loading'
            ? <p className="a-mk-sub">Reading this market…</p>
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

  const top5 = m.offers.ranked.slice(0, 5)
  const rest = [...m.offers.ranked.slice(5), ...m.offers.below]

  return (
    <div className="a-mk" data-mk-state={state} data-mk-lane={m.client_id}>
      <Group className="a-mk-g" label={`${m.display_name}, what works in this market`} pad>
        <div className="a-mk-body">

          {/* 1. THE ANSWER. One number, its sentence, how those accounts ask. */}
          <section className="a-mk-fold">
            <div className="a-mk-fold-main">
              <Figure value={a.figure} unit={a.unit} />
              {a.lines.map((l, i) => <p className="a-mk-lede" key={i}>{l}</p>)}
            </div>
            <aside className="a-mk-asks">
              <p className="a-mk-k">How the accounts we follow ask</p>
              <ul className="a-mk-asklist">
                {askRows(m).map(r => (
                  <li className="a-mk-ask" key={r.id}>
                    <b className="a-mk-askv">{int(r.value)}</b>
                    <span className="a-mk-askl">{r.label}</span>
                  </li>
                ))}
              </ul>
              <p className="a-mk-note">{coverageLine(m)}</p>
            </aside>
          </section>

          {/* 2. THE READINGS. What the corpus itself says, stored by the mining pass. */}
          <section className="a-mk-sec">
            <h3 className="a-mk-h">
              What the posts say
              <span className="a-mk-tag">{int(readings.length)} {plu(readings.length, 'reading')}</span>
            </h3>
            {readings.length === 0
              ? <p className="a-mk-empty">{INSIGHTS_EMPTY}</p>
              : (
                <ul className="a-mk-tbl">
                  {readings.map(r => {
                    const base = insightBase(r)
                    const body = r.examples.length || r.change
                    return (
                      <li key={r.section}>
                        {body ? (
                          <details className="a-mk-d">
                            <summary>
                              <p className="a-mk-t">{r.headline}</p>
                              {base ? <p className="a-mk-figs"><span className="a-mk-f">{base}</span></p> : null}
                            </summary>
                            <div className="a-mk-dd">
                              {r.change ? <p className="a-mk-change">{r.change}</p> : null}
                              {r.examples.map((e, i) => (
                                <p className="a-mk-ex" key={i}>
                                  {e.url
                                    ? <a className="a-mk-t-a" href={e.url} target="_blank" rel="noreferrer">{e.line}</a>
                                    : e.line}
                                  {e.comments === null ? null : <span className="a-mk-tag">{int(e.comments)} {plu(e.comments, 'comment')}</span>}
                                </p>
                              ))}
                            </div>
                          </details>
                        ) : (
                          <div className="a-mk-row">
                            <p className="a-mk-t">{r.headline}</p>
                            {base ? <p className="a-mk-figs"><span className="a-mk-f">{base}</span></p> : null}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
          </section>

          {/* 3. THE OFFERS. One block each, loudest first. */}
          <section className="a-mk-sec">
            <h3 className="a-mk-h">
              The loudest offers, one at a time
              <span className="a-mk-tag">{int(m.offers.ranked_count)} ranked of {int(m.offers.roster_offers)}</span>
            </h3>
            <p className="a-mk-sub">{shapeLine(m)}</p>
            {top5.length
              ? <ul className="a-mk-offers">{top5.map((o, i) => <OfferBlock key={o.post_ref} o={o} i={i} m={m} />)}</ul>
              : <p className="a-mk-empty">We hold {int(m.populations.roster_posts)} posts from {ACCOUNTS} and no offer among them clears the floor yet.</p>}

            {rest.length ? (
              <div className="a-mk-more">
                <Button size="sm" variant="quiet" onClick={() => setShowRest(v => !v)} aria-expanded={showRest}>
                  {showRest ? 'Hide' : 'Show'} the other {int(rest.length)} {plu(rest.length, 'offer')} from these accounts
                </Button>
              </div>
            ) : null}
            {showRest && rest.length
              ? <ul className="a-mk-tbl">{rest.map(o => <OfferLine key={o.post_ref} o={o} m={m} />)}</ul>
              : null}
          </section>

          {/* 4. THE IDEAS THAT CAME BACK. */}
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

          {/* 5. THE LANE'S OWN POSTS. A stale counter is said out loud, never read as a result. */}
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

          {/* 6. WHAT WE WOULD TEST. Under five ranked offers, a thin state instead. */}
          <section className="a-mk-sec">
            <h3 className="a-mk-h">
              What we would run first
              <span className="a-mk-tag">{int(m.tests.length)} {plu(m.tests.length, 'test')}</span>
            </h3>
            {m.tests.length ? (
              <ol className="a-mk-plan">
                {m.tests.map((t, i) => {
                  const c = testCopy(t, m)
                  return (
                    <li className="a-mk-plan-i" key={t.kind}>
                      <p className="a-mk-k">Test {i + 1}, on a base of {int(t.base)}</p>
                      <h4 className="a-mk-tt">{c.title}</h4>
                      <p className="a-mk-sub">{c.body}</p>
                    </li>
                  )
                })}
              </ol>
            ) : <p className="a-mk-empty">{planThinLine(m)}</p>}
          </section>

          {/* 7. THE WIDER FEED. Unvetted, said plainly, closed by default. */}
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
