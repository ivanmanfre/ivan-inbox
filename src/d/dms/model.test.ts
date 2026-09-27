import { describe, expect, it } from 'vitest'
import { DISCARD_REASON } from '../../lib/inbox'
import { NOW, drafted, iso, msg, owedNoDraft, threads, waiting } from './fixtures'
import { firstLine, laneChip, needsCount, outByDay, replied7d, rowTags, seatView } from './model'
import { companyStopLine, inviteArmLine, routeLine } from './nextLine'

const H = 3_600_000

describe('seatView', () => {
  const rows = [
    ...drafted('a', { prospect_name: 'Geraldine', client_id: 'ivan' }),
    ...owedNoDraft('b', { prospect_name: 'Danijel', client_id: 'risedtc' }),
    ...waiting('c', { prospect_name: 'John', client_id: 'ivan' }),
    ...waiting('d', { prospect_name: 'Scan Opener', client_id: 'ivan' }, 40),
    ...drafted('e', { prospect_name: 'Angel', client_id: 'arch' }),
  ]
  const ts = threads(rows)

  it('splits each seat by today\'s bucket rules and never mixes seats', () => {
    const iv = seatView(ts, 'ivan', NOW)
    expect(iv.drafted.map(t => t.prospect_name)).toEqual(['Geraldine'])
    expect(iv.nodraft).toEqual([])
    expect(needsCount(iv)).toBe(1)
    const rise = seatView(ts, 'risedtc', NOW)
    expect(rise.nodraft.map(t => t.prospect_name)).toEqual(['Danijel'])
    expect(needsCount(seatView(ts, 'arch', NOW))).toBe(1)
  })

  it('lifts 2+ day scan openers to the top of Ivan\'s waiting list', () => {
    const plain = seatView(ts, 'ivan', NOW).rest.map(t => t.prospect_name)
    expect(plain).toEqual(['John', 'Scan Opener'])
    const lifted = seatView(ts, 'ivan', NOW, new Map([['d', 3]])).rest.map(t => t.prospect_name)
    expect(lifted).toEqual(['Scan Opener', 'John'])
  })

  it('files a recent discard under Thrown away and a pushed draft under Later only', () => {
    const r = [
      ...owedNoDraft('x', { prospect_name: 'Thrown', client_id: 'ivan' }, 5),
      msg({ prospect_id: 'x', prospect_name: 'Thrown', send_blocked_reason: DISCARD_REASON, send_blocked_at: iso(2 * H), created_at: iso(3 * H) }),
      ...drafted('y', { prospect_name: 'Pushed', client_id: 'ivan' }),
    ]
    const later = r.at(-1)!
    later.snoozed_until = new Date(NOW + 5 * 86_400_000).toISOString()
    later.snoozed_at = iso(H / 2)
    const v = seatView(threads(r), 'ivan', NOW)
    expect(v.thrown.map(t => t.prospect_name)).toEqual(['Thrown'])
    expect(v.later.map(t => t.prospect_name)).toEqual(['Pushed'])
    expect(v.rest.map(t => t.prospect_name)).not.toContain('Pushed')
    expect(needsCount(v)).toBe(0)
  })
})

describe('out and replied', () => {
  it('keeps invites apart from messages and drops spam and inbound strangers from replied', () => {
    const r = [
      msg({ prospect_id: 'i', message_type: 'connection_note', sent_at: iso(H), created_at: iso(H) }),
      msg({ prospect_id: 'j', sent_at: iso(H), created_at: iso(H) }),
      msg({ prospect_id: 'k', direction: 'inbound', sent_at: iso(H), created_at: iso(H) }),
      msg({ prospect_id: 'l', direction: 'inbound', sent_at: iso(H), created_at: iso(H), prospect_skip_reason: 'inbound_vendor_pitch' }),
      msg({ prospect_id: 'm', direction: 'inbound', sent_at: iso(H), created_at: iso(H), campaign_name: 'Arch Inbound Request' }),
    ]
    const ts = threads(r)
    const today = outByDay(ts, 'ivan', NOW).at(-1)!
    expect(today).toMatchObject({ msg: 1, inv: 1 })
    expect(replied7d(ts, 'ivan', NOW)).toBe(1)
  })
})

describe('lane chip', () => {
  it('uses the lane key first, a campaign word next, and never the Arch campaign name', () => {
    const [arch] = threads([msg({ prospect_id: 'a', client_id: 'arch', campaign_name: 'Games Cold US' })])
    expect(laneChip(arch)).toBeNull()
    const [archIn] = threads([msg({ prospect_id: 'b', client_id: 'arch', campaign_name: 'Inbound Request' })])
    expect(laneChip(archIn)?.label).toBe('Inbound')
    const [iv] = threads([msg({ prospect_id: 'c', campaign_name: 'Engagement Harvest v3' })])
    expect(laneChip(iv)?.label).toBe('Harvested')
    const [closed] = threads([msg({ prospect_id: 'd', client_id: 'risedtc', campaign_name: 'RiseDTC — Cold Outbound' })])
    expect(rowTags(closed)[0]).toEqual({ text: 'Cold · closed', kind: 'off' })
    const [keyed] = threads([msg({ prospect_id: 'e', client_id: 'arch', lane: 'israel_trip', copy_route: 'next:apps:blank' })])
    expect(rowTags(keyed).map(t => t.kind)).toEqual(['lane', 'route'])
  })

  it('marks a reaction and a no-draft row', () => {
    const [t] = threads([msg({ prospect_id: 'r', direction: 'inbound', message_text: 'Nico reacted 👍', sent_at: iso(H) })])
    const tags = rowTags(t, { nodraft: true })
    expect(tags[0]).toEqual({ text: 'No draft', kind: 'nd' })
    expect(tags.some(x => x.kind === 're' && x.text.startsWith('reacted'))).toBe(true)
  })
})

describe('coordinator lines', () => {
  it('names the hiring opener, the sponsor stop, the invite arm and the company stop', () => {
    const [h] = threads([msg({ prospect_id: 'h', client_id: 'arch', ai_model: 'arch_dm1_h_apps', sent_at: '2026-09-10T08:00:00Z' })])
    expect(routeLine(h)).toMatch(/^Hiring opener, sent Thu 10 Sep$/)
    const [s] = threads([msg({ prospect_id: 's', client_id: 'arch', lane: 'sponsor_team', sent_at: iso(H) })])
    expect(routeLine(s)).toBe('No follow-up planned: sponsor lane stops after the first message')
    expect(inviteArmLine({ client_id: 'arch', lane: 'company_expansion', copyRoute: 'sent:d2c:blank' }, 'd2c')).toBe('Blank invite: no approved note for d2c')
    expect(inviteArmLine({ client_id: 'arch', lane: 'company_expansion', copyRoute: 'sent:games:games' }, 'games')).toBe('Why this note: company expansion, games note')
    const ts = threads([
      msg({ prospect_id: 'r1', client_id: 'risedtc', lane: 'company_expansion', prospect_company: 'Acme', prospect_name: 'Ann' }),
      msg({ prospect_id: 'r2', client_id: 'risedtc', prospect_company: 'ACME', prospect_name: 'Bob', direction: 'inbound', sent_at: '2026-09-20T08:00:00Z' }),
    ])
    expect(companyStopLine(ts.find(t => t.prospect_id === 'r1')!, ts)).toBe('Company stopped: Bob replied on Sun 20 Sep')
  })
})

it('firstLine takes the first bubble', () => {
  expect(firstLine('Hey Max\n---\nsecond')).toBe('Hey Max')
})
