// @vitest-environment jsdom
// Verb wiring: each key calls TODAY'S lib write with today's arguments, both legs on a pair,
// and the two-way discard passes the mode. The lib is mocked; the rules under it are not.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'

vi.mock('../../lib/inbox', async orig => {
  const real = await orig<typeof import('../../lib/inbox')>()
  return {
    ...real,
    approveDraft: vi.fn(async () => {}), saveDraftText: vi.fn(async () => {}), saveDraftEmail: vi.fn(async () => {}), saveDraftEmailCc: vi.fn(async () => []),
    snoozeDraft: vi.fn(async () => {}), unsnoozeDraft: vi.fn(async () => {}), restoreDraft: vi.fn(async () => true),
    discardLegs: vi.fn(async () => []), composeReply: vi.fn(async () => []), markThreadRead: vi.fn(async () => {}),
    emailReplyTarget: vi.fn(async () => ({ recipient_email: 'ofir.b@doktorabc.com', message_text_prefix: 'Subject: Re: Meeting\n\n' })),
    markSpam: vi.fn(async () => {}), markNotSpam: vi.fn(async () => {}),
  }
})
vi.mock('../../lib/followUp', async orig => ({ ...(await orig<typeof import('../../lib/followUp')>()), fetchFollowUp: vi.fn(async () => null), setFollowUp: vi.fn(async () => {}) }))

import * as lib from '../../lib/inbox'
import { DmAsks } from './asks'
import { NOW, drafted, msg, threads } from './fixtures'
import { ThreadPane } from './Thread'
import { useDmVerbs } from './verbs'
import type { Thread } from '../../lib/inbox'
import type { PreReadHandle } from '../../exp/v2c/chat/usePreRead'

const pre: PreReadHandle = { get: () => ({ s: 'none' }), run: () => {}, busy: false, spent: 0, capped: false }
const ctx = { refresh: vi.fn(), patch: vi.fn() }

function Pane({ t }: { t: Thread }) {
  const verbs = useDmVerbs(ctx)
  return <ThreadPane t={t} all={[t]} phone={false} verbs={verbs} now={NOW} onBack={() => {}} onAsk={() => {}} onMenu={() => {}} staleN={0} pre={pre} reload={() => {}} />
}
const mount = (t: Thread) => renderInFrame(<DmAsks><Pane t={t} /></DmAsks>, { hash: '#exp/d/dms' })
const key = (v: string) => document.querySelector(`[data-verb="${v}"]`) as HTMLElement

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); vi.clearAllMocks(); vi.mocked(lib.saveDraftEmailCc).mockReset().mockResolvedValue([]) })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('direct email reply', () => {
  const emailThread = (client = 'arch') => threads([
    msg({ prospect_id: 'ofir', prospect_name: 'Ofir Bello', client_id: client, direction: 'inbound', channel: 'email', message_type: 'email_reply', recipient_email: 'ofir.b@doktorabc.com', prospect_email: 'ofir.b@doktorabc.com', sent_at: '2026-09-27T08:00:00Z', message_text: 'Are you still in the meeting?' }),
    msg({ prospect_id: 'ofir', prospect_name: 'Ofir Bello', client_id: client, direction: 'inbound', channel: 'linkedin', sent_at: '2026-09-27T09:00:00Z', created_at: '2026-09-27T09:00:00Z', message_text: 'I emailed you.' }),
  ])[0]

  it('opens and focuses an email reply from a mixed thread; sends only after confirmation', async () => {
    const t = emailThread()
    mount(t)
    fireEvent.click(screen.getByRole('button', { name: 'Reply by email' }))
    const input = screen.getByRole('textbox', { name: 'Write to Ofir yourself' })
    expect(document.activeElement).toBe(input)
    expect(lib.composeReply).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText(/From davorin@madebyarch.com/).textContent).toContain('ofir.b@doktorabc.com'))
    fireEvent.change(input, { target: { value: 'Thursday works for me.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }))
    expect(lib.composeReply).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByText('Send it'))
    await waitFor(() => expect(lib.composeReply).toHaveBeenCalledWith(expect.objectContaining({ prospect_id: 'ofir', channel: 'email' }), 'Thursday works for me.'))
  })

  it('keeps email reply unavailable for an unsupported sender', () => {
    mount(emailThread('risedtc'))
    expect(screen.queryByRole('button', { name: 'Reply by email' })).toBeNull()
  })

  it('can reply to received email before a LinkedIn connection is accepted', () => {
    mount({ ...emailThread(), stage: 'engaged' })
    fireEvent.click(screen.getByRole('button', { name: 'Reply by email' }))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Write to Ofir yourself' }))
  })

  it('shows the email delivery identity even before the reply button is clicked', async () => {
    const t = { ...emailThread(), channel: 'email' as const }
    mount(t)
    fireEvent.focus(screen.getByRole('textbox', { name: 'Write to Ofir yourself' }))
    await waitFor(() => expect(screen.getByText(/From davorin@madebyarch.com/).textContent).toContain('ofir.b@doktorabc.com'))
    expect(screen.queryByText(/Davorin's LinkedIn/)).toBeNull()
  })

  it('shows the resolved sender of the email when a colleague replies', async () => {
    vi.mocked(lib.emailReplyTarget).mockResolvedValueOnce({ recipient_email: 'colleague@doktorabc.com', message_text_prefix: 'Subject: Re: Meeting\n\n' })
    mount(emailThread())
    fireEvent.click(screen.getByRole('button', { name: 'Reply by email' }))
    await waitFor(() => expect(screen.getByText(/From davorin@madebyarch.com/).textContent).toContain('colleague@doktorabc.com'))
  })

  it('keeps the text but blocks email submission when the recipient cannot be loaded; offers retry', async () => {
    vi.mocked(lib.emailReplyTarget).mockRejectedValueOnce(new Error('Email lookup failed'))
    mount(emailThread())
    fireEvent.click(screen.getByRole('button', { name: 'Reply by email' }))
    const input = screen.getByRole('textbox', { name: 'Write to Ofir yourself' })
    fireEvent.change(input, { target: { value: 'Thursday works.' } })
    await screen.findByText('Email lookup failed')
    expect((screen.getByRole('button', { name: 'Send email' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(lib.composeReply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry email details' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send email' }) as HTMLButtonElement).disabled).toBe(false))
    expect((input as HTMLTextAreaElement).value).toBe('Thursday works.')
  })
})

describe('DM verbs', () => {
  it('shows saved CC beside the mirror and saves edited CC before approval', async () => {
    const [t] = threads(drafted('thomas', { prospect_name: 'Thomas', client_id: 'risedtc', recipient_email: 'thomas@vmisports.com', email_mirror_text: 'Subject: VMI scan\n\nHey Thomas and Michael,', email_cc: ['michael@vmisports.com'] }))
    mount(t)
    const cc = screen.getByRole('textbox', { name: 'CC recipients' })
    expect((cc as HTMLInputElement).value).toBe('michael@vmisports.com')
    fireEvent.change(cc, { target: { value: 'michael@vmisports.com, other@vmisports.com' } })
    fireEvent.click(key('send'))
    fireEvent.click(await screen.findByText('Approve & send'))
    await waitFor(() => expect(lib.saveDraftEmailCc).toHaveBeenCalledWith(t.draft!.id, 'michael@vmisports.com, other@vmisports.com'))
    expect(vi.mocked(lib.saveDraftEmailCc).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(lib.approveDraft).mock.invocationCallOrder[0])
  })
  it('keeps the whole draft unapproved when CC cannot be saved', async () => {
    const [t] = threads(drafted('thomas', { prospect_name: 'Thomas', client_id: 'risedtc', recipient_email: 'thomas@vmisports.com', email_mirror_text: 'Subject: VMI scan\n\nScan', email_cc: [] }))
    vi.mocked(lib.saveDraftEmailCc).mockRejectedValueOnce(new Error('Enter a valid CC email address.'))
    mount(t)
    fireEvent.change(screen.getByRole('textbox', { name: 'CC recipients' }), { target: { value: 'Michael' } })
    fireEvent.click(key('send'))
    fireEvent.click(await screen.findByText('Approve & send'))
    await screen.findByText(/Enter a valid CC email address/)
    expect(lib.approveDraft).not.toHaveBeenCalled()
  })
  it('Send confirms, then approves the draft with its text and the chat id', async () => {
    const [t] = threads(drafted('a', { prospect_name: 'Geraldine', unipile_chat_id: 'chat1' }))
    mount(t)
    fireEvent.click(key('send'))
    fireEvent.click(await screen.findByText('Approve & send'))
    await waitFor(() => expect(lib.approveDraft).toHaveBeenCalledWith(t.draft!.id, t.draft!.message_text, 'chat1'))
  })

  it('Send both approves both legs; the email leg without a chat id', async () => {
    const rows = [...drafted('p', { prospect_name: 'Sally', client_id: 'risedtc' }),
      msg({ prospect_id: 'p', prospect_name: 'Sally', client_id: 'risedtc', channel: 'email', message_text: 'Email leg', created_at: new Date(NOW - 3_000_000).toISOString(), recipient_email: 's@x.com' })]
    const [t] = threads(rows)
    expect(t.companionDraft).not.toBeNull()
    mount(t)
    expect(key('send').textContent).toContain('Send both')
    fireEvent.click(key('send'))
    fireEvent.click(await screen.findByText('Approve & send both'))
    await waitFor(() => expect(lib.approveDraft).toHaveBeenCalledTimes(2))
    expect(vi.mocked(lib.approveDraft).mock.calls[1]).toEqual([t.companionDraft!.id, 'Email leg', null])
  })

  it('Holding Send never skips the confirm (today always asks)', async () => {
    const [t] = threads(drafted('h', { prospect_name: 'Hold' }))
    mount(t)
    fireEvent.pointerDown(key('send'), { button: 0 })
    await vi.advanceTimersByTimeAsync(900)
    fireEvent.pointerUp(key('send'))
    expect(lib.approveDraft).not.toHaveBeenCalled()
    fireEvent.click(key('send'))
    expect(await screen.findByText('Approve & send')).toBeTruthy()
    expect(lib.approveDraft).not.toHaveBeenCalled()
  })

  it('Discard is a danger confirm: Enter on it does not discard', async () => {
    const [t] = threads(drafted('e', { prospect_name: 'Eve' }))
    mount(t)
    fireEvent.click(key('discard'))
    const red = await waitFor(() => key('discard-confirm'))
    expect(red.className).toContain('d-key-d')
    expect(document.activeElement).toBe(key('cancel'))
    red.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await vi.advanceTimersByTimeAsync(50)
    expect(lib.discardLegs).not.toHaveBeenCalled()
  })

  it('Discard offers two keys; "I\'ll reply myself" passes the mode, and Undo restores', async () => {
    const [t] = threads(drafted('d', { prospect_name: 'Dana' }))
    mount(t)
    fireEvent.click(key('discard'))
    fireEvent.click(await waitFor(() => key('discard-myself')))
    await waitFor(() => expect(lib.discardLegs).toHaveBeenCalledWith([t.draft], 'reply_myself'))
    fireEvent.click(await waitFor(() => key('undo')))
    await waitFor(() => expect(lib.restoreDraft).toHaveBeenCalledWith(t.draft!.id))
  })

  it('Later saves the edit first, then parks the draft', async () => {
    const [t] = threads(drafted('l', { prospect_name: 'Lee' }))
    mount(t)
    expect(key('edit')).toBeNull()
    fireEvent.change(document.querySelector('.dm-edit')!, { target: { value: 'New words' } })
    fireEvent.click(key('later'))
    fireEvent.click(await waitFor(() => key('date-1w')))
    await waitFor(() => expect(lib.snoozeDraft).toHaveBeenCalled())
    expect(lib.saveDraftText).toHaveBeenCalledWith(t.draft!.id, 'New words')
    expect(vi.mocked(lib.saveDraftText).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(lib.snoozeDraft).mock.invocationCallOrder[0])
  })

  it('The composer sends free-typed words after the confirm', async () => {
    const [t] = threads(drafted('c', { prospect_name: 'Cam' }))
    mount(t)
    fireEvent.change(document.querySelector('.dm-comp textarea')!, { target: { value: 'My own words' } })
    fireEvent.click(document.querySelector('.dm-comp [data-verb="compose-send"]')!)
    fireEvent.click(await screen.findByText('Send it'))
    await waitFor(() => expect(lib.composeReply).toHaveBeenCalledWith(t, 'My own words'))
  })

  it('a no-draft owed thread shows Draft it and the big composer, never Discard', () => {
    const [t] = threads(drafted('n', { prospect_name: 'Nod', client_id: 'arch' }).slice(0, 2))
    mount(t)
    expect(key('draft-it')).toBeTruthy()
    expect(key('discard')).toBeNull()
    expect(document.querySelector('[data-d-thread-who]')?.textContent).toBe('Nod')
  })
})
