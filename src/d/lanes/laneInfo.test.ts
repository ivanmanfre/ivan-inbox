import { describe, expect, it } from 'vitest'
import { campaignDisplay, laneInfo } from './laneInfo'

describe('lane explanations', () => {
  // Every lane and campaign that sent an invite in the 30 days to 2026-09-28 (read live).
  const live: Array<['ivan' | 'risedtc' | 'arch', string]> = [
    ...['engager_warm', 'company_expansion', 'hiring_signal', 'cold_games', 'new_in_role', 'cold_apps', 'soft_launch', 'israel_trip',
      'sponsor_team', 'orbit_pilot_fintech', 'funding_signal', 'sponsor_mined', 'orbit_pilot_csaas', 'hand_raise', 'profile_view', 'none']
      .map(k => ['arch', k] as ['arch', string]),
    ...['Warm - Engagement Harvest', 'Cold v2 — Marketing Service Firms 7-60 (owner-led)', 'Agency-Focused Consultants & Fractionals',
      'Agency Owners & Ops Leaders', 'Warm - Kyle Engagers', 'Poland — Agencies (Cold)', "Warm - Creators' Lead-Magnet Commenters",
      'Quiet on LinkedIn — stopped posting', 'Cold v2b — Boutique Consultancies 10-100 (founder-led)', 'Quiet on LinkedIn — podcast guests',
      'Quiet on LinkedIn — active on X', 'Profile View — Ivan'].map(k => ['ivan', k] as ['ivan', string]),
    ...['RiseDTC — Competitor Engagers', 'RiseDTC — Fractional CMO Partners', 'RiseDTC — Company Expansion', "RiseDTC — Client Orbit (clients' networks)"]
      .map(k => ['risedtc', k] as ['risedtc', string]),
  ]
  it.each(live)('%s / %s has an explanation', (seat, key) => {
    expect(laneInfo(seat, key)).toBeTruthy()
  })

  it('the same lane key explains per seat', () => {
    expect(laneInfo('arch', 'company_expansion')).toMatch(/already qualified/)
    expect(laneInfo('risedtc', 'RiseDTC — Company Expansion')).toMatch(/never replied/)
  })

  it('unknown keys get nothing rather than a guess', () => {
    expect(laneInfo('arch', 'made_up_lane')).toBeNull()
    expect(laneInfo('ivan', null)).toBeNull()
  })

  it('Rise company expansion shows the plain name', () => {
    expect(campaignDisplay('RiseDTC — Company Expansion')).toBe('Colleagues of our leads')
    expect(campaignDisplay('RiseDTC — Competitor Engagers')).toBe('Competitor Engagers')
  })
})
