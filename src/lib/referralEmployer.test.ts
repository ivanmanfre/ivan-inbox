import { describe, expect, it } from 'vitest'
import { employerDomain, personEmailDomains, statedOutsideCompany } from '../../supabase/functions/inbox-dm-draft/research'

const elea = "Yes, it's handled by the Gambit team. You can contact Guillaume or Laurène for any inquiries. :) guillaume@gambitdigital.ca laurene@gambitdigital.ca"
describe('referral employer evidence (Éléa G. -> Gambit, Sol r4 cases)', () => {
  it('links both real contacts to the agency domain', () => {
    expect(employerDomain(elea, 'Guillaume', 'Gambit')).toBe('gambitdigital')
    expect(employerDomain(elea, 'Laurène', 'Gambit Digital')).toBe('gambitdigital')
    expect(statedOutsideCompany(elea, 'Gambit', 'Panache Jeux Numériques', 'Guillaume')).toBe(true)
  })
  it('skips personal mailboxes', () => {
    expect(personEmailDomains('Contact Ben Patton at Saint Spritz, ben.patton@gmail.com', 'Ben Patton')).toEqual([])
    expect(employerDomain('Contact Ben Patton at Saint Spritz, ben.patton@gmail.com', 'Ben Patton', 'Saint Spritz')).toBeNull()
  })
  it('reads the registrable label, not a subdomain', () => {
    expect(personEmailDomains('ben@team.saintspritz.com', 'Ben Patton')).toEqual(['saintspritz'])
    expect(personEmailDomains('ben@acmegrowth.co.uk', 'Ben Patton')).toEqual(['acmegrowth'])
    expect(employerDomain('ben@team.saintspritz.com', 'Ben Patton', 'Saint Spritz')).toBe('saintspritz')
  })
  it('uses whichever of several emails agrees with the company', () => {
    const text = 'Contact Ben Patton: old email ben@oldagency.com; current email ben@acmegrowth.com'
    expect(statedOutsideCompany(text, 'Acme Growth', 'Saint Spritz', 'Ben Patton')).toBe(true)
    expect(employerDomain(text, 'Ben Patton', 'Acme Growth')).toBe('acmegrowth')
  })
})
