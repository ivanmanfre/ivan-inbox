// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// The carousel wipe, at the component: SwapImage must not offer a picture on a
// deck, whichever surface mounts it. image_urls=[url] would turn a scheduled
// carousel into a single image.
const lib = vi.hoisted(() => ({ setDraftImage: vi.fn() }))
vi.mock('../../lib/content', async orig => {
  const real = await orig<typeof import('../../lib/content')>()
  return { ...real, setDraftImage: lib.setDraftImage }
})

import { SwapImage } from './actions'
import type { ContentDraftDetail } from '../../lib/content'

const draft = (type: string, image_urls: string[] | null) =>
  ({ id: 'd1', type, status: 'scheduled', image_urls } as unknown as ContentDraftDetail)

afterEach(cleanup)

describe('SwapImage on a carousel', () => {
  it('renders nothing on a carousel, with or without slides', () => {
    const { container } = render(<SwapImage d={draft('carousel', ['https://s/1.png', 'https://s/2.png'])} onDone={() => {}} />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByText('Change picture')).toBeNull()
    expect(screen.queryByText('Remove picture')).toBeNull()
  })
  it('renders nothing on a video', () => {
    const { container } = render(<SwapImage d={draft('video', null)} onDone={() => {}} />)
    expect(container.innerHTML).toBe('')
  })
  it('still offers Change and Remove on a text post', () => {
    render(<SwapImage d={draft('text', ['https://x/a.jpg'])} onDone={() => {}} />)
    expect(screen.getByText('Change picture')).toBeTruthy()
    expect(screen.getByText('Remove picture')).toBeTruthy()
  })
})
