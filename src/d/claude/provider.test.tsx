// @vitest-environment jsdom
// Push landing and the status island: the provider opens the linked chat in the drawer,
// and while a turn runs with the drawer closed the frame shows the working pill.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'

const openThread = vi.fn()
const abort = vi.fn()
let busy = false
let elsewhere = false
vi.mock('../../exp/v2c/useChat', () => ({
  useChat: () => ({
    turns: elsewhere ? [{ id: 'u', role: 'user', text: 'q', tools: [], error: null, status: 'running', turnId: 'turn-9', at: '2026-09-27T10:00:00Z' }] : [],
    busy, runningElsewhere: elsewhere, streamTools: [], turnsLoading: false, turnsStale: false, openThread, abort, newThread: vi.fn(),
  }),
}))
const abortTurn = vi.fn(async () => true)
vi.mock('../../lib/turns', async orig => ({ ...(await orig<typeof import('../../lib/turns')>()), abortTurn: (id: string) => abortTurn(id) }))

import { renderInFrame } from '../test-utils'
import { ClaudeProvider, useClaude } from './ClaudeProvider'
import { fireEvent } from '@testing-library/react'
import { ClaudeWorking, Island } from './Island'

afterEach(() => { cleanup(); openThread.mockClear(); abort.mockClear(); abortTurn.mockClear(); busy = false; elsewhere = false })

function StopKey() { const c = useClaude(); return <button type="button" onClick={c.stop}>stop</button> }
const T = '941ef84c-7d86-4d27-bad2-895df2820bbc'
const U = '33b27e4d-5460-42e7-a429-55a794b7d808'

describe('ClaudeProvider', () => {
  it('a push link #exp/d/claude?thread=&turn= opens that chat in the drawer', () => {
    const setClaudeOpen = vi.fn()
    renderInFrame(<ClaudeProvider><span /></ClaudeProvider>, { hash: `#exp/d/claude?thread=${T}&turn=${U}`, frame: { setClaudeOpen } })
    expect(openThread).toHaveBeenCalledWith(T)
    expect(setClaudeOpen).toHaveBeenCalledWith(true)
  })
  it('another place does not open anything', () => {
    const setClaudeOpen = vi.fn()
    renderInFrame(<ClaudeProvider><span /></ClaudeProvider>, { hash: '#exp/d/dms', frame: { setClaudeOpen } })
    expect(openThread).not.toHaveBeenCalled()
    expect(setClaudeOpen).not.toHaveBeenCalled()
  })
  it('working pill + panel word while a turn runs and the drawer is closed; nothing when open', () => {
    busy = true
    renderInFrame(<ClaudeProvider><Island /><ClaudeWorking /></ClaudeProvider>, { hash: '#exp/d/dms' })
    expect(screen.getByText('Claude')).toBeTruthy()
    expect(screen.getByText('working')).toBeTruthy()
    cleanup()
    renderInFrame(<ClaudeProvider><Island /></ClaudeProvider>, { hash: '#exp/d/dms', frame: { claudeOpen: true } })
    expect(document.querySelector('[data-island]')).toBeNull()
  })
  it('Stop on a turn running elsewhere writes the stop on that row (today\'s abortTurn)', () => {
    elsewhere = true
    renderInFrame(<ClaudeProvider><StopKey /></ClaudeProvider>, { hash: '#exp/d/dms' })
    fireEvent.click(screen.getByText('stop'))
    expect(abortTurn).toHaveBeenCalledWith('turn-9')
    expect(abort).not.toHaveBeenCalled()
  })
  it('Stop on this tab\'s own stream aborts it', () => {
    busy = true
    renderInFrame(<ClaudeProvider><StopKey /></ClaudeProvider>, { hash: '#exp/d/dms' })
    fireEvent.click(screen.getByText('stop'))
    expect(abort).toHaveBeenCalled()
  })
})
