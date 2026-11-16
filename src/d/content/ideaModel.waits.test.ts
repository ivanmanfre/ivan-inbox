import { describe, expect, it } from 'vitest'
import { waitsForIvan, type IdeaItem } from './ideaModel'

const item = (ivan: Partial<NonNullable<IdeaItem['ivan']>> | undefined): IdeaItem =>
  ({ id: 'x', lane: 'ivan', title: 't', score: null, src: '', age: '', parts: [], why: null, angle: null, format: null,
     ivan: ivan as IdeaItem['ivan'] })

describe('waitsForIvan (same rule as content_idea_waits)', () => {
  it('waits when flagged and unanswered', () => expect(waitsForIvan(item({ needs_ivan_data: true }))).toBe(true))
  it('a whitespace-only answer is no answer', () => expect(waitsForIvan(item({ needs_ivan_data: true, needs_ivan_answer: ' \t\n ' }))).toBe(true))
  it('an answer releases it', () => expect(waitsForIvan(item({ needs_ivan_data: true, needs_ivan_answer: '42 calls' }))).toBe(false))
  it('not flagged never waits', () => expect(waitsForIvan(item({ needs_ivan_data: false }))).toBe(false))
  it('client ideas never wait', () => expect(waitsForIvan(item(undefined))).toBe(false))
})
