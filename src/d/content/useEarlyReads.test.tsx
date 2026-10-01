// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { useEarlyReads } from './useEarlyReads'
import type { ContentDraft } from '../../lib/content'
import type { DraftRead } from '../../lib/earlyReads'
const api = vi.hoisted(() => ({ fetchDraftReads: vi.fn() }))
vi.mock('../../lib/earlyReads', async orig => ({ ...await orig<typeof import('../../lib/earlyReads')>(), ...api }))
const id = '10000000-0000-0000-0000-000000000001'
const row = { id, client_id: null, post_body: 'abc', updated_at: 'one' } as ContentDraft
const read = { draftId: id, state: 'ready', reason: null, pattern: { client_id: 'ivan', dimension: 'angle', value: 'personal', n: 100, breakouts: 12, rate: .12, base_n: 1000, base_rate: .045 }, sentence: 'Stored.', bodyHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', recipeFit: null, computedAt: null, holdout: null, smallSample: false } as DraftRead
function Harness({ rows }: { rows: ContentDraft[] }) { const reads = useEarlyReads(rows); return <p>{rows.map(r => `${reads.get(r.id)?.state}:${reads.get(r.id)?.reason || reads.get(r.id)?.pattern?.rate || ''}`).join('|')}</p> }
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })
it('accepts only a read for the exact visible body, then hides it immediately after edits', async () => {
 vi.stubGlobal('crypto', webcrypto); api.fetchDraftReads.mockResolvedValue([read])
 const v = renderInFrame(<Harness rows={[row]} />)
 await waitFor(() => expect(screen.getByText('ready:0.12')).toBeTruthy())
 api.fetchDraftReads.mockReturnValue(new Promise(() => {}))
 v.rerender(<Harness rows={[{ ...row, post_body: 'changed', updated_at: 'two' }]} />)
 expect(screen.queryByText('ready:0.12')).toBeNull()
})
it('turns hash mismatch and unavailable reads into explicit reasons', async () => {
 vi.stubGlobal('crypto', webcrypto); api.fetchDraftReads.mockResolvedValue([{ ...read, bodyHash: 'different' }])
 renderInFrame(<Harness rows={[row]} />)
 await waitFor(() => expect(screen.getByText(/no_read_yet:.*body changed/i)).toBeTruthy())
})
it('keeps an RPC failure visibly failed rather than absent', async () => {
 vi.stubGlobal('crypto', webcrypto); api.fetchDraftReads.mockRejectedValue(new Error('Network refused'))
 renderInFrame(<Harness rows={[row]} />)
 await waitFor(() => expect(screen.getByText('failed:Network refused')).toBeTruthy())
})
it('rejects a stale body even when only text after the original 700-character label input changed', async () => {
 vi.stubGlobal('crypto', webcrypto)
 const prefix = 'a'.repeat(700), previous = `${prefix}previous tail`
 api.fetchDraftReads.mockResolvedValue([{ ...read, bodyHash: createHash('sha256').update(previous).digest('hex') }])
 renderInFrame(<Harness rows={[{ ...row, post_body: `${prefix}new tail` }]} />)
 await waitFor(() => expect(screen.getByText(/no_read_yet:.*body changed/i)).toBeTruthy())
 expect(screen.queryByText('ready:0.12')).toBeNull()
})
