// @vitest-environment jsdom
// Verb wiring for the Claude drawer: each key calls TODAY'S chat handle / lib with today's
// arguments. The network modules are mocked; the chat handle is a stub that records calls.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'

vi.mock('../../lib/turns', async orig => ({
  ...(await orig<typeof import('../../lib/turns')>()),
  listThreads: vi.fn(async () => [
    { id: 'b1', kind: 'bot', title: 'Claude', turn_count: 170, last_turn_at: '2026-09-19T10:00:00Z', last_status: 'done' },
    { id: 't1', kind: 'ask', title: 'Name one memory file', turn_count: 3, last_turn_at: '2026-09-12T10:00:00Z', last_status: 'done' },
    { id: 't2', kind: 'ask', title: 'One line, no tools', turn_count: 1, last_turn_at: '2026-09-06T10:00:00Z', last_status: 'error' },
  ]),
}))
vi.mock('../../wb/ask/jobs', async orig => ({
  ...(await orig<typeof import('../../wb/ask/jobs')>()),
  useRunnerJobs: () => ({ jobs: [], loaded: true, error: null, refresh: vi.fn(), add: vi.fn() }),
  useJobDeepLink: () => ({ job: null, report: false }),
  dispatchJob: vi.fn(async () => ({ id: 'j1' })),
}))

import { threadSubject, EMPTY_SEE, type SeeState } from '../../exp/v2c/chat/paneContext'
import type { ChatHandle } from '../../exp/v2c/useChat'
import { renderInFrame } from '../test-utils'
import { clearClaudeHandoff, handOffToClaude } from '../ui/claudeHandoff'
import { ClaudeValueProvider, type ClaudeCtx } from './ClaudeProvider'
import ClaudeDrawer from './Drawer'
import * as jobs from '../../wb/ask/jobs'

afterEach(() => { cleanup(); clearClaudeHandoff() })

function fakeChat(over: Partial<ChatHandle> = {}): ChatHandle {
  return {
    turns: [], status: 'idle', busy: false, streamText: '', streamTools: [], sessionId: null, model: null, slow: false,
    wanted: null, setWanted: vi.fn(), threadId: 't1', thread: null, turnsLoading: false, turnsStale: false, grounding: null,
    runningElsewhere: false, botThread: { id: 'b1', kind: 'bot', turn_count: 170, bot_push_muted: false } as ChatHandle['botThread'],
    botUnread: false, refreshBot: vi.fn(), openBot: vi.fn(), botPushMuted: false, setBotPushMuted: vi.fn(),
    send: vi.fn(async () => {}), abort: vi.fn(), retry: vi.fn(), reset: vi.fn(), newThread: vi.fn(), openThread: vi.fn(),
    ...over,
  } as unknown as ChatHandle
}

function Host({ chat }: { chat: ChatHandle }) {
  const [text, setText] = useState('')
  const [see, setSee] = useState<SeeState>(EMPTY_SEE)
  const v: ClaudeCtx = { chat, online: true, text, setText, see, setSee, focusTurn: null, clearFocus: () => {}, since: null, stepAt: () => undefined, landed: null, clearLanded: () => {}, savedAt: null, stop: () => chat.abort(), voiceOpen: false, setVoiceOpen: () => {}, dictateOnOpen: false, clearDictateOnOpen: () => {} }
  return <ClaudeValueProvider value={v}><ClaudeDrawer layout="desktop" route={{ place: 'dms', sub: null, query: new URLSearchParams() }} onClose={() => {}} /></ClaudeValueProvider>
}

const angel = () => threadSubject({
  prospect_id: '33efc8cb-7c1e-4820-8049-14f683b0a813', prospect_name: 'Angel Wang', prospect_company: 'Seeking Alpha',
  channel: 'linkedin', stage: 'replied', hasPendingDraft: true,
  messages: [{ direction: 'inbound', created_at: '2026-09-27T09:34:00Z', message_text: 'later' }],
}, 'Davorin Smit')

const field = () => screen.getByLabelText('Message to Claude') as HTMLTextAreaElement
const verb = (v: string) => document.querySelector(`[data-verb="${v}"]`) as HTMLElement

describe('Claude drawer verbs', () => {
  it('send: the typed text goes to chat.send with the page subject only; the field clears', async () => {
    const chat = fakeChat()
    renderInFrame(<Host chat={chat} />)
    fireEvent.change(field(), { target: { value: 'what is waiting' } })
    fireEvent.click(verb('send'))
    const [text, about, see] = (chat.send as ReturnType<typeof vi.fn>).mock.calls[0]
    expect([text, about]).toEqual(['what is waiting', undefined])
    expect(see).toMatch(/He is on the DMs screen, in all lanes\./)
    expect(field().value).toBe('')
  })
  it('detach all: nothing travels', async () => {
    const chat = fakeChat()
    renderInFrame(<Host chat={chat} />)
    fireEvent.click(verb('peek'))
    fireEvent.click(verb('detach-all'))
    fireEvent.change(field(), { target: { value: 'x' } })
    fireEvent.click(verb('send'))
    expect((chat.send as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBeUndefined()
  })
  it('/model via the Send key runs the command and never sends the text', () => {
    const chat = fakeChat()
    renderInFrame(<Host chat={chat} />)
    fireEvent.change(field(), { target: { value: '/model default' } })
    fireEvent.click(verb('send'))
    expect(chat.send).not.toHaveBeenCalled()
    expect(chat.setWanted).toHaveBeenCalledWith(null)
  })
  it('a starter on an empty chat sends today\'s words', () => {
    const chat = fakeChat()
    renderInFrame(<Host chat={chat} />)
    fireEvent.click(screen.getByText('What needs me'))
    expect((chat.send as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('What is waiting on me right now?')
  })
  it('send carries the DMs hand-off: about = the name, see = names-only block; remove-subject drops it', async () => {
    const chat = fakeChat()
    renderInFrame(<Host chat={chat} />)
    act(() => handOffToClaude({ subject: angel(), intent: 'ask' }))
    expect(await screen.findByText('Angel Wang · Arch · draft waiting')).toBeTruthy()
    expect(field().placeholder).toBe('Ask about Angel…')
    fireEvent.change(field(), { target: { value: 'what next' } })
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true })
    const [, about, see] = (chat.send as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(about).toBe('Angel Wang')
    expect(see).toMatch(/Open conversation with Angel Wang/)
    expect(see).toMatch(/not attached/)
    fireEvent.click(verb('remove-subject'))
    expect(await screen.findByText('Attach Angel Wang')).toBeTruthy()
    fireEvent.change(field(), { target: { value: 'after detach' } })
    fireEvent.click(verb('send'))
    const [, , see2] = (chat.send as ReturnType<typeof vi.fn>).mock.calls[1]
    expect(see2 ?? '').not.toMatch(/Angel Wang/)
  })
  it('attach-full switches the next message to the whole conversation', async () => {
    const chat = fakeChat()
    renderInFrame(<Host chat={chat} />)
    act(() => handOffToClaude({ subject: angel(), intent: 'ask' }))
    fireEvent.click(await screen.findByText('Names only'))
    fireEvent.change(field(), { target: { value: 'x' } })
    fireEvent.click(verb('send'))
    expect((chat.send as ReturnType<typeof vi.fn>).mock.calls[0][2]).toMatch(/Angel Wang: later/)
  })
  it('stop while a turn runs calls chat.abort; send is not offered', () => {
    const chat = fakeChat({ busy: true, status: 'streaming' })
    renderInFrame(<Host chat={chat} />)
    expect(verb('send')).toBeNull()
    fireEvent.click(verb('stop'))
    expect(chat.abort).toHaveBeenCalled()
  })
  it('mute: the Pushes switch calls setBotPushMuted(true)', async () => {
    const chat = fakeChat()
    renderInFrame(<Host chat={chat} />)
    fireEvent.click(verb('chats'))
    fireEvent.click(await screen.findByRole('switch'))
    expect(chat.setBotPushMuted).toHaveBeenCalledWith(true)
    expect(await screen.findByText(/1 turn · failed/)).toBeTruthy()
  })
  it('new chat and opening a chat use the handle', async () => {
    const chat = fakeChat()
    renderInFrame(<Host chat={chat} />)
    fireEvent.click(verb('new-chat'))
    expect(chat.newThread).toHaveBeenCalled()
    fireEvent.click(verb('chats'))
    fireEvent.click(await screen.findByText('One line, no tools'))
    expect(chat.openThread).toHaveBeenCalledWith('t2')
  })
  it('run-job dispatches the typed text as a prompt job', async () => {
    const chat = fakeChat()
    renderInFrame(<Host chat={chat} />)
    fireEvent.change(field(), { target: { value: 'run this' } })
    fireEvent.click(screen.getByLabelText('More: commands, model, runner'))
    fireEvent.click(verb('run-job'))
    await waitFor(() => expect(jobs.dispatchJob).toHaveBeenCalledWith({ kind: 'prompt', input: 'run this', cwd: null, model: null }))
  })
  it('a / command runs locally and never sends', () => {
    const chat = fakeChat({ turns: [{ id: 'a', role: 'user', text: 'x', tools: [], error: null }] as ChatHandle['turns'] })
    renderInFrame(<Host chat={chat} />)
    fireEvent.change(field(), { target: { value: '/clear' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(chat.reset).toHaveBeenCalled()
    expect(chat.send).not.toHaveBeenCalled()
  })
})
