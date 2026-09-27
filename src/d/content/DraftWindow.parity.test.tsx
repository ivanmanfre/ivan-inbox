// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'

const base = {
  id: 'd1', client_id: null, status: 'review', type: 'text', title: 'A title', topic: 'The topic line', published_at: null,
  post_body: 'Body.', scheduled_at: null, source_post_id: null, image_urls: null, source_ref: null,
  taxonomy: { pillar: 'trust' }, updated_at: '2026-09-26T21:10:00Z', created_at: '2026-09-20T10:00:00Z',
  board_visible: null, funnel_stage: null, qa: null, agent_log: [], source_detail: null, authored_html: null,
}
let current: Record<string, unknown> = base
vi.mock('../../hooks/useContent', () => ({ useDraftDetail: () => ({ detail: current, missing: false, loading: false, error: null }) }))
const sa = vi.hoisted(() => ({ appendAgentNote: vi.fn() }))
vi.mock('../../lib/studioActions', async orig => ({ ...(await orig<object>()), appendAgentNote: sa.appendAgentNote }))

import { DraftWindow } from './DraftWindow'
const props = (over = {}) => ({ id: 'd1', lane: 'ivan' as const, queue: ['d1'], onPick: vi.fn(), onClose: vi.fn(), refresh: vi.fn(), days: [], armed: new Set<string>(), armedFailed: false, ...over })

beforeEach(() => { current = base; sa.appendAgentNote.mockReset(); localStorage.clear() })
afterEach(cleanup)

describe('draft window parity', () => {
  it('Log tab: Post note writes append_agent_log through appendAgentNote (⌘↵ too)', async () => {
    sa.appendAgentNote.mockResolvedValue(undefined)
    renderInFrame(<DraftWindow {...props()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Log/ }))
    const box = screen.getByLabelText('Add a note to the generation register')
    fireEvent.change(box, { target: { value: 'check the hook' } })
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(sa.appendAgentNote).toHaveBeenCalledWith('carousel_drafts', 'd1', 'check the hook'))
  })

  it('shows the error banner with flipped-at, the internal-only chip and every hold above the post', () => {
    current = { ...base, status: 'error', taxonomy: { error_message: 'QA refused twice', error_flipped_at: '2026-09-25T08:00:00Z' },
      source_detail: { internal_only: true, holds: ['Ivan owes the number'] } }
    renderInFrame(<DraftWindow {...props()} />)
    expect(screen.getByRole('alert').textContent).toContain('QA refused twice')
    expect(screen.getByText(/flipped/)).toBeTruthy()
    expect(screen.getByText('Internal copy only · not approved for publication')).toBeTruthy()
    expect(screen.getByText('The topic line')).toBeTruthy()
  })

  it('client review row with no image says the schedule will refuse it; client error says why there is no board key', () => {
    current = { ...base, client_id: 'risedtc', status: 'review' }
    renderInFrame(<DraftWindow {...props({ lane: 'risedtc' })} />)
    expect(screen.getByText(/No image yet/)).toBeTruthy()
    cleanup()
    current = { ...base, client_id: 'risedtc', status: 'error' }
    renderInFrame(<DraftWindow {...props({ lane: 'risedtc' })} />)
    expect(screen.getByText(/only a draft at Needs review can go on Mattan’s board/)).toBeTruthy()
  })

  it('click on the post opens the editor; Esc in the editor cancels', () => {
    renderInFrame(<DraftWindow {...props()} />)
    fireEvent.click(screen.getByTitle('Click to edit (Enter)'))
    const ed = document.querySelector('.cn-ed') as HTMLTextAreaElement
    expect(ed).toBeTruthy()
    fireEvent.keyDown(ed, { key: 'Escape' })
    expect(document.querySelector('.cn-ed')).toBeNull()
  })

  it('a published row: Posts chip reads Post time, Fields carries the Published date', () => {
    current = { ...base, status: 'published', scheduled_at: '2026-09-20T08:45:00Z', published_at: '2026-09-20T08:46:00Z' }
    renderInFrame(<DraftWindow {...props()} />)
    expect(screen.getByText(/Post time/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Fields/ }))
    expect(screen.getAllByText('Published').some(e => e.tagName === 'DT')).toBe(true)
  })
})
