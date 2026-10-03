// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia

const base = {
  id: 'd1', client_id: null, status: 'review', type: 'text', title: 'A brain post', topic: null,
  post_body: 'Para one.', scheduled_at: null, source_post_id: null, image_urls: null,
  taxonomy: { source: 'content-brain' }, cb34_p2_member: true, updated_at: '2026-10-02T21:10:00Z', created_at: '2026-10-02T10:00:00Z',
  board_visible: null, funnel_stage: 'trust', qa: null, agent_log: [], source_detail: null,
}
let current: Record<string, unknown> = base

vi.mock('../../hooks/useContent', () => ({
  useDraftDetail: () => ({ detail: current, missing: false, loading: false, error: null }),
}))
const lib = vi.hoisted(() => ({ approveDraft: vi.fn(), skipDraft: vi.fn(), setBoardVisible: vi.fn(), deleteDraft: vi.fn(), deleteClientDraft: vi.fn(), listClientPhotos: vi.fn(), listStills: vi.fn() }))
vi.mock('../../lib/content', async orig => ({ ...(await orig<typeof import('../../lib/content')>()), ...lib }))
const verdicts = vi.hoisted(() => ({ setVerdict: vi.fn() }))
vi.mock('../../lib/verdicts', async orig => ({ ...(await orig<typeof import('../../lib/verdicts')>()), setVerdict: verdicts.setVerdict }))
vi.mock('./writes', () => ({ scheduleGuarded: vi.fn() }))

import { DraftWindow } from './DraftWindow'
import { flushVerdicts, resetVerdictsForTest } from './verdictStore'
import { resetDecisionsForTest } from './decisions'

const props = (over = {}) => ({
  id: 'd1', lane: 'ivan' as const, queue: ['d0', 'd1', 'd2'], onPick: vi.fn(), onClose: vi.fn(), refresh: vi.fn(),
  days: [], armed: new Set<string>(), armedFailed: false, ...over,
})
const verb = (v: string) => document.querySelector(`[data-verb="${v}"]`) as HTMLButtonElement | null
const saved = (verdict: 'keep' | 'edited' | 'drop') => ({ verdict_id: 'v1', draft_id: 'd1', client_id: 'ivan', verdict, reasons: [], note: null, how_made: 'brain', draft_action: 'pending', source: 'app', decided_at: 'x', updated_at: null })

beforeEach(() => {
  current = base
  Object.values(lib).forEach(f => f.mockReset()); verdicts.setVerdict.mockReset()
  resetVerdictsForTest(); resetDecisionsForTest()
})
afterEach(cleanup)

describe('brain draft in the open post: Approve or Drop', () => {
  it('Ivan lane shows Approve (data-verb dw-keep) and Drop and no old Approve or Skip', () => {
    renderInFrame(<DraftWindow {...props()} />)
    expect(verb('dw-keep')!.textContent).toContain('Approve')
    expect(verb('dw-keep')!.textContent).not.toContain('Keep')
    expect(verb('dw-keep')!.className).toContain('d-key-p')
    expect(verb('dw-drop')!.textContent).toContain('Drop')
    expect(verb('approve')).toBeNull()
    expect(verb('skip')).toBeNull()
  })

  it('a normal Ivan draft still shows Approve and Skip', () => {
    current = { ...base, taxonomy: { pillar: 'trust' }, cb34_p2_member: false }
    renderInFrame(<DraftWindow {...props()} />)
    expect(verb('approve')).toBeTruthy()
    expect(verb('skip')).toBeTruthy()
    expect(verb('dw-keep')).toBeNull()
    expect(verb('dw-drop')).toBeNull()
  })

  it('a brain draft that is already approved is not judged here', () => {
    current = { ...base, status: 'approved' }
    renderInFrame(<DraftWindow {...props()} />)
    expect(verb('dw-keep')).toBeNull()
    expect(verb('skip')).toBeTruthy()
  })

  it('Rise brain draft: Approve and Drop, no Delete, Put on board stays', () => {
    current = { ...base, client_id: 'risedtc', board_visible: false }
    renderInFrame(<DraftWindow {...props({ lane: 'risedtc' })} />)
    expect(verb('dw-keep')).toBeTruthy()
    expect(verb('dw-drop')).toBeTruthy()
    expect(verb('delete')).toBeNull()
    expect(verb('board-on')).toBeTruthy()
    expect(verb('edit')).toBeTruthy()
  })

  it('a normal Rise draft keeps Delete and gets no Approve or Drop key of the brain pair', () => {
    current = { ...base, client_id: 'risedtc', board_visible: false, taxonomy: {}, cb34_p2_member: false }
    renderInFrame(<DraftWindow {...props({ lane: 'risedtc' })} />)
    expect(verb('delete')).toBeTruthy()
    expect(verb('dw-keep')).toBeNull()
  })

  it('the Fix row has no Delete draft for a brain draft, and keeps Rewrite', () => {
    renderInFrame(<DraftWindow {...props()} />)
    const labels = [...document.querySelectorAll('.cn-fix2 button')].map(b => b.textContent)
    expect(labels).toContain('Rewrite the copy')
    expect(labels).not.toContain('Delete draft')
  })

  it('Drop is one tap: walks on, shows the Undo toast, holds the write, then writes the verdict', async () => {
    verdicts.setVerdict.mockResolvedValue(saved('drop'))
    const p = props()
    renderInFrame(<DraftWindow {...p} />)
    fireEvent.click(verb('dw-drop')!)
    expect(document.querySelector('.d-confirm')).toBeNull()
    expect(p.onPick).toHaveBeenCalledWith('d2')
    expect(await screen.findByText('Dropped.')).toBeTruthy()
    expect(screen.getByText('Add a reason on its card in Review, or move on.')).toBeTruthy()
    expect(verdicts.setVerdict).not.toHaveBeenCalled()
    await flushVerdicts()
    expect(verdicts.setVerdict).toHaveBeenCalledTimes(1)
    expect(verdicts.setVerdict.mock.calls[0][0]).toBe('d1')
    expect(verdicts.setVerdict.mock.calls[0][1]).toBe('drop')
    expect(lib.deleteDraft).not.toHaveBeenCalled()
    expect(lib.skipDraft).not.toHaveBeenCalled()
    await waitFor(() => expect(p.refresh).toHaveBeenCalled())
  })

  it('Undo on the toast means nothing is written', async () => {
    renderInFrame(<DraftWindow {...props()} />)
    fireEvent.click(verb('dw-keep')!)
    expect(await screen.findByText('Approved.')).toBeTruthy()
    fireEvent.click(await screen.findByText('Undo'))
    await flushVerdicts()
    expect(verdicts.setVerdict).not.toHaveBeenCalled()
  })

  it('Approve on an errored Ivan draft asks the QA override first, and writes nothing when declined', async () => {
    current = { ...base, status: 'error' }
    renderInFrame(<DraftWindow {...props()} />)
    fireEvent.click(verb('dw-keep')!)
    expect(await screen.findByText('Approve this draft anyway?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await flushVerdicts()
    expect(verdicts.setVerdict).not.toHaveBeenCalled()
  })

  it('Approve on a Rise draft is a verdict with the lane, with no confirm', async () => {
    current = { ...base, client_id: 'risedtc', board_visible: false }
    verdicts.setVerdict.mockResolvedValue({ ...saved('keep'), client_id: 'risedtc' })
    renderInFrame(<DraftWindow {...props({ lane: 'risedtc' })} />)
    fireEvent.click(verb('dw-keep')!)
    expect(document.querySelector('.d-confirm')).toBeNull()
    await flushVerdicts()
    expect(verdicts.setVerdict.mock.calls[0].slice(0, 2)).toEqual(['d1', 'keep'])
    expect(lib.approveDraft).not.toHaveBeenCalled()
  })

  it('once judged in this session the keys are replaced by a muted Approved line', async () => {
    verdicts.setVerdict.mockResolvedValue(saved('keep'))
    renderInFrame(<DraftWindow {...props({ queue: ['d1'] })} />)
    fireEvent.click(verb('dw-keep')!)
    await flushVerdicts()
    await waitFor(() => expect(verb('dw-verdict-done')?.textContent).toBe('Approved'))
    expect(verb('dw-keep')).toBeNull()
    expect(verb('dw-drop')).toBeNull()
  })

  it('the open post notes when it was first shown, and the tap sends that gap on the first write', async () => {
    verdicts.setVerdict.mockResolvedValue(saved('keep'))
    renderInFrame(<DraftWindow {...props({ queue: ['d1'] })} />)
    fireEvent.click(verb('dw-keep')!)
    await flushVerdicts()
    const ms = verdicts.setVerdict.mock.calls[0][2].msToVerdict
    expect(typeof ms).toBe('number')
    expect(ms).toBeGreaterThanOrEqual(0)
  })

  it('a failed write shows the error and Try again, which writes it again', async () => {
    verdicts.setVerdict.mockRejectedValueOnce(new Error('No connection'))
    verdicts.setVerdict.mockResolvedValueOnce(saved('drop'))
    renderInFrame(<DraftWindow {...props({ queue: ['d1'] })} />)
    fireEvent.click(verb('dw-drop')!)
    await flushVerdicts()
    expect((await screen.findByRole('alert')).textContent).toContain('No connection')
    expect(verb('dw-keep')).toBeNull()
    fireEvent.click(verb('dw-verdict-retry')!)
    await waitFor(() => expect(verdicts.setVerdict).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(verb('dw-verdict-done')?.textContent).toBe('Dropped'))
  })
})
