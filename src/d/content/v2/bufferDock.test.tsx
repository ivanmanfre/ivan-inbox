// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ContentDraft } from '../../../lib/content'
import type { Loose, Magnet } from '../calModel'
import { BufferDock } from './CalendarV2'

afterEach(() => { cleanup(); localStorage.clear() })

const post = (id: string, lm: boolean): Loose => ({
  id, lane: 'arch', hook: `Hook ${id}`, thumb: null, lm, brain: false, createdAt: '2026-10-29T10:00:00Z',
  r: { id, client_id: 'arch', status: 'review', type: 'text', title: id, post_body: 'Body.', taxonomy: null, image_urls: null } as unknown as ContentDraft,
})
const page: Magnet = { id: 'p1', lane: 'arch', title: 'Before you book the creators', cover: null, status: 'review' }
const acts = { onOpen: () => {}, onMove: () => {}, onArm: () => {}, onChanged: () => {} } as unknown as Parameters<typeof BufferDock>[0]['a']

describe('the buffer: lead magnets counted where they are listed (Ivan 2026-10-30)', () => {
  it('lead magnet posts move under Lead magnets with the pages; No date yet counts the rest', () => {
    render(<BufferDock loose={[post('a', false), post('radar', true), post('deal', true)]} lms={[page]} a={acts} />)
    expect(document.querySelector('[data-verb="buffer-loose"]')!.textContent).toBe('No date yet1')
    expect(document.querySelector('[data-verb="buffer-lms"]')!.textContent).toBe('Lead magnets3')
    expect(screen.queryByText('Hook radar')).toBeNull()
    fireEvent.click(document.querySelector('[data-verb="buffer-lms"]')!)
    expect(screen.getByText('Hook radar')).toBeTruthy()
    expect(screen.getByText('Hook deal')).toBeTruthy()
    expect(screen.getByText('Before you book the creators')).toBeTruthy()
  })
})
