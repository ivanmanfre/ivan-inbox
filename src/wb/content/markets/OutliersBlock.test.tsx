import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OutliersPanel } from './OutliersBlock'
import type { OutlierStudy, OutlierWinner } from '../../../lib/outliers'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&').replace(/&#[0-9]+;/g, ' ').replace(/\s+/g, ' ').trim()

const winner = (i: number, over: Partial<OutlierWinner> = {}): OutlierWinner => ({
  author: `Author ${i}`, lift: 17.5 - i, likes: 255, reposts: 14, comments: 72, brand: 18, peer: 30, n: 40,
  type_label: 'Brand story', first_line: `First line of post ${i}`, url: `https://www.linkedin.com/posts/p${i}`, ...over,
})

function study(over: Partial<OutlierStudy> = {}): OutlierStudy {
  return {
    run_id: 'outliers-test', created_at: '2026-09-19T00:00:00Z',
    answer: { figure: '4 of 75', unit: 'top outliers were plain how-to', line: 'The posts that left their author’s baseline were stories and news.' },
    cards: [1, 2, 3, 4].map(i => ({ headline: `Card ${i}`, figure: `${i}0%`, base: `on ${i} posts`, change: `change ${i}` })),
    base: { authors: 51, posts: 4329, outliers: 147, months: 12, top_n: 75, audited_posts: 40, per_post: 40, reactors: 1580 },
    travels: [{ type: 'milestone', label: 'Milestones', n: 14 }],
    bands: [{ type: 'brand_story', label: 'Brand story', posts: 5, reactors: 200, brand_lo: 5, brand_hi: 18, brand: 11, peer: 40, vendor: 9 }],
    winners: [0, 1, 2, 3, 4].map(i => winner(i)),
    method: ['Headlines judged by reading.'],
    ...over,
  }
}

describe('OutliersPanel', () => {
  const html = renderToStaticMarkup(<OutliersPanel study={study()} />)
  const beforeFold = html.split('<details')[0]

  it('opens on one number and its sentence', () => {
    expect(text(beforeFold)).toContain('4 of 75')
    expect((beforeFold.match(/a-mk-n/g) || []).length).toBe(1)
  })

  it('shows three cards and three winners, the rest behind the fold', () => {
    expect((beforeFold.match(/class="a-mk-card"/g) || []).length).toBe(3)
    expect(text(beforeFold)).not.toContain('Card 4')
    expect(text(beforeFold)).toContain('First line of post 2')
    expect(text(beforeFold)).not.toContain('First line of post 3')
    expect(text(html)).toContain('First line of post 4')
  })

  it('links every winner to the original post with lift and brand share', () => {
    expect(beforeFold).toContain('href="https://www.linkedin.com/posts/p0"')
    expect(text(beforeFold)).toContain('17.5x own baseline')
    expect(text(beforeFold)).toContain('18% brand side of 40')
  })

  it('states the sample size on the bands and reads them as a range', () => {
    expect(text(html)).toContain('n=40 a post, read as bands')
    expect(text(html)).toContain('5 to 18% brand side')
  })

  it('carries no em dash', () => {
    expect(html).not.toContain('—')
  })
})
