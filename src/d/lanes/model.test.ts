import { describe, expect, it } from 'vitest'
import fixture from '../../lib/cc-fixtures/rate_limited.json'
import { isContractError, parsePayload, type CcPayload } from '../../lib/campaignControl'
import { answerOf, clientOf, controlOf, seatWord, seriesOf, todayOf, windowOf } from './model'
import { armOf } from './reads'
import { armsLine } from './SheetNotes'
import { ACK_KEY, ackId, readAcks, writeAck } from './ack'

const parsed = parsePayload(fixture)
if (isContractError(parsed)) throw new Error(parsed.contract_error)
const p: CcPayload = parsed
// The snapshot's own instant, in Warsaw that is already Monday 21 Sep.
const NOW = Date.parse(p.as_of)

describe('lanes model', () => {
  it('reads invites today per seat from the daily series and never sums seats', () => {
    const a = answerOf(p, ['ivan', 'risedtc', 'arch'], NOW)
    expect(a.inv.map(x => x.seat)).toEqual(['ivan', 'risedtc', 'arch'])
    expect(a.inv.find(x => x.seat === 'risedtc')!.v).toBe(0)
    expect(a.sub).toMatch(/^LinkedIn is refusing Ivan and Arch/)
  })

  it('a missing payload reads as unknown, never 0', () => {
    const a = answerOf(null, ['ivan'], NOW)
    expect(a.inv[0].v).toBeNull()
    expect(todayOf(null, 'ivan', NOW)).toBeNull()
    expect(seriesOf(null, 'ivan', NOW, 'invitation').every(b => b.v === null)).toBe(true)
  })

  it('names a confirmed LinkedIn refusal "Rate limited", and a stale monitor "Unknown, unverified"', () => {
    expect(seatWord(clientOf(p, 'ivan'), 'fresh').word).toBe('Rate limited')
    expect(seatWord(clientOf(p, 'risedtc'), 'fresh').word).toBe('Capacity reached')
    expect(seatWord(clientOf(p, 'ivan'), 'stale').word).toBe('Unknown, unverified')
    expect(seatWord(undefined, 'fresh').tone).toBe('warn')
  })

  it('the incident lead keeps the producer hedge and drops the count (the count has its own line)', () => {
    const v = controlOf(clientOf(p, 'ivan')!, NOW)
    expect(v.incident).not.toBeNull()
    expect(v.incident!.lead).toContain('or these people were invited before')
    expect(v.incident!.lead).not.toMatch(/refusals since/)
  })

  it('14 days: oldest first, today flagged, each seat on its own series', () => {
    const s = seriesOf(p, 'risedtc', NOW, 'invitation')
    expect(s).toHaveLength(14)
    expect(s[13].today).toBe(true)
    expect(s[12].v).toBe(40)
  })

  it('range 90d has no previous window to compare, 7d does', () => {
    expect(windowOf(p, 'ivan', '7d').hasInterval).toBe(true)
    expect(windowOf(p, 'ivan', '90d').compare).toEqual([])
    expect(windowOf(p, 'ivan', '90d').prevRate).toBeNull()
  })
})

describe('campaign-sheet lines', () => {
  it('reads the invite arm from ai_model, blank first', () => {
    expect(armOf({ ai_model: 'arch_blank_v1', message_text: '(blank invite - no note)' })).toBe('blank')
    expect(armOf({ ai_model: null, message_text: '(blank invite)' })).toBe('blank')
    expect(armOf({ ai_model: 'arch_games_note_v1', message_text: 'Hey' })).toBe('games note')
    expect(armOf({ ai_model: null, message_text: 'Hey' })).toBe('no arm recorded')
    expect(armsLine([{ arm: 'blank', n: 51 }, { arm: 'games note', n: 19 }])).toMatch(/^Colleague invites, 30 days: 51 blank, 19 games note\./)
  })
})

describe('acknowledge is local only', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, m } }
  it('stores the episode under its own key and nothing else', () => {
    const s = mem()
    const id = ackId({ incident_key: 'ivan|x', episode_id: 'e1' })
    writeAck(id, '2026-09-27T10:00:00Z', s)
    expect(readAcks(s)).toEqual({ 'ivan|x#e1': '2026-09-27T10:00:00Z' })
    expect([...s.m.keys()]).toEqual([ACK_KEY])
  })
  it('keeps at most 50 episodes, newest first', () => {
    const s = mem()
    for (let i = 0; i < 60; i++) writeAck(`k${i}`, new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), s)
    const a = readAcks(s)
    expect(Object.keys(a)).toHaveLength(50)
    expect(a.k59).toBeDefined()
    expect(a.k0).toBeUndefined()
  })
})
