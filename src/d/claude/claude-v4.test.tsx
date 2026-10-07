// @vitest-environment jsdom
// Brief 4 Claude (skin section `claude`): the runner moves to a header pill whose popover holds the
// SAME RunnerJobs (Stop still goes through runner.stop), the context chips ride inside the composer
// well, and the workspace (page variant) draws no chats toggle and no close key. Flag off = today.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { useState } from 'react'

vi.mock('../../lib/turns', async orig => ({
  ...(await orig<typeof import('../../lib/turns')>()),
  listThreads: vi.fn(async () => [{ id: 't1', kind: 'ask', title: 'Name one memory file', turn_count: 3, last_turn_at: '2026-09-12T10:00:00Z', last_status: 'done' }]),
}))
const job = { id: 'j1', kind: 'prompt', status: 'running', input: 'do it', model: null, cwd: null, log: 'line', created_at: '2026-10-07T10:00:00Z', started_at: '2026-10-07T10:00:00Z', finished_at: null }
vi.mock('../../wb/ask/jobs', async orig => ({
  ...(await orig<typeof import('../../wb/ask/jobs')>()),
  useRunnerJobs: () => ({ jobs: [job], loaded: true, error: null, refresh: vi.fn(), add: vi.fn() }),
  useJobDeepLink: () => ({ job: null, report: false }),
  dispatchJob: vi.fn(async () => ({ id: 'j2' })), cancelJob: vi.fn(async () => {}),
}))

import { EMPTY_SEE, type SeeState } from '../../exp/v2c/chat/paneContext'
import type { ChatHandle } from '../../exp/v2c/useChat'
import { __resetSkinForTests } from '../../ds/skin'
import { renderInFrame } from '../test-utils'
import { clearClaudeHandoff } from '../ui/claudeHandoff'
import { ClaudeValueProvider, type ClaudeCtx } from './ClaudeProvider'
import ClaudeDrawer from './Drawer'
import { ClaudeWorkspace } from './v4/ClaudeWorkspace'
import * as jobs from '../../wb/ask/jobs'

afterEach(() => { cleanup(); clearClaudeHandoff(); __resetSkinForTests(new Set()) })

function fakeChat(): ChatHandle {
  return {
    turns: [], status: 'idle', busy: false, streamText: '', streamTools: [], sessionId: null, model: null, slow: false,
    wanted: null, setWanted: vi.fn(), threadId: 't1', thread: null, turnsLoading: false, turnsStale: false, grounding: null,
    runningElsewhere: false, botThread: null, botUnread: false, refreshBot: vi.fn(), openBot: vi.fn(), botPushMuted: false, setBotPushMuted: vi.fn(),
    send: vi.fn(async () => {}), abort: vi.fn(), retry: vi.fn(), reset: vi.fn(), newThread: vi.fn(), openThread: vi.fn(),
  } as unknown as ChatHandle
}
const route = { place: 'dms' as const, sub: null, query: new URLSearchParams('thread=p1') }
function Value({ children }: { children: React.ReactNode }) {
  const [text, setText] = useState('')
  const [see, setSee] = useState<SeeState>(EMPTY_SEE)
  const chat = fakeChat()
  const v: ClaudeCtx = { chat, online: true, text, setText, see, setSee, focusTurn: null, clearFocus: () => {}, since: null, stepAt: () => undefined, landed: null, clearLanded: () => {}, savedAt: null, stop: () => {}, voiceOpen: false, setVoiceOpen: () => {}, dictateOnOpen: false, clearDictateOnOpen: () => {} }
  return <ClaudeValueProvider value={v}>{children}</ClaudeValueProvider>
}

describe('Claude drawer under the claude section', () => {
  it('flag off: runner list inline, no pill (today)', () => {
    renderInFrame(<Value><ClaudeDrawer layout="desktop" route={route} onClose={() => {}} /></Value>, { hash: '#exp/d/dms' })
    expect(document.querySelector('.dcl-runpill')).toBeNull()
    expect(document.querySelector('.dcl-jobs')).not.toBeNull()
  })
  it('flag on: the runner is a header pill; its popover holds the same jobs and Stop calls cancelJob', async () => {
    __resetSkinForTests(new Set(['claude', 'tokens', 'type', 'motion', 'shell']))
    renderInFrame(<Value><ClaudeDrawer layout="desktop" route={route} onClose={() => {}} /></Value>, { hash: '#exp/d/dms' })
    const pill = document.querySelector('.dcl-head [data-verb="runner"]') as HTMLElement
    expect(pill.textContent).toContain('1 running')
    expect(document.querySelector('.dcl-jobs')).toBeNull()
    fireEvent.click(pill)
    await waitFor(() => expect(document.querySelector('.dcl-runpop .dcl-jobs')).not.toBeNull())
    fireEvent.click(document.querySelector('.dcl-runpop [data-verb="stop-job"]')!)
    await waitFor(() => expect(jobs.cancelJob).toHaveBeenCalledWith('j1'))
  })
  it('workspace (page variant): rail + conversation, no chats toggle, no close key', async () => {
    __resetSkinForTests(new Set(['claude', 'tokens', 'type', 'motion', 'shell']))
    const list = { threads: [], failed: false, reload: () => {} }
    renderInFrame(<Value><ClaudeWorkspace layout="desktop" route={{ place: 'claude', sub: null, query: new URLSearchParams() }} title="Claude" list={list} onNew={() => {}} /></Value>, { hash: '#exp/d/claude' })
    expect(document.querySelector('.dcl-rail [data-chats]')).not.toBeNull()
    expect(document.querySelector('.dcl-ws[data-claude-drawer]')).not.toBeNull()
    expect(document.querySelector('.dcl-ws [data-verb="chats"]')).toBeNull()
    expect(document.querySelector('.dcl-ws button[aria-label^="Close Claude"]')).toBeNull()
    expect(document.querySelector('.dcl-ws textarea[aria-label="Message to Claude"]')).not.toBeNull()
  })
})
