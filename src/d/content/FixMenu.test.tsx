// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { renderInFrame } from '../test-utils'

// Today's DeleteDraft, stubbed to "the delete landed": the window must walk on to the next row, not sit on "gone".
vi.mock('../../wb/draft/actions', () => ({
  RegenDraft: () => null, SwapImage: () => null, RestartDraft: () => null,
  DeleteDraft: ({ onDone }: { onDone: () => void }) => <button type="button" data-verb="fake-delete" onClick={onDone}>Delete draft</button>,
}))
const detail = { id: 'd1', client_id: null, status: 'review', type: 'text', title: 'T', topic: null, post_body: 'B', scheduled_at: null, published_at: null, source_post_id: null,
  image_urls: null, taxonomy: {}, updated_at: '2026-09-26T21:10:00Z', created_at: '2026-09-20T10:00:00Z', board_visible: null, funnel_stage: null, qa: null, agent_log: [], source_detail: null }
vi.mock('../../hooks/useContent', () => ({ useDraftDetail: () => ({ detail, missing: false, loading: false, error: null }) }))
import { DraftWindow } from './DraftWindow'
afterEach(cleanup)

describe('Fix or remove', () => {
  it('Delete draft walks to the next row in the queue', () => {
    const onPick = vi.fn()
    renderInFrame(<DraftWindow id="d1" lane="ivan" queue={['d1', 'd2']} onPick={onPick} onClose={vi.fn()} refresh={vi.fn()} days={[]} armed={new Set()} armedFailed={false} />)
    fireEvent.click(document.querySelector('[data-verb="fix"]')!)
    fireEvent.click(document.querySelector('[data-verb="fake-delete"]')!)
    expect(onPick).toHaveBeenCalledWith('d2')
  })
})
