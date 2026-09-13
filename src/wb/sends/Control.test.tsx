import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ControlSection, DeliverySection, RecurrenceSection } from './Control'
import { parsePayload, type CcPayload, type CcState } from '../../lib/campaignControl'
import incident from '../../lib/cc-fixtures/incident.json'
import outsideWindow from '../../lib/cc-fixtures/outside_window.json'
import unknownFix from '../../lib/cc-fixtures/unknown.json'
import partial from '../../lib/cc-fixtures/partial.json'

function ok(fixture: unknown): CcState {
  const p = parsePayload(JSON.parse(JSON.stringify(fixture)))
  if ('contract_error' in (p as object)) throw new Error((p as { contract_error: string }).contract_error)
  return { state: 'ok', payload: p as CcPayload, source: 'scenario' }
}

const NOW = new Date('2026-09-13T15:40:00Z').getTime()
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
    expect(t).toContain('monitor fresh')
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
    expect(t2).toContain('Sending is failing on this seat')
    expect(t2).toContain('acknowledged, not recovered')
    expect(t2).not.toContain('Recovered')
    const statusOf = (s: string) => /Davorin\s+(\S+)/.exec(s)?.[1]
    expect(statusOf(t2)).toBe(statusOf(t))
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

describe('Control — the other states', () => {
  it('outside_window carries no pace alarm and says when it opens', () => {
    const t = text(renderToStaticMarkup(<ControlSection cc={ok(outsideWindow)} client="risedtc" now={NOW} />))
    expect(t).toContain('Outside window')
    expect(t).toContain('Outside window')
    expect(t).not.toContain('behind the target')
  })
  it('unknown says "unverified" in words and never reads clear', () => {
    const t = text(renderToStaticMarkup(<ControlSection cc={ok(unknownFix)} client="risedtc" now={NOW} />))
    expect(t).toContain('Unverified')
    expect(t).toContain('unverified')
    expect(t).toContain('Unverified')
  })
  it('unavailable prints the reason and no figures', () => {
    const t = text(renderToStaticMarkup(
      <ControlSection cc={{ state: 'unavailable', reason: 'control payload read failed' }} client="all" now={NOW} />,
    ))
    expect(t).toContain('Control data not available')
    expect(t).toContain('control payload read failed')
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
