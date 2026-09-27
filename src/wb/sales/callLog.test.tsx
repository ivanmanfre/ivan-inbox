import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CallLog } from './CallLog'
import type { CallRow } from '../../lib/transcripts'

// Every name here is invented; the repo is public.
const row = (i: number, items: string[] = []): CallRow => ({
  id: `c${i}`, title: `Sample call ${i}`, date: `2026-09-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
  duration_minutes: 30, participants: ['Sample Person'], summary: 'A summary.',
  action_items: items, topics: null, follow_up_draft: null, follow_up_sent: null,
  source: null, meeting_type: null, brief: null,
})
const noop = () => {}

describe('Calls on record (moved from Today)', () => {
  it('a failed read with nothing loaded says unread, never empty, and offers Read again', () => {
    const html = renderToStaticMarkup(<CallLog rows={[]} state="failed" onOpen={noop} onRetry={noop} />)
    expect(html).toContain('it is an unread one')
    expect(html).toContain('Read again')
    expect(html).not.toContain('No calls have been transcribed yet')
  })

  it('lands on the calls with action items, six first, the rest behind "show them"', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(i, ['Send the deck']))
    const html = renderToStaticMarkup(<CallLog rows={rows} state="ok" onOpen={noop} onRetry={noop} />)
    expect(html).toContain('9 kept · 30m average')
    expect(html).toContain('With action items')
    expect(html).toContain('more in this list')
    expect((html.match(/a-sl-logrow/g) ?? []).length).toBe(6)
  })

  it('keeps the loaded rows on a failed re-read and says so', () => {
    const html = renderToStaticMarkup(<CallLog rows={[row(1, ['Send the deck'])]} state="failed" onOpen={noop} onRetry={noop} />)
    expect(html).toContain('The last read failed')
    expect(html).toContain('Sample call 1')
  })
})
