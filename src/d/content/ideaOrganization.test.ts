import { describe, expect, it } from 'vitest'
import type { IdeaItem } from './ideaModel'
import { ideaTopic, ideaOrigin, isNewArrival } from './ideaOrganization'
const idea = (title: string, extra: Partial<IdeaItem> = {}) => ({id:'idea',lane:'ivan',title,src:'Manual',age:'',parts:[],score:null,why:null,angle:null,format:null,...extra}) as IdeaItem

describe('idea organization', () => {
  it.each([
    ['The prompt fix for AI drafts that sound like you','Content & LinkedIn'],
    ['My two biggest posts had nothing to do with what I sell','Content & LinkedIn'],
    ['Cold DMs get ignored until people see your content','Sales & outreach'],
    ['I came to Warsaw for a few weeks','Founder life'],
    ["I build AI systems all day and I've never made coffee",'Founder life'],
    ['A completely ambiguous title','Unsorted'],
  ])('groups %s by its subject', (title, topic) => expect(ideaTopic(idea(title))).toBe(topic))
  it('keeps an explicit correction and never classifies from someone else’s quoted evidence', () => {
    expect(ideaTopic(idea('Cold DMs',{evidenceQuote:'Warsaw Poland coffee'}),'Content & LinkedIn')).toBe('Content & LinkedIn')
    expect(ideaTopic(idea('An ambiguous title',{evidenceQuote:'Warsaw Poland coffee'}))).toBe('Unsorted')
  })
  it('shows the original author on measured outliers and keeps calls distinct', () => {
    expect(ideaOrigin(idea('Source',{outlier:{author:'Jane Smith',platform:'linkedin'} as never}))).toBe('Outlier · Jane Smith')
    expect(ideaOrigin(idea('Call',{src:'Your calls'}))).toBe('Your calls')
    expect(ideaOrigin(idea('Own idea'))).toBe('Your idea')
  })
  it('uses intake date for freshness, excludes missing dates and preserves older source dates', () => {
    const now=Date.parse('2026-10-16T12:00:00Z')
    expect(isNewArrival(idea('New',{ivan:{ingested_at:'2026-10-15T12:00:00Z'} as never}),now)).toBe(true)
    expect(isNewArrival(idea('Old',{ivan:{ingested_at:'2026-09-15T12:00:00Z'} as never}),now)).toBe(false)
    expect(isNewArrival(idea('Unknown'),now)).toBe(false)
  })
})
