import { describe, expect, it } from 'vitest'
import { employerDomain, handoffEmails, personEmailDomains, referralEnvelope, statedOutsideCompany } from '../../supabase/functions/inbox-dm-draft/research'

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
  it('hands over the addresses when no profile is found', () => {
    expect(handoffEmails(elea, 'Guillaume', 'gambitdigital')).toEqual(['guillaume@gambitdigital.ca', 'laurene@gambitdigital.ca'])
    expect(handoffEmails('Contact Ben Patton, ben.patton@gmail.com', 'Ben Patton', null)).toEqual([])
    expect(handoffEmails('Try Ben, ben@acmegrowth.com, cc ops@other.com', 'Ben', null)).toEqual(['ben@acmegrowth.com'])
  })
})

describe('referral email envelope (Ivan 2026-11-05: "we should be able to send emails too")', () => {
  it('mails the named person and puts the colleague from the same handoff on Cc', () => {
    expect(referralEnvelope(elea, 'Guillaume', 'gambitdigital')).toEqual({ to: 'guillaume@gambitdigital.ca', cc: ['laurene@gambitdigital.ca'] })
    expect(referralEnvelope(elea, 'Laurène', 'gambitdigital')).toEqual({ to: 'laurene@gambitdigital.ca', cc: ['guillaume@gambitdigital.ca'] })
  })
  it('uses a personal mailbox only when it carries their own name', () => {
    expect(referralEnvelope('Contact Ben Patton, ben.patton@gmail.com', 'Ben Patton', null)).toEqual({ to: 'ben.patton@gmail.com', cc: [] })
    expect(referralEnvelope('Talk to Ben, or write to ops@other.com', 'Ben', null)).toBeNull()
    expect(referralEnvelope('Ben Patton handles it', 'Ben Patton', null)).toBeNull()
  })
  it('never puts an unrelated address from the message on the email', () => {
    expect(referralEnvelope('Try Ben, ben@acmegrowth.com, cc ops@other.com', 'Ben', null)).toEqual({ to: 'ben@acmegrowth.com', cc: [] })
  })
})
