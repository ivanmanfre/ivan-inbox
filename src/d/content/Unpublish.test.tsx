// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { useState } from 'react'
import { Month } from './Month'
import { DayPanel } from './DayPanel'
import { Unpublish } from './Unpublish'
import { byDay, seatItems } from './planModel'
import type { ContentDraft, ScheduledQueueRow } from '../../lib/content'
const writes = vi.hoisted(() => ({ unpublishPost: vi.fn() }))
vi.mock('../../lib/content', async orig => ({ ...(await orig<typeof import('../../lib/content')>()), ...writes }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const queue = { id: 'queue', clickup_task_id: '7ee3e411-5759-4db5-bd82-556b1696573b', status: 'posted', post_text: 'Our own post', scheduled_at: '2026-09-30T09:00:00Z', posted_at: '2026-09-30T09:01:00Z', unipile_share_url: 'https://linkedin.com/posts/ours' } as ScheduledQueueRow
it('retains the publisher identity on posted draft and queue-only planner rows', () => {
  const draft = { id: queue.clickup_task_id, client_id: null, status: 'published', scheduled_at: queue.scheduled_at, published_at: queue.posted_at, post_body: 'Edited body', type: 'text', title: 'Draft' } as ContentDraft
  expect(seatItems([draft], 'ivan', [queue])[0].unpublishId).toBe('queue')
  expect(seatItems([], 'ivan', [queue])[0].unpublishId).toBe('queue')
  expect(seatItems([draft], 'arch', [queue])[0].unpublishId).toBeNull()
})
it('opens the existing irreversible confirmation from a planner row without writing anything', async () => {
  renderInFrame(<Unpublish id="queue" onDone={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }))
  expect(await screen.findByText('Take this post off LinkedIn?')).toBeTruthy()
  expect(screen.getByText(/likes and comments included/)).toBeTruthy()
  expect(writes.unpublishPost).not.toHaveBeenCalled()
})

it('a posted queue row sharing only a date with an unrelated draft stays separate and removable', () => {
  const q = { ...queue, clickup_task_id: 'legacy-task' }
  const unrelated = { id: 'unrelated', client_id: null, status: 'published', scheduled_at: q.scheduled_at, published_at: q.posted_at, post_body: 'Different post altogether', type: 'text', title: 'Unrelated draft' } as ContentDraft
  const items = seatItems([unrelated], 'ivan', [q])
  expect(items.map(i => ({ id: i.id, source: i.source, unpublish: i.unpublishId }))).toEqual([
    { id: 'unrelated', source: 'draft', unpublish: null }, { id: 'queue', source: 'queue', unpublish: 'queue' },
  ])
})
it('exact linked and uniquely body-paired posted rows remain one planner item each', () => {
  const draft = { id: queue.clickup_task_id, client_id: null, status: 'published', scheduled_at: queue.scheduled_at, published_at: queue.posted_at, post_body: queue.post_text, type: 'text', title: 'Draft' } as ContentDraft
  const exact = seatItems([draft], 'ivan', [queue])
  const body = seatItems([{ ...draft, id: 'legacy-draft' }], 'ivan', [{ ...queue, clickup_task_id: 'legacy-task' }])
  expect(exact).toHaveLength(1)
  expect(body).toHaveLength(1)
  expect(exact[0].unpublishId).toBe('queue')
  expect(body[0].unpublishId).toBe('queue')
})

it.each([null, '2026-05-09T09:00:00Z'])('a verified body-paired published draft uses the publisher posted clock instead of its planned date (%s)', publishedAt => {
  const q = { ...queue, clickup_task_id: 'legacy-task', scheduled_at: '2026-05-21T09:00:00Z', posted_at: '2026-05-21T09:01:00Z' }
  const draft = { id: 'old-draft', client_id: null, status: 'published', scheduled_at: '2026-05-08T09:00:00Z', published_at: publishedAt, post_body: q.post_text, type: 'text', title: 'Old draft' } as ContentDraft
  const items = seatItems([draft], 'ivan', [q])
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ id: 'old-draft', source: 'draft', unpublishId: 'queue', postedAt: '2026-05-21T09:01:00Z', day: '2026-05-21', at: '2026-05-08T09:00:00Z' })
})
it('a removable publisher row with only an actual posted date is reachable on that day', () => {
  const q = { ...queue, scheduled_at: null, posted_at: '2026-05-21T09:01:00Z' }
  const items = seatItems([], 'ivan', [q])
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ source: 'queue', unpublishId: 'queue', postedAt: '2026-05-21T09:01:00Z', day: '2026-05-21' })
})

function PhoneMonth({ matched }: { matched: boolean }) {
  const [day, setDay] = useState<string[] | null>(null)
  const draft = { id: queue.clickup_task_id, client_id: null, status: 'published', scheduled_at: queue.scheduled_at, published_at: queue.posted_at, post_body: queue.post_text, type: 'text', title: 'Matched published draft' } as ContentDraft
  const rows = matched ? [draft] : []
  const items = byDay(seatItems(rows, 'ivan', [queue]))
  return <><Month lane="ivan" setLane={() => {}} rows={rows} items={items} onOpen={() => {}} onMove={() => {}} onArm={() => {}} onDay={(_lane, keys) => setDay(keys)} now={Date.parse('2026-09-30T10:00:00Z')} phone />
    {day && <DayPanel lane="ivan" keys={day} items={items} onClose={() => setDay(null)} onOpen={() => {}} onMove={() => {}} onArm={() => {}} />}</>
}
it.each([false, true])('phone Month posted actions reveal the correct day and full Unpublish action (matched draft=%s)', async matched => {
  renderInFrame(<PhoneMonth matched={matched} />, { layout: 'phone' })
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${matched ? 'Matched published draft' : 'Our own post'}` }))
  expect(document.querySelector('.cn-daylist')!.textContent).toContain(matched ? 'Matched published draft' : 'Our own post')
  expect(screen.getByRole('dialog').textContent).toContain('Wed 30 Sep')
  expect(screen.getByRole('link', { name: 'Open post' }).getAttribute('href')).toBe(queue.unipile_share_url)
  fireEvent.click(document.querySelector('.cn-daylist [data-verb="unpublish"]')!)
  expect(await screen.findByText('Take this post off LinkedIn?')).toBeTruthy()
  expect(writes.unpublishPost).not.toHaveBeenCalled()
})
it('desktop Month keeps Unpublish directly on the posted chip', () => {
  renderInFrame(<Month lane="ivan" setLane={() => {}} rows={[]} items={byDay(seatItems([], 'ivan', [queue]))} onOpen={() => {}} onMove={() => {}} onArm={() => {}} onDay={() => {}} now={Date.parse('2026-09-30T10:00:00Z')} />)
  expect(screen.getByRole('button', { name: 'Unpublish' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Actions for Our own post' })).toBeNull()
})
