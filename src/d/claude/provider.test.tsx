// @vitest-environment jsdom
// Push landing and the status island: the provider opens the linked chat in the drawer,
// and while a turn runs with the drawer closed the frame shows the working pill.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'

const openThread = vi.fn()
let busy = false
vi.mock('../../exp/v2c/useChat', () => ({
  useChat: () => ({ turns: [], busy, runningElsewhere: false, streamTools: [], turnsLoading: false, turnsStale: false, openThread }),
}))

import { renderInFrame } from '../test-utils'
import { ClaudeProvider } from './ClaudeProvider'
import { ClaudeWorking, Island } from './Island'

afterEach(() => { cleanup(); openThread.mockClear(); busy = false })
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
})
