// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Preview } from './Preview'
import { LinkedInCard } from './v2/LinkedInCard'
import type { ContentDraftDetail } from '../../lib/content'

const images = ['https://example.test/slide-1.png', 'https://example.test/slide-2.png', 'https://example.test/slide-3.png']
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(cleanup)

it.each(['detail', 'inline'])('%s preview opens the clicked slide at full resolution, zooms, and walks the deck', kind => {
  const startEdit = vi.fn()
  render(kind === 'detail'
    ? <Preview d={{ type: 'carousel', image_urls: images } as ContentDraftDetail} lane="ivan" body="Post copy." editing={false} text="" setText={vi.fn()} onStartEdit={startEdit} />
    : <LinkedInCard lane="ivan" body="Post copy." type="carousel" images={images} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open slide 2 of 3' }))
  const viewer = screen.getByRole('dialog', { name: 'Image viewer' })
  expect(viewer.querySelector('img')?.getAttribute('src')).toBe('https://example.test/slide-2.png')
  expect(screen.getByText('2 / 3')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
  expect(screen.getByRole('button', { name: 'Fit to window' }).textContent).toContain('150%')
  fireEvent.keyDown(viewer, { key: 'ArrowRight' })
  expect(viewer.querySelector('img')?.getAttribute('src')).toBe('https://example.test/slide-3.png')
  expect(screen.getByRole('button', { name: 'Next slide' }).getAttribute('aria-disabled') === 'true').toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }))
  expect(viewer.querySelector('img')?.getAttribute('src')).toBe('https://example.test/slide-2.png')
  fireEvent.click(screen.getByRole('button', { name: 'Close image viewer' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(startEdit).not.toHaveBeenCalled()
})

it('a single image also opens in the viewer, and Escape closes only the viewer', () => {
  render(<Preview d={{ type: 'text', image_urls: [images[0]] } as ContentDraftDetail} lane="ivan" body="Body" editing={false} text="" setText={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open image' }))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByText('Body')).toBeTruthy()
})

it('shows a retry after an image load failure and clears it when the image loads', () => {
  render(<Preview d={{ type: 'carousel', image_urls: images } as ContentDraftDetail} lane="ivan" body="Body" editing={false} text="" setText={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open slide 1 of 3' }))
  const viewer = screen.getByRole('dialog')
  fireEvent.error(viewer.querySelector('img')!)
  expect(screen.getByRole('alert').textContent).toContain('Image could not load')
  screen.getByRole('button', { name: 'Retry' }).focus()
  fireEvent.keyDown(viewer, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fit to window' }))
  expect(viewer.querySelector('img')?.getAttribute('src')).toBe('https://example.test/slide-2.png')
  fireEvent.error(viewer.querySelector('img')!)
  screen.getByRole('button', { name: 'Retry' }).focus()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fit to window' }))
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.load(viewer.querySelector('img')!)
  expect(screen.queryByRole('status')).toBeNull()
})

it.each(['detail', 'inline'])('%s preview plays a video post in place, poster = the first image', kind => {
  const mp4 = 'https://example.test/clip.mp4'
  const { container } = render(kind === 'detail'
    ? <Preview d={{ type: 'video', image_urls: [images[0]], video_url: mp4 } as ContentDraftDetail} lane="swishdm" body="Post copy." editing={false} text="" setText={vi.fn()} />
    : <LinkedInCard lane="swishdm" body="Post copy." type="video" images={[images[0]]} videoUrl={mp4} />)
  const v = container.querySelector('video')
  expect(v?.getAttribute('src')).toBe(mp4)
  expect(v?.getAttribute('poster')).toBe(images[0])
  expect(v?.hasAttribute('controls')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Open image' })).toBeNull()
})

it('a video post without a video_url keeps the poster and play mark', () => {
  const { container } = render(<LinkedInCard lane="swishdm" body="Post copy." type="video" images={[images[0]]} />)
  expect(container.querySelector('video')).toBeNull()
  expect(screen.getByLabelText('Video')).toBeTruthy()
})

// 2026-11-06 multi-photo: the Review card draws LinkedIn's multi-image layout for a photo post.
it.each([
  [2, 2, 0, null], [3, 1, 2, null], [4, 1, 3, null], [5, 2, 3, null], [7, 2, 3, '+2'],
])('%i photos: %i on top, %i below, more mark %s', (n, top, bottom, more) => {
  const urls = Array.from({ length: n }, (_, i) => `https://example.test/p${i + 1}.jpg`)
  const { container } = render(<LinkedInCard lane="ivan" body="Post copy." type="text" images={urls} />)
  expect(container.querySelectorAll('.cv2-li-grid-top button')).toHaveLength(top)
  expect(container.querySelectorAll('.cv2-li-grid-bot button')).toHaveLength(bottom)
  expect(container.querySelector('.cv2-li-more')?.textContent ?? null).toBe(more)
  expect(container.querySelector('.cv2-li-grid')!.getAttribute('aria-label')).toBe(`${n} photos`)
  fireEvent.click(screen.getByRole('button', { name: `Open photo 2 of ${n}` }))
  expect(screen.getByRole('dialog', { name: 'Image viewer' }).querySelector('img')?.getAttribute('src')).toBe(urls[1])
})

it('one photo stays one photo; video and carousel keep their own layout', () => {
  const one = render(<LinkedInCard lane="ivan" body="x" type="text" images={[images[0]]} />)
  expect(one.container.querySelector('.cv2-li-grid')).toBeNull()
  expect(one.container.querySelectorAll('.cv2-li-m img')).toHaveLength(1)
  one.unmount()
  const vid = render(<LinkedInCard lane="ivan" body="x" type="video" images={images} videoUrl="https://example.test/v.mp4" />)
  expect(vid.container.querySelector('.cv2-li-grid')).toBeNull()
  expect(vid.container.querySelector('video')).toBeTruthy()
  vid.unmount()
  const car = render(<LinkedInCard lane="ivan" body="x" type="carousel" images={images} />)
  expect(car.container.querySelector('.cv2-li-grid')).toBeNull()
  expect(car.container.querySelector('.cv2-li-car')).toBeTruthy()
})

it("a client lane keeps photo 1 only (their publishers post one photo)", () => {
  const { container } = render(<LinkedInCard lane="risedtc" body="x" type="text" images={images} />)
  expect(container.querySelector('.cv2-li-grid')).toBeNull()
  expect(container.querySelectorAll('.cv2-li-m img')).toHaveLength(1)
})
