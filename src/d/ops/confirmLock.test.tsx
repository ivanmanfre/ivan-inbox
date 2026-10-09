// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { parseDHash } from '../route'
import OpsPage from './index'
import { __resetSkinForTests } from '../../ds/skin'
import type { OpsDraft } from '../../lib/ops'
vi.mock('../../hooks/useOps', () => ({ useOps: () => ({ drafts, loading: false, error: '', loadedAt: Date.now(), refresh: vi.fn(), markDone: vi.fn() }) }))
vi.mock('../../hooks/useCommentQueue', () => ({ useCommentQueue: () => ({ held: new Map(), feed: new Map(), waiting: [], cappedToday: false, positionOf: () => -1, record: vi.fn() }) }))
vi.mock('../../hooks/useReactions', () => ({ useReactions: () => ({ rows: [], bodies: {}, loading: false, error: '', refresh: vi.fn() }) }))
vi.mock('../../lib/ops', async orig => ({ ...await orig<typeof import('../../lib/ops')>(), approveOpsDraft: vi.fn(async () => {}), discardOpsDraft: vi.fn(async () => {}) }))
import * as lib from '../../lib/ops'
const a: OpsDraft = { id: 'a', kind: 'escalation', client_id: 'ivan', body: 'First', context: { prospect_name: 'First person' }, slack_channel: '', created_at: new Date().toISOString(), approved_at: null, sent_at: null, send_blocked_reason: null }
const b: OpsDraft = { ...a, id: 'b', body: 'Second', context: { prospect_name: 'Second person' } }
let drafts = [a, b]
const navigate = vi.fn()
function Page({ phone = false }: { phone?: boolean }) {
  const [, redraw] = useState(0)
  const [hash, setHash] = useState('#exp/d/ops?card=a')
  return <><button data-test-refresh onClick={() => redraw(n => n + 1)}>Refresh</button><button data-test-route onClick={() => setHash('#exp/d/ops')}>Route change</button><OpsPage layout={phone ? "phone" : "desktop"} route={parseDHash(hash)} navigate={h => { navigate(h); setHash(h) }} /></>
}
beforeEach(() => { drafts = [a, b]; vi.clearAllMocks() })
afterEach(() => { cleanup(); __resetSkinForTests() })
describe.each([false, true])('Ops confirmation locks the displayed card (ops=%s)', skin => {
  beforeEach(() => __resetSkinForTests(skin ? new Set(['ops']) : new Set()))
  it.each([['approve', false], ['discard', false], ['approve', true], ['discard', true]])('%s (phone=%s) ignores j/k, row clicks and route/refresh changes until answered', async (verb, phone) => {
    renderInFrame(<Page phone={phone as boolean} />)
    fireEvent.click(document.querySelector(`[data-verb="${verb}"]`)!)
    await waitFor(() => expect(document.querySelector('.d-confirm')).toBeTruthy())
    fireEvent.keyDown(window, { key: 'j' }); fireEvent.keyDown(window, { key: 'k' })
    const row = document.querySelector('[data-op-row="b"]'); if (row) fireEvent.click(row)
    const back = document.querySelector('[aria-label="Back to Ops"]'); if (back) fireEvent.click(back)
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('[data-test-route]')!)
    drafts = [b]; fireEvent.click(document.querySelector('[data-test-refresh]')!)
    expect(document.querySelector('[data-card]')?.getAttribute('data-card')).toBe('a')
    fireEvent.click(document.querySelector('.d-confirm [data-verb="confirm"]')!)
    await waitFor(() => expect(verb === 'approve' ? lib.approveOpsDraft : lib.discardOpsDraft).toHaveBeenCalledWith(...(verb === 'approve' ? ['a', 'First', 'escalation'] : ['a', 'escalation'])))
    expect(document.querySelector('[data-card]')?.getAttribute('data-card')).toBe(phone ? undefined : 'b')
  })
})
