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
