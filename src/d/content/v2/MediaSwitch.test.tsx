// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import { MediaSwitch } from './MediaSwitch'
import { mediaChoiceOf, mediaOptionsOf } from '../../../lib/content'
const writes = vi.hoisted(() => ({ setDraftMediaChoice: vi.fn() }))
vi.mock('../../../lib/content', async orig => ({ ...(await orig<typeof import('../../../lib/content')>()), ...writes }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const V = 'https://x.supabase.co/storage/v1/object/public/post-stills/x-tracked/denisyurchak/1-poster.jpg'
const video = { id: 'd1', type: 'video', image_urls: [V], taxonomy: { media_options: ['video', 'photos', 'text'], media_choice: 'video' } }

it('offers only what the draft holds, and nothing without a stored video', () => {
  expect(mediaOptionsOf(video)).toEqual(['video', 'photos', 'text'])
  expect(mediaOptionsOf({ taxonomy: { media_options: ['video', 'text'] } })).toEqual(['video', 'text'])
  expect(mediaOptionsOf({ taxonomy: { media_options: ['photos', 'text'] } })).toBeNull()
  expect(mediaOptionsOf({ taxonomy: 'storytelling' })).toBeNull()
  expect(mediaOptionsOf({ taxonomy: null })).toBeNull()
  expect(mediaChoiceOf({ type: 'video', image_urls: [V] })).toBe('video')
  expect(mediaChoiceOf({ type: 'text', image_urls: [V] })).toBe('photos')
  expect(mediaChoiceOf({ type: 'text', image_urls: [] })).toBe('text')
})

it('renders nothing on a draft with no copied video', () => {
  const { container } = renderInFrame(<MediaSwitch d={{ id: 'd2', type: 'text', image_urls: [V], taxonomy: {} }} onDone={() => {}} />)
  expect(container.querySelector('.cv2-media')).toBeNull()
})

it('marks the current choice and writes the new one once', async () => {
  writes.setDraftMediaChoice.mockResolvedValue(undefined)
  const done = vi.fn()
  renderInFrame(<MediaSwitch d={video} onDone={done} />)
  expect(screen.getByRole('button', { name: 'Video' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Video' }))
  expect(writes.setDraftMediaChoice).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Photos' }))
  await waitFor(() => expect(done).toHaveBeenCalled())
  expect(writes.setDraftMediaChoice).toHaveBeenCalledWith('d1', 'photos')
  expect(screen.getByRole('button', { name: 'Photos' }).getAttribute('aria-pressed')).toBe('true')
})

it('goes back to what is stored when the database refuses', async () => {
  writes.setDraftMediaChoice.mockRejectedValue(new Error('This post has no stored photos. Nothing changed.'))
  renderInFrame(<MediaSwitch d={video} onDone={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Text only' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Video' }).getAttribute('aria-pressed')).toBe('true'))
})
