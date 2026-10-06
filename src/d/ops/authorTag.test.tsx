// @vitest-environment jsdom
// Ivan 10-06: an outbound comment from his seat @tags the post author by default, the card
// shows it, and turning it off sends notag=1 to the gate. The Mattan copy path has no tag.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'

vi.mock('../../lib/ops', async orig => {
  const real = await orig<typeof import('../../lib/ops')>()
  return { ...real, dispatchCommentGate: vi.fn(async () => ({ outcome: 'accepted', message: 'approved: x', retryable: false })), approveWeeklyReport: vi.fn(async () => {}) }
})

import * as lib from '../../lib/ops'
import type { OpsDraft } from '../../lib/ops'
import { OpsCard } from './Card'

const draft = (context: Record<string, unknown>): OpsDraft => ({
  id: 'o1', client_id: 'ivan', kind: 'comment_outbound', slack_channel: '', body: 'ha the tube ads are always the best ones',
  context: { posted_at: new Date().toISOString(), target_name: 'Josh S.', ...context },
  created_at: new Date().toISOString(), approved_at: null, sent_at: null, send_blocked_reason: null,
})
const gate = { approve_url: 'https://gate.example/volume-gate?id=1&k=2' }
const tagBtn = () => document.querySelector('.op-tagline') as HTMLButtonElement | null

afterEach(cleanup)

describe('outbound author tag', () => {
  it('shows the tag on by default and approves without notag', async () => {
    renderInFrame(<OpsCard d={draft(gate)} refresh={() => {}} layout="desktop" pos="card 1 of 1" />)
    expect(tagBtn()?.textContent).toContain('@ tags Josh S.')
    expect(tagBtn()?.textContent).toContain('hidden surname')
    fireEvent.click(document.querySelector('[data-verb="approve"]') as HTMLElement)
    fireEvent.click(await waitFor(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Approve & queue' && !x.closest('.op-keys')); if (!b) throw new Error('no confirm'); return b }))
    await waitFor(() => expect(lib.dispatchCommentGate).toHaveBeenCalledWith(gate.approve_url))
  })

  it('tap turns the tag off and the gate gets notag=1', async () => {
    vi.mocked(lib.dispatchCommentGate).mockClear()
    renderInFrame(<OpsCard d={draft(gate)} refresh={() => {}} layout="desktop" pos="card 1 of 1" />)
    fireEvent.click(tagBtn()!)
    expect(tagBtn()?.textContent).toContain('No tag')
    fireEvent.click(document.querySelector('[data-verb="approve"]') as HTMLElement)
    fireEvent.click(await waitFor(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Approve & queue' && !x.closest('.op-keys')); if (!b) throw new Error('no confirm'); return b }))
    await waitFor(() => expect(lib.dispatchCommentGate).toHaveBeenCalledWith(`${gate.approve_url}&notag=1`))
  })

  it('has no tag line on the copy path (no approve_url)', () => {
    renderInFrame(<OpsCard d={draft({})} refresh={() => {}} layout="desktop" pos="card 1 of 1" />)
    expect(tagBtn()).toBeNull()
  })
})
