import { describe, expect, it } from 'vitest'
import { parsePlan, planDay } from './contentPlan'

const week = (start: string, which: string) => ({ start, which, target: 4, filled: 4, open: 0, posts: [], planned: [] })
describe('parsePlan', () => {
  it('accepts a full read for the asked lane', () => {
    const r = parsePlan({ ok: true, account: 'risedtc', weeks: [week('2026-10-05', 'this'), week('2026-10-12', 'next'), week('2026-10-19', 'after')], done: [], warnings: [] }, 'risedtc')
    expect(r.weeks).toHaveLength(3)
  })
  it('treats a read with no weeks as a failure, never as an empty plan', () => {
    expect(() => parsePlan({ ok: true, account: 'ivan', weeks: [], done: [], warnings: [] }, 'ivan')).toThrow()
  })
  it('refuses another lane', () => {
    expect(() => parsePlan({ ok: true, account: 'arch', weeks: [], done: [], warnings: [] }, 'ivan')).toThrow()
  })
  it('accepts an enriched read and keeps the brain fields', () => {
    const w = (which: string) => week(which === 'this' ? '2026-10-12' : which === 'next' ? '2026-10-19' : '2026-10-26', which)
    const r = parsePlan({ ok: true, account: 'risedtc', weeks: [w('this'), w('next'), w('after')], done: [], warnings: [], brain_strip: { rules: [], next_check: { date: null, watch: [], proposals: [], recent: [] }, reads: { items: [], total: 0 }, predictions: { measured: 0, need: 20, validated: false }, views: { median: null, breakouts: 0, measured: 0, posts: [] }, idea_stock: [], collection: null, note: null } }, 'risedtc')
    expect(r.brain_strip?.predictions.need).toBe(20)
  })
  it('still refuses a partial read with brain data on it', () => {
    expect(() => parsePlan({ ok: true, account: 'risedtc', weeks: [week('2026-10-12', 'this'), week('2026-10-19', 'next'), week('2026-10-26', 'after')], warnings: [], brain_strip: {} }, 'risedtc')).toThrow()
  })
  it('names the day', () => expect(planDay('2026-10-19')).toBe('Mon 19 Oct'))
})

import { displayTitle, formatWord, pictureWord } from './contentPlan'
describe('display words', () => {
  it('shows a Title Case title in sentence case and keeps names, acronyms and numbers', () => {
    expect(displayTitle('They Launched A Site With Broken Links And Called It Done')).toBe('They launched a site with broken links and called it done')
    expect(displayTitle('Customers Were Missing Free Shipping by Just a Few Dollars')).toBe('Customers were missing free shipping by just a few dollars')
    expect(displayTitle('Why Meta And Google Report Different ROAS Numbers In 2026')).toBe('Why Meta and Google report different ROAS numbers in 2026')
  })
  it('leaves sentence case, short titles and mixed titles alone', () => {
    expect(displayTitle("Don Pablo: getting the coffee buyer beyond Costco")).toBe("Don Pablo: getting the coffee buyer beyond Costco")
    expect(displayTitle('Case Study: Boys Dance Too')).toBe('Case Study: Boys Dance Too')
    expect(displayTitle('The pilot license cost me $35K')).toBe('The pilot license cost me $35K')
    expect(displayTitle(null)).toBe('')
  })
  it('turns machine format and picture strings into words', () => {
    expect(formatWord('post')).toBe('Text')
    expect(pictureWord('decided when drafted')).toBe('Picture chosen when written')
    expect(pictureWord('photo if one fits, else none (photo assigner)')).toBe('Photo if one fits')
    expect(pictureWord('carousel deck')).toBe('Carousel deck')
  })
})
