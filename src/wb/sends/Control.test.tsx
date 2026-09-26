import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ControlSection, DeliverySection, RecurrenceSection, seatEligible } from './Control'
import { parsePayload, type CcPayload, type CcState } from '../../lib/campaignControl'
import incident from '../../lib/cc-fixtures/incident.json'
import outsideWindow from '../../lib/cc-fixtures/outside_window.json'
import unknownFix from '../../lib/cc-fixtures/unknown.json'
import partial from '../../lib/cc-fixtures/partial.json'
import rateLimited from '../../lib/cc-fixtures/rate_limited.json'
import healthy from '../../lib/cc-fixtures/healthy.json'

function ok(fixture: unknown): CcState {
  const p = parsePayload(JSON.parse(JSON.stringify(fixture)))
  if ('contract_error' in (p as object)) throw new Error((p as { contract_error: string }).contract_error)
  return { state: 'ok', payload: p as CcPayload, source: 'scenario' }
}

/* A minute after the fixture's own monitor tick. Every relative label on this
   surface is measured from the payload, so a test clock that drifts a day away
   from the fixture would exercise the stale-monitor override in every case
   instead of the states each test is about. */
const NOW = Date.parse((incident as { monitor: { last_tick_at: string } }).monitor.last_tick_at) + 60_000
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

describe('Control — the incident scenario', () => {
  const html = renderToStaticMarkup(<ControlSection cc={ok(incident)} client="all" now={NOW} />)
  const t = text(html)

  it('names the cause in plain words', () => {
    expect(t).toContain('LinkedIn refused the last invitations on this seat')
    expect(t).toContain('The provider sent no reason')
    expect(t).toContain('Cause')
  })
  it('names the next action, the earliest safe time and the recovery condition', () => {
    expect(t).toContain('hold the lane; verify ONE invitation in the next eligible window')
    expect(t).toContain('Earliest safe at')
    expect(t).toContain('at least one CONFIRMED invitation in an eligible window')
  })
  it('states the freshness and the next check', () => {
    expect(t).toMatch(/data \d+[smh] old/)
    expect(t).toContain('rules frozen')
    expect(t).toContain('Next check')
    // Never a future schedule printed as a past one.
    expect(t).not.toMatch(/(Next check|Opens|Opens again|Earliest safe at) \d\d:\d\d · \d+[smhd] ago/)
    expect(t).toMatch(/monitor (fresh|stale|unknown)/)
  })
  it('shows the alternatives it already ruled out and the evidence count', () => {
    expect(t).toContain('Alternatives checked')
    expect(t).toContain('weekly invite limit')
    expect(t).toMatch(/\d+ evidence records/)
  })
  it('keeps invitations, DMs and InMail as three separate figures', () => {
    expect(t).toContain('Invitations today')
    expect(t).toContain('invitations only')
    expect(t).toContain('DMs today')
    expect(t).toContain('InMail today')
    expect(t).toContain('never added together')
  })
  it('offers Acknowledge, and acknowledging does not change the status word', () => {
    expect(t).toContain('Acknowledge')
    const acked = JSON.parse(JSON.stringify(incident)) as { clients: Array<{ client_id: string; incidents?: Array<{ acknowledged: boolean }> }> }
    acked.clients.find(c => c.client_id === 'arch')!.incidents![0].acknowledged = true
    const t2 = text(renderToStaticMarkup(<ControlSection cc={ok(acked)} client="all" now={NOW} />))
    // The status word and its reason are byte-identical; only the local
    // acknowledgment caption appears.
    expect(t2).toContain('Incident')
    expect(t2).toContain('LinkedIn has refused 157 invitations')
    expect(t2).toContain('acknowledged, not recovered')
    expect(t2).not.toContain('Recovered')
    const statusOf = (s: string) => /Davorin\s+(\S+)/.exec(s)?.[1]
    expect(statusOf(t2)).toBe(statusOf(t))
  })
  it('does not pace a window that cannot send', () => {
    // arch is expanded and its session is saturday_closed: no pace line at all.
    expect(t).not.toContain('Pace:')
    expect(t).toContain('Opens again')
  })
  it('draws a per-lane table with reasons', () => {
    expect(t).toContain('Source lane')
    expect(t).toContain('warm_engager')
    expect(t).toContain('Can send now')
  })
  it('does not fetch private evidence before the fold is opened', () => {
    expect(t).toContain('Private detail')
    expect(t).toContain('Not fetched yet.')
  })
})

/* 2026-09-20: LinkedIn answered HTTP 422 errors/cannot_resend_yet on Ivan's and
   Davorin's seats all evening and the card said "Unknown unverified". The
   payload knew: cause CONFIRMED, restriction invitation_limit_or_repeat. */
describe('Control — a confirmed invitation limit says so', () => {
  const RL_NOW = Date.parse((rateLimited as { monitor: { last_tick_at: string } }).monitor.last_tick_at) + 60_000
  const render = (fx: unknown, client: 'all' | 'ivan' | 'risedtc' | 'arch' = 'all', now = RL_NOW) =>
    text(renderToStaticMarkup(<ControlSection cc={ok(fx)} client={client} now={now} />))
  const t = render(rateLimited)

  it('reads "Rate limited", not the generic incident word and not "Unknown"', () => {
    expect(t).toContain('Ivan Rate limited')
    expect(t).toContain('Davorin Rate limited')
    expect(t).not.toContain('Ivan Incident')
    expect(t).not.toContain('Ivan Unknown')
    expect(t).not.toContain('unverified')
  })

  it('leads with the plain sentence, every number out of the payload', () => {
    expect(t).toContain('LinkedIn is refusing invitations on this seat')
    expect(t).toContain('the invitation limit is reached, or these people were invited before')
    expect(t).toContain('37 refusals since 20 Sep.')
    expect(t).toContain('17 refusals since 20 Sep.')
    expect(t).toContain('Nobody is marked as sent; refused people stay in line and are retried.')
  })

  it('keeps the monitor\'s own status_reason after the plain sentence', () => {
    expect(t).toContain('Invitation limit or repeat-invitation restriction. 37 provider refusals since')
    const lead = t.indexOf('LinkedIn is refusing invitations on this seat')
    expect(lead).toBeGreaterThan(-1)
    expect(t.indexOf('Invitation limit or repeat-invitation restriction')).toBeGreaterThan(lead)
  })

  it('stays an incident in tone: urgent, never clear', () => {
    const html = renderToStaticMarkup(<ControlSection cc={ok(rateLimited)} client="all" now={RL_NOW} />)
    expect(html).toContain('data-tone="urgent"')
    expect(text(html)).not.toContain('Healthy')
  })

  it('names the cause in the detail instead of "Cause unknown"', () => {
    expect(t).toContain('Cause confirmed : LinkedIn rate limit (invitation limit, or these people were invited before).')
    expect(t).not.toContain('Cause unknown')
  })

  it('leaves the third seat alone: a spent cap is not a rate limit', () => {
    expect(t).toContain('Mattan Capacity reached')
    expect(t).not.toContain('Mattan Rate limited')
  })

  it('a provider refusal that is NOT the invitation limit keeps the generic word', () => {
    const other = JSON.parse(JSON.stringify(rateLimited)) as { clients: Array<{ client_id: string; incidents?: Array<{ cause?: { underlying_restriction?: string } }> }> }
    for (const c of other.clients) {
      if (c.incidents?.[0]?.cause) c.incidents[0].cause.underlying_restriction = 'account_restricted'
    }
    const t2 = render(other)
    expect(t2).toContain('Ivan Incident')
    expect(t2).not.toContain('Rate limited')
    expect(t2).not.toContain('LinkedIn is refusing invitations on this seat')
    expect(t2).toContain('Cause confirmed')
  })

  it('an UNCONFIRMED cause keeps the generic word', () => {
    const soft = JSON.parse(JSON.stringify(rateLimited)) as { clients: Array<{ incidents?: Array<{ cause?: { status?: string } }> }> }
    for (const c of soft.clients) {
      if (c.incidents?.[0]?.cause) c.incidents[0].cause.status = 'suspected'
    }
    const t2 = render(soft)
    expect(t2).toContain('Ivan Incident')
    expect(t2).not.toContain('Rate limited')
  })

  it('a stale monitor still forces unverified, even on a rate-limited seat', () => {
    /* The fixture is a SNAPSHOT, so it is judged at its own as_of: staleness is
       produced by moving its tick back, exactly as the incident suite does. */
    const dead = JSON.parse(JSON.stringify(rateLimited)) as { as_of: string; monitor: { last_tick_at: string } }
    dead.monitor.last_tick_at = new Date(Date.parse(dead.as_of) - 2 * 3600_000).toISOString()
    const t2 = render(dead)
    expect(t2).toContain('The monitor has not reported in for')
    expect(t2).toContain('Unknown')
    expect(t2).toContain('unverified')
    expect(t2).not.toContain('Rate limited')
    // The payload's own word is still carried as secondary text, unchanged.
    expect(t2).toContain('Payload said: incident,')
  })

  it('a contract error is unchanged by any of this', () => {
    const t2 = text(renderToStaticMarkup(
      <ControlSection cc={{ state: 'error', error: 'payload_version cc03.v2 is not cc03.v1' }} client="all" now={RL_NOW} />,
    ))
    expect(t2).toContain('Unverified')
    expect(t2).toContain('cc03.v2')
    expect(t2).toContain('NOT used as a stand-in')
    expect(t2).not.toContain('Rate limited')
  })
})

describe('Control shows every seat, always', () => {
  it('draws three rows even with one client chip selected', () => {
    for (const c of ['all', 'ivan', 'risedtc', 'arch'] as const) {
      const html = renderToStaticMarkup(<ControlSection cc={ok(incident)} client={c} now={NOW} />)
      const t = text(html)
      for (const label of ['Ivan', 'Davorin', 'Mattan']) expect(t).toContain(label)
    }
  })
  it('marks the picked seat instead of hiding the other two', () => {
    const html = renderToStaticMarkup(<ControlSection cc={ok(incident)} client="ivan" now={NOW} />)
    expect(html).toContain('data-selected')
    expect(text(html)).toContain('Mattan')
  })
})

describe('Control — a stale monitor makes every seat unverified', () => {
  const stale = () => {
    const d = JSON.parse(JSON.stringify(incident)) as { monitor: { last_tick_at: string } }
    d.monitor.last_tick_at = new Date(NOW - 2 * 3600_000).toISOString()
    return d
  }
  it('renders unknown with the minutes and keeps the payload word as secondary text', () => {
    const t = text(renderToStaticMarkup(<ControlSection cc={ok(stale())} client="all" now={NOW} />))
    expect(t).toContain('The monitor has not reported in for 120 minutes')
    expect(t).toContain('Payload said:')
    expect(t).toContain('Unknown')
    expect(t).toContain('unverified')
    // No seat reads healthy next to a monitor that stopped reporting.
    expect(t).not.toContain('Healthy')
  })
  it('a snapshot with no tick at all is NOT treated as stale', () => {
    const d = JSON.parse(JSON.stringify(incident)) as { monitor: { last_tick_at: string | null } }
    d.monitor.last_tick_at = null
    const t = text(renderToStaticMarkup(<ControlSection cc={ok(d)} client="all" now={NOW} />))
    expect(t).not.toContain('has not reported in for')
  })
})

describe('Control — the other states', () => {
  it('outside_window carries no pace alarm and says when it opens', () => {
    const t = text(renderToStaticMarkup(<ControlSection cc={ok(outsideWindow)} client="risedtc" now={NOW} />))
    expect(t).toContain('Outside window')
    expect(t).toContain('Outside window')
    // A closed window is never paced and never alarmed.
    expect(t).not.toContain('behind the target')
    expect(t).not.toContain('Pace:')
    expect(t).toContain('Opens')
  })
  it('unknown says "unverified" in words and never reads clear', () => {
    const t = text(renderToStaticMarkup(<ControlSection cc={ok(unknownFix)} client="risedtc" now={NOW} />))
    expect(t).toContain('Unknown')
    expect(t).toContain('unverified')
    // The word and the chip say two different things, not the same thing twice.
    expect(t).not.toContain('Unverified unverified')
    expect(t).toContain('did not come back complete')
  })
  it('unavailable prints the reason and no figures', () => {
    const t = text(renderToStaticMarkup(
      <ControlSection cc={{ state: 'unavailable', reason: 'control payload read failed' }} client="all" now={NOW} />,
    ))
    expect(t).toContain('Control data not available')
    expect(t).toContain('control payload read failed')
  })
  it('names the snapshot it is reading in the header', () => {
    const t = text(renderToStaticMarkup(<ControlSection cc={ok(incident)} client="all" now={NOW} />))
    expect(t).toMatch(/as of \d\d:\d\d \w+ \(/)
  })
  it('a contract error renders as unverified with the error text', () => {
    const t = text(renderToStaticMarkup(
      <ControlSection cc={{ state: 'error', error: 'payload_version cc03.v2 is not cc03.v1' }} client="all" now={NOW} />,
    ))
    expect(t).toContain('Unverified')
    expect(t).toContain('cc03.v2')
    expect(t).toContain('NOT used as a stand-in')
  })
})

describe('Delivery', () => {
  const t = text(renderToStaticMarkup(
    <DeliverySection cc={ok(incident)} timeframe="7d" range={null} client="all" />,
  ))
  it('keeps invitations, DMs and InMail in three columns', () => {
    expect(t).toContain('Invitations')
    expect(t).toContain('DMs')
    expect(t).toContain('InMail')
    expect(t).toContain('never combined into one total')
  })
  it('shows both cohort denominators', () => {
    expect(t).toContain('Accepted ≤72h')
    expect(t).toContain('Replied ≤72h')
    // A null matured denominator names the denominator it DOES have.
    expect(t).toContain('first messaged')
    expect(t).toContain('maturity is not tracked for it, so no rate is shown')
    expect(t).toContain('matured')
  })
  it('shows the partial day separately and the coverage note', () => {
    expect(t).toContain('partial day')
    expect(t).toContain('never compared')
    expect(t).toContain('lane attribution')
  })
  it('refuses a custom range the snapshot does not carry', () => {
    const t2 = text(renderToStaticMarkup(
      <DeliverySection cc={ok(incident)} timeframe="custom" range={{ from: '2026-01-01', to: '2026-01-31' }} client="all" />,
    ))
    expect(t2).toContain('custom range not in this snapshot')
  })
})

describe('Recurring problems', () => {
  it('shows the daily picks with their independent counts and withheld reasons', () => {
    const t = text(renderToStaticMarkup(<RecurrenceSection cc={ok(incident)} />))
    expect(t).toContain('no_supported_repair')
    expect(t).toContain('Independent')
    expect(t).toContain('not a majority')
    expect(t).toContain('Repair withheld')
    expect(t).toContain('the strongest single member cause statement')
    expect(t).toContain('Splitting a mixed family into separate defects is NOT implemented')
  })
  it('says so when the snapshot carries no ledger', () => {
    const t = text(renderToStaticMarkup(<RecurrenceSection cc={ok(partial)} />))
    expect(t).toContain('no recurrence ledger')
  })
})

describe('Control — the seat figure is the operator\'s day, not the cap counter\'s', () => {
  /* The healthy snapshot is taken at 02:00 Warsaw on 13 Sep. RISE's window ran
     14:00–03:00 Warsaw, so its cap counter (UTC day) has already reset and
     reads 0, while the Warsaw calendar says 2 today and 40 yesterday. */
  const fx = JSON.parse(JSON.stringify(healthy))
  const rise = fx.clients.find((c: { client_id: string }) => c.client_id === 'risedtc')
  rise.invitation.capacity.daily_window_from = '2026-09-13T00:00:00Z'
  rise.invitation.capacity.daily_used_basis = 'utc_date'
  const daily = fx.ranges.daily as Array<{ client_id: string; channel: string; day: string; sent: number }>
  daily.find(d => d.client_id === 'risedtc' && d.channel === 'invitation' && d.day === '2026-09-12')!.sent = 40
  daily.find(d => d.client_id === 'risedtc' && d.channel === 'invitation' && d.day === '2026-09-13')!.sent = 2
  const t = text(renderToStaticMarkup(<ControlSection cc={ok(fx)} client="all" now={NOW} />))

  it('shows today and yesterday on the Warsaw calendar', () => {
    expect(t).toContain('2 invitations today · yesterday 40')
  })
  it('keeps the UTC cap counter as its own line, with its local reset time', () => {
    expect(t).toContain('daily limit 0/40, resets 02:00')
    expect(t).not.toContain('of 40 invitations today')
  })
})

// Review 2026-09-26: the channel's eligible figure is every lane's seat-wide
// figure added up (708 = 3 x 236). The seat shows the figure once.
describe('seatEligible', () => {
  it('uses the one figure every lane carries, not the lane sum', () => {
    expect(seatEligible({
      eligible_stock: 708,
      eligible_stock_by_pool: { by_pool: { cold: 108, engage: 126, hiring: 2 } } as unknown as Record<string, number>,
      by_lane: [236, 236, 236].map((v, i) => ({ source_lane: `l${i}`, confirmed_sent: 0, eligible_stock: v })),
    })).toBe(236)
  })
  it('falls back to the pools when lanes disagree or carry nothing', () => {
    expect(seatEligible({
      eligible_stock: 270,
      eligible_stock_by_pool: { cold: 17, engage: 71, hiring: 2 },
      by_lane: [{ source_lane: 'a', confirmed_sent: 0, eligible_stock: null }],
    })).toBe(90)
  })
  it('shows the channel figure only when there is nothing better', () => {
    expect(seatEligible({ eligible_stock: 12, eligible_stock_by_pool: null, by_lane: [] })).toBe(12)
    expect(seatEligible({ eligible_stock: null, eligible_stock_by_pool: null })).toBeNull()
  })
  it('matches the rate_limited fixture: 90 per lane, 270 in the channel', () => {
    const p = (ok(rateLimited) as { payload: unknown }).payload as { clients: Array<{ invitation: Parameters<typeof seatEligible>[0] }> }
    expect(seatEligible(p.clients[0].invitation)).toBe(90)
  })
})
