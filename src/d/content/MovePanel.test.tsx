// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({ setScheduleDateAt: vi.fn(), clearScheduleDate: vi.fn() }))
vi.mock('../../lib/content', async orig => ({ ...(await orig<typeof import('../../lib/content')>()), ...lib }))

import { renderInFrame } from '../test-utils'
import { MovePanel } from './MovePanel'
import type { ContentDraft } from '../../lib/content'

const r = { id: 'p1', client_id: 'risedtc', status: 'scheduled', title: 'A post', post_body: 'Body', scheduled_at: '2026-12-02T15:00:00Z' } as unknown as ContentDraft

describe('MovePanel (2026-10-09: opens as a sheet, time first, any month, Undo)', () => {
  beforeEach(() => { cleanup(); lib.setScheduleDateAt.mockReset(); lib.clearScheduleDate.mockReset() })

  it('keeps the time set before the day tap, pages months, and the receipt carries Undo', async () => {
    lib.setScheduleDateAt.mockImplementation(async (_id: string, at: string) => at)
    renderInFrame(<MovePanel r={r} lane="risedtc" seatRows={[r]} onClose={vi.fn()} onDone={vi.fn()} quickCommit />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('December 2026')).toBeTruthy()
    fireEvent.change(document.querySelector('[data-verb="pick-time"]')!, { target: { value: '09:30' } })
    fireEvent.click(document.querySelector('[data-verb="move-next-month"]')!)
    expect(screen.getByText('January 2027')).toBeTruthy()
    fireEvent.click(document.querySelector('[data-day="2027-01-14"]')!)
    await waitFor(() => expect(lib.setScheduleDateAt).toHaveBeenCalledTimes(1))
    // 09:30 Pacific on 14 Jan = 17:30 UTC.
    expect(lib.setScheduleDateAt.mock.calls[0]).toEqual(['p1', '2027-01-14T17:30:00.000Z'])
    fireEvent.click(await screen.findByText('Undo'))
    await waitFor(() => expect(lib.setScheduleDateAt).toHaveBeenLastCalledWith('p1', '2026-12-02T15:00:00Z'))
  })

  it('without quickCommit a tap only picks; the key moves', async () => {
    lib.setScheduleDateAt.mockImplementation(async (_id: string, at: string) => at)
    renderInFrame(<MovePanel r={r} lane="risedtc" seatRows={[r]} onClose={vi.fn()} onDone={vi.fn()} />)
    fireEvent.click(document.querySelector('[data-day="2026-12-10"]')!)
    expect(lib.setScheduleDateAt).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('[data-verb="move-day"]')!)
    await waitFor(() => expect(lib.setScheduleDateAt).toHaveBeenCalledWith('p1', '2026-12-10T15:00:00.000Z'))
  })
})

describe('WhenEditor details', () => {
  beforeEach(() => { cleanup(); lib.setScheduleDateAt.mockReset() })
  it('typed "3pm" then ↓ is 14:45; Enter anywhere saves the day picked', async () => {
    lib.setScheduleDateAt.mockImplementation(async (_id: string, at: string) => at)
    const ivan = { ...r, client_id: null, scheduled_at: '2026-12-02T09:00:00Z' } as unknown as ContentDraft
    renderInFrame(<MovePanel r={ivan} lane="ivan" seatRows={[ivan]} onClose={vi.fn()} onDone={vi.fn()} />)
    const t = document.querySelector<HTMLInputElement>('[data-verb="pick-time"]')!
    fireEvent.change(t, { target: { value: '3pm' } })
    fireEvent.keyDown(t, { key: 'ArrowDown' })
    expect(t.value).toBe('14:45')
    fireEvent.click(document.querySelector('[data-day="2026-12-12"]')!)
    expect(screen.getByText('A weekend day')).toBeTruthy()
    fireEvent.keyDown(document.querySelector('[data-day="2026-12-12"]')!, { key: 'Enter' })
    // 14:45 Warsaw on 12 Dec = 13:45 UTC; a weekend stays where it was picked.
    await waitFor(() => expect(lib.setScheduleDateAt).toHaveBeenCalledWith('p1', '2026-12-12T13:45:00.000Z'))
  })
})
