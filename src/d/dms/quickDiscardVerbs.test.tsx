// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
vi.mock('../../lib/inbox', async orig => ({ ...(await orig<typeof import('../../lib/inbox')>()), discardLegs: vi.fn(async () => []), restoreDraft: vi.fn(async () => true) }))
import * as lib from '../../lib/inbox'
import { DmAsks } from './asks'
import { drafted, msg, threads } from './fixtures'
import { useDmVerbs } from './verbs'
import type { Thread } from '../../lib/inbox'
const ctx = { refresh: vi.fn(), patch: vi.fn(), prepareQuickDiscard: vi.fn(() => true) }
function Quick({ t }: { t: Thread }) {
  const verbs = useDmVerbs(ctx)
  return <button onClick={() => void verbs.quickDiscard(t)}>Quick discard</button>
}
const mount = (t: Thread) => renderInFrame(<DmAsks><Quick t={t} /></DmAsks>)
const pair = () => threads([...drafted('q', {}), msg({ prospect_id: 'q', channel: 'email', message_text: 'Email', created_at: '2026-09-27T09:00:00Z' })])[0]
beforeEach(() => { vi.clearAllMocks(); ctx.prepareQuickDiscard.mockReturnValue(true); vi.mocked(lib.discardLegs).mockResolvedValue([]); vi.mocked(lib.restoreDraft).mockResolvedValue(true) })
afterEach(cleanup)
it('discards both legs immediately and Undo restores each without a confirmation', async () => {
  const t = pair()
  mount(t)
  fireEvent.click(screen.getByText('Quick discard'))
  await waitFor(() => expect(lib.discardLegs).toHaveBeenCalledWith([t.draft, t.companionDraft], null))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(await screen.findByText('Undo'))
  await waitFor(() => expect(lib.restoreDraft).toHaveBeenCalledTimes(2))
  for (const leg of [t.draft!, t.companionDraft!]) expect(ctx.patch).toHaveBeenCalledWith([leg.id], expect.objectContaining({ send_blocked_reason: null }))
})
it('keeps a refused leg untouched and offers Undo for the successfully discarded leg', async () => {
  const t = pair()
  vi.mocked(lib.discardLegs).mockResolvedValueOnce([{ leg: t.companionDraft!, error: null }])
  mount(t)
  fireEvent.click(screen.getByText('Quick discard'))
  await screen.findByText(/already approved/)
  expect(ctx.patch).toHaveBeenCalledWith([t.draft!.id], expect.objectContaining({ send_blocked_reason: 'discarded_in_inbox' }))
  fireEvent.click(await screen.findByText('Undo'))
  await waitFor(() => expect(lib.restoreDraft).toHaveBeenCalledWith(t.draft!.id, t.prospect_id))
  expect(lib.restoreDraft).toHaveBeenCalledTimes(1)
})
it('leaves rows present on failure and reports the error', async () => {
  vi.mocked(lib.discardLegs).mockRejectedValueOnce(new Error('Offline'))
  mount(threads(drafted('q', {}))[0])
  fireEvent.click(screen.getByText('Quick discard'))
  await screen.findByText(/Offline/)
  expect(ctx.patch).not.toHaveBeenCalled()
  expect(screen.queryByText('Undo')).toBeNull()
})
it('does not claim a refused Undo restored a stale row', async () => {
  vi.mocked(lib.restoreDraft).mockResolvedValueOnce(false)
  mount(threads(drafted('q', {}))[0])
  fireEvent.click(screen.getByText('Quick discard'))
  fireEvent.click(await screen.findByText('Undo'))
  await screen.findByText(/changed.*Refresh/i)
  expect(ctx.patch).toHaveBeenCalledTimes(1)
})
it('blocks a duplicate request while the first write is pending', async () => {
  let finish!: (v: []) => void
  vi.mocked(lib.discardLegs).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  mount(threads(drafted('q', {}))[0])
  fireEvent.click(screen.getByText('Quick discard'))
  fireEvent.click(screen.getByText('Quick discard'))
  expect(lib.discardLegs).toHaveBeenCalledTimes(1)
  finish([])
  await screen.findByText('Undo')
})
it('Undo keeps a SwishDM review hold and never approves the restored draft', async () => {
  const [t] = threads(drafted('sw', { client_id: 'swishdm', ai_model: 'swishdm_reply_v1', send_blocked_reason: 'swishdm_reply_pending_review', send_blocked_at: '2026-09-27T06:00:00Z' }))
  // Use the actual pending-review shape with a held draft, as returned by the view.
  t.draft = t.messages.at(-1)!
  mount(t)
  fireEvent.click(screen.getByText('Quick discard'))
  fireEvent.click(await screen.findByText('Undo'))
  await waitFor(() => expect(ctx.patch).toHaveBeenCalledWith([t.draft!.id], expect.objectContaining({ send_blocked_reason: 'swishdm_reply_pending_review' })))
  expect(ctx.patch).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ approved_at: expect.anything() }))
})

it('preserves an unsent composer when the editor guard blocks quick discard', async () => {
  ctx.prepareQuickDiscard.mockReturnValue(false)
  mount(threads(drafted('q', {}))[0])
  fireEvent.click(screen.getByText('Quick discard'))
  await screen.findByText(/Finish or clear your unsent reply/)
  expect(lib.discardLegs).not.toHaveBeenCalled()
  expect(ctx.patch).not.toHaveBeenCalled()
})
