// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import type { ContentDraft } from '../../../lib/content'

const lib = vi.hoisted(() => ({ unpublishPost: vi.fn() }))
vi.mock('../../../lib/content', async orig => ({ ...(await orig<typeof import('../../../lib/content')>()), unpublishPost: lib.unpublishPost }))

import { CalCard, dotText } from './CalendarV2'
import type { Entry } from '../calModel'
import type { PlanItem } from '../planModel'

const r = { id: 'd1', client_id: null, status: 'published', type: 'single_image', title: '[X outlier @kev] Warsaw in winter', post_body: 'Warsaw in winter\n\nMore.', image_urls: ['https://x/p.jpg'], published_at: '2026-10-05T08:12:00Z', scheduled_at: '2026-10-05T08:00:00Z', created_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-01T08:00:00Z' } as unknown as ContentDraft
const posted: Entry = {
  it: { id: 'd1', source: 'draft', title: 'Warsaw', day: '2026-10-05', at: '2026-10-05T08:00:00Z', postedAt: '2026-10-05T08:12:00Z', plannedAt: null, stage: 'published', arming: 'out', movable: false, lane: 'ivan', unpublishId: 'q1', postedUrl: 'https://linkedin.com/x' } as unknown as PlanItem,
  lane: 'ivan', r, thumb: 'https://x/p.jpg', hook: '[X outlier @kev] Warsaw in winter', lm: false, brain: false, dot: 'posted', refuse: 'Already posted. It stays on the day it went out.',
}
const acts = { onOpen: vi.fn(), onMove: vi.fn(), onArm: vi.fn(), onChanged: vi.fn() }

beforeEach(() => { lib.unpublishPost.mockReset(); vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the clean calendar card', () => {
  it('strips the internal tag, keeps the ✓ time, and has no ⇄ key or Unpublish on the card', () => {
    const { container } = renderInFrame(<CalCard e={posted} a={acts} />)
    const card = container.querySelector('[data-cal-id="d1"]')!
    expect(card.textContent).toContain('Warsaw in winter')
    expect(card.textContent).not.toContain('[X outlier')
    expect(dotText(posted)).toMatch(/^✓ \d\d:\d\d$/)
    expect(card.querySelector('[data-verb="move-day"]')).toBeNull()
    expect(card.querySelector('.cn-unpublish')).toBeNull()
  })
  it('Unpublish lives in the ⋯ menu with today\'s confirm, word for word', async () => {
    const { container } = renderInFrame(<CalCard e={posted} a={acts} />)
    const menu = () => document.querySelector('.cv2-menu') as HTMLElement
    expect(menu().hidden).toBe(true)
    fireEvent.click(container.querySelector('[data-verb="card-more"]')!)
    expect(menu().hidden).toBe(false)
    fireEvent.click(menu().querySelector('.cn-unpublish')!)
    await waitFor(() => expect(screen.getByText('Take this post off LinkedIn?')).toBeTruthy())
    expect(screen.getByText(/Deletes it from your feed for everyone, likes and comments included\./)).toBeTruthy()
    expect(lib.unpublishPost).not.toHaveBeenCalled()
  })
})
