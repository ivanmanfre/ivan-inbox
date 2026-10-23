// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import { Batch } from '../Batch'
import type { OpsDraft } from '../../../lib/ops'
vi.mock('../../../wb/ops/batchActs', async orig => ({ ...await orig<typeof import('../../../wb/ops/batchActs')>(), dispatchApprove: vi.fn() }))
import { dispatchApprove } from '../../../wb/ops/batchActs'
const a: OpsDraft = { id: 'a', kind: 'comment_outbound', client_id: 'ivan', body: 'A', context: { approve_url: 'https://gate.example' }, created_at: new Date().toISOString(), slack_channel: '', approved_at: null, sent_at: null, send_blocked_reason: null }
afterEach(() => { cleanup(); vi.clearAllMocks() })
describe('v4 batch presentation', () => {
  it('keeps a failed singleton available after a successful sibling refreshes away', async () => {
    vi.mocked(dispatchApprove).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, outcome: 'refused', message: 'Review this draft' }).mockResolvedValueOnce({ ok: true })
    const b = { ...a, id: 'b' }
    function Harness() {
      const [cards, setCards] = useState([a, b])
      return <Batch lane="ivan" cards={cards} refresh={() => setCards([b])} look="v4" />
    }
    renderInFrame(<Harness />)
    fireEvent.click(document.querySelector('[data-verb=batch-approve]')!)
    fireEvent.click(await waitFor(() => { const el = document.querySelector('.d-confirm [data-verb=confirm]'); if (!el) throw Error('confirm'); return el }))
    await waitFor(() => expect(document.body.textContent).toContain('1 of 2 approved'))
    fireEvent.click(document.querySelector('[data-verb=batch-open]')!)
    expect(document.querySelector('[data-batch-item=b]')?.textContent).toContain('Review this draft')
    expect(document.querySelector('[data-batch-item=b] [data-verb=batch-item-approve]')).toBeTruthy()
    expect(document.querySelector('[data-batch-item=a]')).toBeNull()
    fireEvent.click(document.querySelector('[data-batch-item=b] [data-verb=batch-item-approve]')!)
    fireEvent.click(await waitFor(() => { const el = document.querySelector('.d-confirm [data-verb=confirm]'); if (!el) throw Error('confirm'); return el }))
    await waitFor(() => expect(document.querySelector('[data-batch-item=b]')).toBeNull())
    expect(document.body.textContent).not.toContain('1 failed')
  })
  it('highlights covered IDs and keeps sequential progress until the last dispatch resolves', async () => {
    let finishFirst!: (value: { ok: true }) => void, finishSecond!: (value: { ok: true }) => void
    vi.mocked(dispatchApprove).mockImplementationOnce(() => new Promise(r => finishFirst = r)).mockImplementationOnce(() => new Promise(r => finishSecond = r))
    const highlight = vi.fn(), acted = vi.fn()
    renderInFrame(<Batch lane="ivan" cards={[a, { ...a, id: 'b' }]} refresh={() => {}} look="v4" onHighlight={highlight} onActed={acted} />)
    fireEvent.mouseEnter(document.querySelector('[data-batch]')!)
    expect(highlight).toHaveBeenLastCalledWith(['a', 'b'])
    expect(document.querySelector('.d-btn-p')).toBeNull()
    fireEvent.click(document.querySelector('[data-verb=batch-approve]')!)
    fireEvent.click(await waitFor(() => { const el = document.querySelector('.d-confirm [data-verb=confirm]'); if (!el) throw Error('confirm'); return el }))
    await waitFor(() => expect(document.body.textContent).toContain('Approving 1 of 2…'))
    finishFirst({ ok: true })
    await waitFor(() => expect(document.body.textContent).toContain('Approving 2 of 2…'))
    expect(acted).toHaveBeenNthCalledWith(1, 'a', 'Approved')
    expect(acted).toHaveBeenNthCalledWith(2, 'b', 'Approved')
    finishSecond({ ok: true })
    await waitFor(() => expect(document.body.textContent).toContain('2 approved'))
  })
})
