import { describe, expect, it } from 'vitest'
import { moveConfirmCopy, movePublishesForClient } from './moveConfirm'

const row = (over: Partial<Parameters<typeof moveConfirmCopy>[0] & object> = {}) => ({
  client_id: 'arch' as string | null, board_visible: true as boolean | null,
  status: 'review', published_at: null as string | null, ...over,
})

describe('moveConfirmCopy: a date on a board post is a schedule', () => {
  // 2026-10-08: the ARCH publisher sends only after Davorin approves on his panel.
  it('says an on-board ARCH post goes out once Davorin approves it, with day and time', () => {
    const c = moveConfirmCopy(row(), 'Tue, Sep 29', '9:00 AM')
    expect(c.title).toBe('Set the date?')
    expect(c.confirmText).toBe('Set the date')
    expect(c.message).toContain('once Davorin approves it on his panel')
    expect(c.message).toContain('goes out on Tue, Sep 29 at 9:00 AM')
    expect(c.message).not.toContain('Mattan')
    expect(c.message).not.toContain('—')
  })

  it('names Mattan on an on-board RISE post, scheduled status too', () => {
    const c = moveConfirmCopy(row({ client_id: 'risedtc', status: 'scheduled' }), 'Wed, Sep 30', '11:00 AM')
    expect(c.confirmText).toBe('Schedule to post')
    expect(c.message).toContain('Mattan’s board')
  })

  it('keeps the plain move for Ivan’s own posts', () => {
    const c = moveConfirmCopy(row({ client_id: null }), 'Tue, Sep 29', '9:00 AM')
    expect(c.confirmText).toBe('Move it')
    expect(c.message).toBe('Moves to Tue, Sep 29. Status and board visibility stay as they are.')
  })

  it('keeps the plain move for off-board client posts (false or null flag)', () => {
    expect(moveConfirmCopy(row({ board_visible: false }), 'd', 't').confirmText).toBe('Move it')
    expect(moveConfirmCopy(row({ board_visible: null }), 'd', 't').confirmText).toBe('Move it')
  })

  it('does not call a published or unknown row a schedule', () => {
    expect(movePublishesForClient(row({ published_at: '2026-09-01T09:00:00Z' }))).toBe(false)
    expect(movePublishesForClient(row({ status: 'approved' }))).toBe(false)
    expect(movePublishesForClient(undefined)).toBe(false)
  })
})
