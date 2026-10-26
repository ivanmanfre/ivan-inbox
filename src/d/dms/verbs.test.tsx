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
    approveDraft: vi.fn(async () => {}), saveDraftText: vi.fn(async () => {}), saveDraftEmail: vi.fn(async () => {}), saveDraftEmailCc: vi.fn(async () => []), setDraftSendVia: vi.fn(async () => ({ recipient_email: null, email_delivery_recipient: 'anthony@example.com', email_cc: [], draft_evidence: { email_cc: [], email_delivery_recipient: 'anthony@example.com' } })),
    snoozeDraft: vi.fn(async () => {}), unsnoozeDraft: vi.fn(async () => {}), restoreDraft: vi.fn(async () => true),
    discardLegs: vi.fn(async () => []), composeReply: vi.fn(async () => []), markThreadRead: vi.fn(async () => {}),
    emailReplyTarget: vi.fn(async () => ({ recipient_email: 'ofir.b@doktorabc.com', message_text_prefix: 'Subject: Re: Meeting\n\n' })),
    markSpam: vi.fn(async () => {}), markNotSpam: vi.fn(async () => {}),
    readSendState: vi.fn(async () => []), findLandedReply: vi.fn(async () => null),
  }
})
vi.mock('../../lib/followUp', async orig => ({ ...(await orig<typeof import('../../lib/followUp')>()), fetchFollowUp: vi.fn(async () => null), setFollowUp: vi.fn(async () => {}) }))
vi.mock('../../lib/context', async orig => ({ ...(await orig<typeof import('../../lib/context')>()), fetchProspectContext: vi.fn(async () => ({ location: 'London, United Kingdom' })) }))
vi.mock('../../lib/dmSchedule', async orig => ({ ...(await orig<typeof import('../../lib/dmSchedule')>()), scheduleDm: vi.fn(async () => {}) }))
vi.mock('../../lib/emailDetails', () => ({ fetchEmailDetails: vi.fn(async () => []) }))

vi.mock('../../lib/rejectedDm', async orig => ({ ...(await orig<typeof import('../../lib/rejectedDm')>()), sendRejectedDm: vi.fn(async () => {}), editHeldDm: vi.fn(async () => {}) }))
import { editHeldDm, sendRejectedDm } from '../../lib/rejectedDm'
import * as lib from '../../lib/inbox'
import { DmAsks } from './asks'
import { NOW, drafted, msg, threads } from './fixtures'
import { ThreadPane } from './Thread'
import { NO_ANSWER_NOT_SENT, NO_ANSWER_UNCHECKED, useDmVerbs } from './verbs'
import { NoAnswerError } from '../../lib/noAnswer'
import { stopWatching, watchedIds, WATCH_EVERY_MS } from './sendWatch'
import { resetDraftJobs, resetPaneBusy } from './paneBusy'
import { forwardInboxEmail } from '../../lib/emailForward'
import { scheduleDm } from '../../lib/dmSchedule'
import type { Thread } from '../../lib/inbox'
import type { PreReadHandle } from '../../exp/v2c/chat/usePreRead'

const pre: PreReadHandle = { get: () => ({ s: 'none' }), run: () => {}, busy: false, spent: 0, capped: false }
const ctx = { refresh: vi.fn(), patch: vi.fn() }

function Pane({ t, v4 = false }: { t: Thread; v4?: boolean }) {
  const verbs = useDmVerbs(ctx)
  return <ThreadPane v4={v4} t={t} all={[t]} phone={false} verbs={verbs} now={NOW} onBack={() => {}} onAsk={() => {}} onMenu={() => {}} staleN={0} pre={pre} reload={() => {}} />
}
const mount = (t: Thread, v4 = false) => renderInFrame(<DmAsks><Pane t={t} v4={v4} /></DmAsks>, { hash: '#exp/d/dms' })
const key = (v: string) => document.querySelector(`[data-verb="${v}"]`) as HTMLElement

vi.mock('../../lib/emailForward', async orig => ({ ...(await orig<typeof import('../../lib/emailForward')>()), forwardInboxEmail: vi.fn(async () => 'forwarded-id') }))

beforeEach(() => { stopWatching(); resetPaneBusy(); resetDraftJobs(); vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); vi.clearAllMocks(); vi.mocked(lib.saveDraftEmailCc).mockReset().mockResolvedValue([]) })
afterEach(() => { cleanup(); stopWatching(); vi.useRealTimers() })

describe('direct email reply', () => {
  const emailThread = (client = 'arch') => threads([
    msg({ prospect_id: 'ofir', prospect_name: 'Ofir Bello', client_id: client, direction: 'inbound', channel: 'email', message_type: 'email_reply', recipient_email: 'ofir.b@doktorabc.com', prospect_email: 'ofir.b@doktorabc.com', sent_at: '2026-09-27T08:00:00Z', message_text: 'Are you still in the meeting?' }),
    msg({ prospect_id: 'ofir', prospect_name: 'Ofir Bello', client_id: client, direction: 'inbound', channel: 'linkedin', sent_at: '2026-09-27T09:00:00Z', created_at: '2026-09-27T09:00:00Z', message_text: 'I emailed you.' }),
  ])[0]

  it('forwards a received email without approving, discarding, or replying to the prospect', async () => {
    const t = emailThread()
    mount(t)
    fireEvent.click(screen.getByRole('button', { name: 'Forward to email' }))
    expect(forwardInboxEmail).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Forward email' }))
    await screen.findByText('Forwarded to davorinsmit@arch.agency.')
    expect(forwardInboxEmail).toHaveBeenCalledWith(t.messages[0].id, 'davorinsmit@arch.agency', '', expect.any(String))
    expect(lib.composeReply).not.toHaveBeenCalled()
    expect(lib.discardLegs).not.toHaveBeenCalled()
    expect(lib.approveDraft).not.toHaveBeenCalled()
  })

  it('opens and focuses an email reply from a mixed thread; sends only after confirmation', async () => {
    const t = emailThread()
    mount(t)
    fireEvent.click(screen.getByRole('button', { name: 'Reply by email' }))
    const input = screen.getByRole('textbox', { name: 'Email reply' })
    expect(document.activeElement).toBe(input)
    expect(lib.composeReply).not.toHaveBeenCalled()
    await waitFor(() => expect(document.querySelector('.dm-email-composer')!.textContent).toContain('ofir.b@doktorabc.com'))
    expect(screen.getByText('Re: Meeting')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'Thursday works for me.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }))
    expect(lib.composeReply).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByText('Send it'))
    await waitFor(() => expect(lib.composeReply).toHaveBeenCalledWith(expect.objectContaining({ prospect_id: 'ofir', channel: 'email' }), 'Thursday works for me.', expect.objectContaining({ recipient_email: 'ofir.b@doktorabc.com', message_text_prefix: 'Subject: Re: Meeting\n\n' })))
  })

  it('keeps email reply unavailable for an unsupported sender', () => {
    mount(emailThread('risedtc'))
    expect(screen.queryByRole('button', { name: 'Reply by email' })).toBeNull()
  })

  it('can reply to received email before a LinkedIn connection is accepted', () => {
    mount({ ...emailThread(), stage: 'engaged' })
    fireEvent.click(screen.getByRole('button', { name: 'Reply by email' }))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Email reply' }))
  })

  it('shows the email delivery identity even before the reply button is clicked', async () => {
    const t = { ...emailThread(), channel: 'email' as const }
    mount(t)
    fireEvent.focus(screen.getByRole('textbox', { name: 'Email reply' }))
    await waitFor(() => expect(document.querySelector('.dm-email-composer')!.textContent).toContain('ofir.b@doktorabc.com'))
    expect(document.querySelector('.dm-email-composer')!.textContent).toContain('davorin@madebyarch.com')
    expect(screen.queryByText(/Davorin's LinkedIn/)).toBeNull()
  })

  it('shows the resolved sender of the email when a colleague replies', async () => {
    vi.mocked(lib.emailReplyTarget).mockResolvedValueOnce({ recipient_email: 'colleague@doktorabc.com', message_text_prefix: 'Subject: Re: Meeting\n\n' })
    mount(emailThread())
    fireEvent.click(screen.getByRole('button', { name: 'Reply by email' }))
    await waitFor(() => expect(document.querySelector('.dm-email-composer')!.textContent).toContain('colleague@doktorabc.com'))
  })

  it('keeps the text but blocks email submission when the recipient cannot be loaded; offers retry', async () => {
    vi.mocked(lib.emailReplyTarget).mockRejectedValueOnce(new Error('Email lookup failed'))
    mount(emailThread())
    fireEvent.click(screen.getByRole('button', { name: 'Reply by email' }))
    const input = screen.getByRole('textbox', { name: 'Email reply' })
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
  it('schedules a paired draft with the companion CC saved from the visible editor', async () => {
    const [t] = threads(drafted('paired', { client_id: 'arch' }))
    t.companionDraft = msg({ prospect_id: 'paired', client_id: 'arch', channel: 'email', message_type: 'email', recipient_email: 'casey@example.com', message_text: 'Subject: Examples\n\nHere are the details.', email_cc: ['old@example.com'] })
    mount(t, true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Email leg CC recipients' }), { target: { value: 'new@example.com' } })
    fireEvent.click(key('schedule-send'))
    await screen.findByLabelText('Send date')
    await waitFor(() => expect((screen.getByLabelText('Recipient timezone') as HTMLSelectElement).value).toBe('Europe/London'))
    fireEvent.change(screen.getByLabelText('Send date'), { target: { value: '2026-09-29' } })
    fireEvent.click(key('confirm-schedule'))
    await waitFor(() => expect(scheduleDm).toHaveBeenCalledTimes(1))
    expect(vi.mocked(scheduleDm).mock.calls[0][5]?.[1]).toMatchObject({ id: t.companionDraft.id, email_cc: ['new@example.com'] })
  })
  it('confirms the email-only envelope and carries that choice into approval', async () => {
    const [t] = threads(drafted('doug', { client_id: 'arch', recipient_email: 'doug@outplay.com', email_mirror_text: 'Subject: Follow-up\n\nDid you see the examples?', send_via: 'email', draft_evidence: { send_via: 'email' } }))
    mount(t)
    expect(key('send').textContent).toContain('Send email')
    expect(screen.queryByRole('textbox', { name: 'The draft' })).toBeNull()
    fireEvent.click(key('send'))
    await screen.findByText(/Only the email to doug@outplay.com \(from davorin@madebyarch.com\) will be sent/)
    expect(lib.approveDraft).not.toHaveBeenCalled()
    fireEvent.click(key('confirm-send'))
    await waitFor(() => expect(lib.approveDraft).toHaveBeenCalledTimes(1))
    expect(vi.mocked(lib.approveDraft).mock.calls[0][3]).toMatchObject({ send_via: 'email', recipient_email: 'doug@outplay.com' })
  })
  it('saves attached email opt-out without approving any message', async () => {
    const [t] = threads(drafted('anthony', { client_id: 'risedtc', recipient_email: 'anthony@example.com', email_mirror_text: 'Subject: Call' }))
    mount(t)
    fireEvent.change(screen.getByRole('combobox', { name: 'Send via' }), { target: { value: 'dm' } })
    await waitFor(() => expect(lib.setDraftSendVia).toHaveBeenCalledWith(t.draft!.id, 'dm'))
    expect(ctx.patch).toHaveBeenCalledWith([t.draft!.id], expect.objectContaining({ recipient_email: null, email_cc: [] }))
    expect(lib.approveDraft).not.toHaveBeenCalled()
  })
  it('approves a DM-only draft without adding CC back to the inactive email', async () => {
    const [t] = threads(drafted('anthony', { client_id: 'risedtc', recipient_email: null, email_delivery_recipient: 'anthony@example.com', email_mirror_text: 'Subject: Call', email_cc: [] }))
    mount(t)
    fireEvent.click(key('send'))
    await screen.findByText(/Only the LinkedIn DM will be sent. The sender/)
    await screen.findByRole('alertdialog')
    fireEvent.click(key('confirm-send'))
    await waitFor(() => expect(lib.approveDraft).toHaveBeenCalledTimes(1))
    expect(lib.saveDraftEmailCc).not.toHaveBeenCalled()
  })

  it('shows saved CC beside the mirror and saves edited CC before approval', async () => {
    const [t] = threads(drafted('thomas', { prospect_name: 'Thomas', client_id: 'risedtc', recipient_email: 'thomas@vmisports.com', email_mirror_text: 'Subject: VMI scan\n\nHey Thomas and Michael,', email_cc: ['michael@vmisports.com'] }))
    mount(t)
    expect((screen.getByRole('textbox', { name: 'Email subject' }) as HTMLInputElement).value).toBe('VMI scan')
    expect((screen.getByRole('textbox', { name: 'The email that goes with it' }) as HTMLTextAreaElement).value).toBe('Hey Thomas and Michael,')
    expect(screen.getByText('Email draft')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show email' })).toBeNull()
    const cc = screen.getByRole('textbox', { name: 'CC recipients' })
    expect((cc as HTMLInputElement).value).toBe('michael@vmisports.com')
    fireEvent.change(cc, { target: { value: 'michael@vmisports.com, other@vmisports.com' } })
    fireEvent.click(key('send'))
    await screen.findByRole('alertdialog')
    fireEvent.click(key('confirm-send'))
    await waitFor(() => expect(lib.saveDraftEmailCc).toHaveBeenCalledWith(t.draft!.id, 'michael@vmisports.com, other@vmisports.com'))
    expect(vi.mocked(lib.saveDraftEmailCc).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(lib.approveDraft).mock.invocationCallOrder[0])
    expect(vi.mocked(lib.approveDraft).mock.calls[0][3]).toMatchObject({
      recipient_email: 'thomas@vmisports.com', email_cc: ['michael@vmisports.com', 'other@vmisports.com'],
    })
  })

  it('autosaves an edited email subject without approval and carries it before Send approval', async () => {
    const [t] = threads(drafted('mathew', { prospect_name: 'Mathew', client_id: 'risedtc', recipient_email: 'mathew@fraseskin.com.au', email_mirror_text: 'Subject: Old subject\n\nHi Mathew, exact words.' }))
    mount(t)
    const subject = screen.getByRole('textbox', { name: 'Email subject' })
    fireEvent.change(subject, { target: { value: 'RISE introduction for Frase Skin' } })
    fireEvent.blur(subject)
    await waitFor(() => expect(lib.saveDraftEmail).toHaveBeenCalledWith(t.draft!.id, 'Subject: RISE introduction for Frase Skin\n\nHi Mathew, exact words.'))
    expect(lib.approveDraft).not.toHaveBeenCalled()
    fireEvent.change(subject, { target: { value: 'Edited immediately before approval' } })
    fireEvent.click(key('send'))
    expect(lib.approveDraft).not.toHaveBeenCalled()
    await screen.findByRole('alertdialog')
    fireEvent.click(key('confirm-send'))
    await waitFor(() => expect(lib.approveDraft).toHaveBeenCalledTimes(1))
    expect(vi.mocked(lib.saveDraftEmail).mock.calls.at(-1)).toEqual([t.draft!.id, 'Subject: Edited immediately before approval\n\nHi Mathew, exact words.'])
    expect(vi.mocked(lib.saveDraftEmail).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(lib.approveDraft).mock.invocationCallOrder[0])
    expect(vi.mocked(lib.approveDraft).mock.calls[0][3]?.email_mirror_text).toBe('Subject: Edited immediately before approval\n\nHi Mathew, exact words.')
  })
  it('keeps the whole draft unapproved when CC cannot be saved', async () => {
    const [t] = threads(drafted('thomas', { prospect_name: 'Thomas', client_id: 'risedtc', recipient_email: 'thomas@vmisports.com', email_mirror_text: 'Subject: VMI scan\n\nScan', email_cc: [] }))
    vi.mocked(lib.saveDraftEmailCc).mockRejectedValueOnce(new Error('Enter a valid CC email address.'))
    mount(t)
    fireEvent.change(screen.getByRole('textbox', { name: 'CC recipients' }), { target: { value: 'Michael' } })
    fireEvent.click(key('send'))
    await screen.findByRole('alertdialog')
    fireEvent.click(key('confirm-send'))
    await screen.findByText(/Enter a valid CC email address/)
    expect(lib.approveDraft).not.toHaveBeenCalled()
  })
  it('Send confirms, then approves the draft with its text and the chat id', async () => {
    const [t] = threads(drafted('a', { prospect_name: 'Geraldine', unipile_chat_id: 'chat1' }))
    mount(t)
    fireEvent.click(key('send'))
    fireEvent.click(await screen.findByText('Approve & send'))
    await waitFor(() => expect(lib.approveDraft).toHaveBeenCalledWith(t.draft!.id, t.draft!.message_text, 'chat1', expect.objectContaining({ id: t.draft!.id })))
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
    expect(vi.mocked(lib.approveDraft).mock.calls[1]).toEqual([t.companionDraft!.id, 'Email leg', null,
      expect.objectContaining({ id: t.companionDraft!.id, recipient_email: 's@x.com' })])
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


describe('send rejected draft anyways', () => {
  it('shows the rejection, confirms the exact copy, and queues only that original row', async () => {
    const m = msg({ prospect_id: 'blocked', client_id: 'arch', message_text: 'Coffee in Tel Aviv?', ai_model: 'arch_telaviv_trip_v1', send_blocked_at: '2026-09-26T11:00:00Z', send_blocked_reason: 'arch_market_claim_unratified:Israel' })
    const [t] = threads([m]); mount(t)
    fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }))
    expect(sendRejectedDm).not.toHaveBeenCalled()
    expect(screen.getAllByText('Coffee in Tel Aviv?').length).toBeGreaterThan(1)
    fireEvent.click(key('confirm-send-anyways'))
    await waitFor(() => expect(sendRejectedDm).toHaveBeenCalledWith(m, null))
    expect(lib.composeReply).not.toHaveBeenCalled()
    expect(ctx.refresh).toHaveBeenCalled()
  })
  // Ivan 10-21 (Barak Zuman): his own approved reply was held, a newer retry hold pushed it out of the
  // draft pane, and it vanished. It now sits in the timeline as held, with Send anyway and Discard.
  it('a held reply pushed out of the pane by a newer retry hold is a held bubble with both actions', async () => {
    const pid = 'barak'
    const held = msg({ prospect_id: pid, client_id: 'arch', ai_model: 'arch_reply_draft_v2', created_at: '2026-09-26T11:17:52Z', message_text: "All good! Just let me know which day you're in Tel Aviv",
      send_blocked_at: '2026-09-26T11:28:42Z', send_blocked_reason: 'lint_calendar_proposal_edited' })
    const retry = msg({ prospect_id: pid, client_id: 'arch', message_text: '', created_at: '2026-09-26T12:07:43Z', send_blocked_at: '2026-09-26T12:07:43Z', send_blocked_reason: 'reply_retry_pending' })
    const [t] = threads([msg({ prospect_id: pid, client_id: 'arch', direction: 'inbound', sent_at: '2026-09-26T10:24:08Z', message_text: "No I won't be there :/" }), held, retry])
    expect(t.draft).toBeNull()
    mount(t)
    const bubble = document.querySelector(`[data-msg="${held.id}"]`)!
    expect(bubble.hasAttribute('data-held')).toBe(true)
    expect(bubble.textContent).toContain('Held, not sent')
    expect(bubble.textContent).toContain('The calendar check could not verify the proposed time or wording.')
    fireEvent.click(bubble.querySelector('[data-verb="discard-held"]')!)
    expect(lib.discardLegs).not.toHaveBeenCalled()
    fireEvent.click(await waitFor(() => key('confirm-discard-held')))
    await waitFor(() => expect(lib.discardLegs).toHaveBeenCalledWith([held]))
    expect(ctx.patch).toHaveBeenCalledWith([held.id], expect.objectContaining({ send_blocked_reason: 'discarded_in_inbox' }))
    fireEvent.click(bubble.querySelector('[data-verb="send-anyways"]')!)
    fireEvent.click(await waitFor(() => key('confirm-send-anyways')))
    await waitFor(() => expect(sendRejectedDm).toHaveBeenCalledWith(held, null))
    expect(lib.approveDraft).not.toHaveBeenCalled()
  })
  it('an approved held row offers no Discard (the guarded discard refuses approved rows)', () => {
    const m = msg({ prospect_id: 'geo', client_id: 'arch', message_text: 'Hi Adnan', approved_at: '2026-09-26T10:00:00Z', send_blocked_at: '2026-09-26T11:00:00Z', send_blocked_reason: 'geo_gate_v2:blocked:pakistan' })
    const [t] = threads([m]); mount(t)
    expect(screen.getByText('Held, not sent')).toBeTruthy()
    expect(key('discard-held')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send anyway' })).toBeTruthy()
  })
  it('offers the same override for a lint rejection still in the editor', () => {
    const [t] = threads([msg({ prospect_id: 'lint', send_blocked_at: '2026-09-26T11:00:00Z', send_blocked_reason: 'lint_unbacked_commitment' })])
    mount(t)
    expect(screen.getByRole('button', { name: 'Send anyway' })).toBeTruthy()
  })
})

// SwishDM review fixes (2026-10-19).
// Ivan 10-21 (Leighton Penrose): "i want to edit this dm... it only allows me to mark send anyway but i want
// to edit and send later". Edit opens the held words in the draft editor: Save keeps it held, Send now goes
// through the same Send anyway, Send later through the existing scheduler when it takes the row.
describe('edit a held message', () => {
  const leighton = () => {
    const pid = 'leighton'
    const held = msg({ prospect_id: pid, prospect_name: 'Leighton Penrose', ai_model: 'inbox_scheduled_manual_v1', created_at: '2026-09-26T11:48:46Z', send_blocked_at: '2026-09-26T12:48:04Z', send_blocked_reason: 'duplicate_in_thread',
      message_text: 'Hey man, me again haha\n\nCan you give this a quick look today? https://inboundonsteroids.com/shared/leading-social/' })
    const [t] = threads([msg({ prospect_id: pid, prospect_name: 'Leighton Penrose', sent_at: '2026-09-20T09:46:19Z', message_text: 'Hey Leighton, you still want to get this going for October?' }), held])
    return { held, t }
  }
  const editTo = (held: lib.InboxMessage, text: string) => {
    const bubble = document.querySelector(`[data-msg="${held.id}"]`)!
    fireEvent.click(bubble.querySelector('[data-verb="edit-held"]')!)
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit the held message to Leighton' }), { target: { value: text } })
    return bubble
  }

  it('Save stores the edit and keeps it held: nothing is approved, sent or scheduled', async () => {
    const { held, t } = leighton(); mount(t)
    const bubble = editTo(held, 'Hey Leighton, quick one')
    fireEvent.click(bubble.querySelector('[data-verb="held-edit-save"]')!)
    await waitFor(() => expect(editHeldDm).toHaveBeenCalledWith(held, 'Hey Leighton, quick one'))
    expect(ctx.patch).toHaveBeenCalledWith([held.id], { message_text: 'Hey Leighton, quick one', approved_at: null })
    await screen.findByText('Saved the held message to Leighton Penrose.')
    expect(sendRejectedDm).not.toHaveBeenCalled()
    expect(scheduleDm).not.toHaveBeenCalled()
    expect(lib.approveDraft).not.toHaveBeenCalled()
    expect(lib.saveDraftText).not.toHaveBeenCalled()
    expect(ctx.refresh).toHaveBeenCalled()
  })

  it('Send now saves the edit, then confirms and sends the NEW words through Send anyway', async () => {
    const { held, t } = leighton(); mount(t, true)
    const bubble = editTo(held, 'Hey Leighton, quick one')
    fireEvent.click(bubble.querySelector('[data-verb="held-edit-send"]')!)
    await waitFor(() => expect(editHeldDm).toHaveBeenCalledWith(held, 'Hey Leighton, quick one'))
    expect(sendRejectedDm).not.toHaveBeenCalled()
    expect(screen.getAllByText('Hey Leighton, quick one').length).toBeGreaterThan(0)
    fireEvent.click(await waitFor(() => key('confirm-send-anyways')))
    await waitFor(() => expect(sendRejectedDm).toHaveBeenCalledWith({ ...held, message_text: 'Hey Leighton, quick one', approved_at: null }, null))
    expect(vi.mocked(editHeldDm).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sendRejectedDm).mock.invocationCallOrder[0])
    expect(lib.approveDraft).not.toHaveBeenCalled()
  })

  it('a failed save sends nothing and keeps the editor open', async () => {
    vi.mocked(editHeldDm).mockRejectedValueOnce(new Error('The held message changed. Refresh before editing.'))
    const { held, t } = leighton(); mount(t)
    const bubble = editTo(held, 'Hey Leighton, quick one')
    fireEvent.click(bubble.querySelector('[data-verb="held-edit-send"]')!)
    await screen.findByText('Not saved: The held message changed. Refresh before editing.')
    expect(sendRejectedDm).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox', { name: 'Edit the held message to Leighton' }) as HTMLTextAreaElement).value).toBe('Hey Leighton, quick one')
  })

  it('a gate hold the scheduler refuses offers no Send later', () => {
    const { held, t } = leighton(); mount(t)
    const bubble = editTo(held, 'x')
    expect(bubble.querySelector('[data-verb="held-edit-later"]')).toBeNull()
  })

  it('Send later on a lint hold saves the edit and schedules that same row with the new words', async () => {
    const pid = 'barak'
    const held = msg({ prospect_id: pid, prospect_name: 'Leighton Penrose', client_id: 'arch', ai_model: 'arch_reply_draft_v2', created_at: '2026-09-26T11:17:52Z', message_text: 'Monday 1:45pm?',
      send_blocked_at: '2026-09-26T11:28:42Z', send_blocked_reason: 'lint_calendar_proposal_edited' })
    const retry = msg({ prospect_id: pid, prospect_name: 'Leighton Penrose', client_id: 'arch', message_text: '', created_at: '2026-09-26T12:07:43Z', send_blocked_at: '2026-09-26T12:07:43Z', send_blocked_reason: 'reply_retry_pending' })
    const [t] = threads([msg({ prospect_id: pid, prospect_name: 'Leighton Penrose', client_id: 'arch', direction: 'inbound', sent_at: '2026-09-26T10:24:08Z', message_text: 'When?' }), held, retry])
    mount(t)
    const bubble = editTo(held, 'Tuesday 10:00 your time?')
    fireEvent.click(bubble.querySelector('[data-verb="held-edit-later"]')!)
    await waitFor(() => expect(editHeldDm).toHaveBeenCalledWith(held, 'Tuesday 10:00 your time?'))
    await screen.findByLabelText('Send date')
    await waitFor(() => expect((screen.getByLabelText('Recipient timezone') as HTMLSelectElement).value).toBe('Europe/London'))
    fireEvent.change(screen.getByLabelText('Send date'), { target: { value: '2026-09-29' } })
    fireEvent.click(key('confirm-schedule'))
    await waitFor(() => expect(scheduleDm).toHaveBeenCalledTimes(1))
    const [, ids, texts] = vi.mocked(scheduleDm).mock.calls[0]
    expect(ids).toEqual([held.id])
    expect(texts).toEqual(['Tuesday 10:00 your time?'])
    expect(sendRejectedDm).not.toHaveBeenCalled()
  })
})

describe('SwishDM threads', () => {
  it('a no-draft owed SwishDM thread offers no Draft it (its triage stages reply drafts itself)', () => {
    const [t] = threads(drafted('sw', { prospect_name: 'Sam', client_id: 'swishdm' }).slice(0, 2))
    mount(t)
    expect(key('draft-it')).toBeNull()
    expect(screen.getByText(/reply drafts are staged here automatically/)).toBeTruthy()
  })

  it('approving a held SwishDM reply names the live send window, never "switched on"', async () => {
    const rows = drafted('swr', { prospect_name: 'Sam', client_id: 'swishdm' })
    rows[2] = { ...rows[2], ai_model: 'swishdm_reply_writer_v1', send_blocked_at: '2026-09-27T08:00:00Z', send_blocked_reason: 'awaiting_client_review' }
    const [t] = threads(rows)
    mount(t)
    fireEvent.click(key('send'))
    expect(await screen.findByText(/Approving releases this reply to Jonathan’s LinkedIn sender/)).toBeTruthy()
    expect(screen.queryByText(/switched on/)).toBeNull()
  })

  it('a failed SwishDM send offers no Send anyways and never promises a two-minute send', () => {
    const m = msg({ prospect_id: 'swf', client_id: 'swishdm', message_text: 'DM copy', approved_at: '2026-09-26T10:00:00Z', send_blocked_at: '2026-09-26T11:00:00Z', send_blocked_reason: 'send_failed_429: check LinkedIn before retrying' })
    const [t] = threads([m]); mount(t)
    expect(screen.queryByRole('button', { name: 'Send anyway' })).toBeNull()
    expect(screen.queryByText(/about 2 minutes/)).toBeNull()
  })
})

// Ivan 10-21 (Diane O'Brien): one request never answered, `busy` never cleared, and Send stayed grey in
// every thread until a relaunch. Every database call now ends (noAnswer.ts); after a no-answer the rows
// are read before anything is said, and the key is offered again only when the send did not land.
describe('a request that got no answer', () => {
  const timedOut = { message: 'AbortError: No answer from the server in 20s.', details: '', hint: 'Request was aborted (timeout or manual cancellation)', code: '' }
  const sendKey = () => key('send') as HTMLButtonElement
  const state = (id: string, p: Partial<lib.SendState> = {}): lib.SendState => ({ id, direction: 'outbound', message_text: 'x', message_type: 'dm', channel: 'linkedin', sent_at: null, approved_at: null,
    send_blocked_reason: null, send_blocked_at: null, unipile_message_id: null, created_at: '2026-09-27T09:00:00Z', draft_evidence: null, ...p })
  const press = async () => { fireEvent.click(sendKey()); fireEvent.click(await screen.findByText('Approve & send')) }

  it('a send that did not land says so, patches nothing, and offers Send again', async () => {
    const [t] = threads(drafted('d1', { prospect_name: 'Diane', unipile_chat_id: 'chat1' }))
    vi.mocked(lib.approveDraft).mockRejectedValueOnce(timedOut)
    vi.mocked(lib.readSendState).mockResolvedValueOnce([state(t.draft!.id)])
    mount(t)
    await press()
    await screen.findByText(NO_ANSWER_NOT_SENT)
    expect(lib.readSendState).toHaveBeenCalledWith([t.draft!.id])
    expect(ctx.patch).not.toHaveBeenCalled()
    expect(sendKey().disabled).toBe(false)
    expect(watchedIds()).toEqual([])
  })

  it('a send that landed during the silence shows as queued and is never approved twice', async () => {
    const [t] = threads(drafted('d2', { prospect_name: 'Diane', unipile_chat_id: 'chat1' }))
    vi.mocked(lib.approveDraft).mockRejectedValueOnce(new NoAnswerError(20_000))
    vi.mocked(lib.readSendState).mockResolvedValueOnce([state(t.draft!.id, { approved_at: '2026-09-27T09:15:10Z' })])
    mount(t)
    await press()
    await screen.findByText('Queued to Diane.')
    expect(lib.approveDraft).toHaveBeenCalledTimes(1)
    expect(ctx.patch).toHaveBeenCalledWith([t.draft!.id], expect.objectContaining({ approved_at: expect.any(String) }))
    expect(watchedIds()).toEqual([t.draft!.id])
  })

  it('when the check gets no answer either, it never claims nothing was sent', async () => {
    const [t] = threads(drafted('d3', { prospect_name: 'Diane', unipile_chat_id: 'chat1' }))
    vi.mocked(lib.approveDraft).mockRejectedValueOnce(timedOut)
    vi.mocked(lib.readSendState).mockRejectedValueOnce(timedOut)
    mount(t)
    await press()
    await screen.findByText(NO_ANSWER_UNCHECKED)
    expect(screen.queryByText(NO_ANSWER_NOT_SENT)).toBeNull()
    expect(sendKey().disabled).toBe(false)
  })

  it('a send still running on one thread never greys another; coming back to it still shows it busy', async () => {
    const [a] = threads(drafted('da', { prospect_name: 'Diane', unipile_chat_id: 'chat1' }))
    const [b] = threads(drafted('db', { prospect_name: 'Brad', unipile_chat_id: 'chat2' }))
    vi.mocked(lib.approveDraft).mockImplementationOnce(() => new Promise(() => {}))
    const view = mount(a)
    await press()
    await waitFor(() => expect(sendKey().disabled).toBe(true))
    view.unmount()
    const other = mount(b)
    expect(sendKey().disabled).toBe(false)
    other.unmount()
    mount(a)
    expect(sendKey().disabled).toBe(true)
  })

  it('a hand reply that landed is not inserted again; one that did not is checked before the next insert', async () => {
    const [t] = threads(drafted('dc', { prospect_name: 'Cam' }))
    vi.mocked(lib.composeReply).mockRejectedValueOnce(timedOut)
    vi.mocked(lib.findLandedReply).mockResolvedValueOnce(null).mockResolvedValueOnce(state('new1', { message_type: 'manual_reply', message_text: 'My own words', approved_at: '2026-09-27T09:15:05Z' }))
    mount(t)
    const box = () => document.querySelector('.dm-comp textarea') as HTMLTextAreaElement
    fireEvent.change(box(), { target: { value: 'My own words' } })
    fireEvent.click(document.querySelector('.dm-comp [data-verb="compose-send"]')!)
    fireEvent.click(await screen.findByText('Send it'))
    await screen.findByText(/your reply is not on the thread: nothing was sent/)
    expect(box().value).toBe('My own words')
    expect(lib.composeReply).toHaveBeenCalledTimes(1)
    // Pressed again: the thread is read first, and the reply that landed meanwhile is not inserted twice.
    fireEvent.click(document.querySelector('.dm-comp [data-verb="compose-send"]')!)
    fireEvent.click(await screen.findByText('Send it'))
    await screen.findByText('Queued your reply to Cam.')
    expect(lib.composeReply).toHaveBeenCalledTimes(1)
    expect(lib.findLandedReply).toHaveBeenLastCalledWith('dc', 'My own words')
    expect(lib.discardLegs).toHaveBeenCalledWith([t.draft])
    await waitFor(() => expect(box().value).toBe(''))
  })

  it('a hand reply whose insert landed during the silence is queued once', async () => {
    const [t] = threads(drafted('dd', { prospect_name: 'Cam' }))
    vi.mocked(lib.composeReply).mockRejectedValueOnce(new NoAnswerError(20_000))
    vi.mocked(lib.findLandedReply).mockResolvedValueOnce(state('new2', { message_type: 'manual_reply', message_text: 'Words' }))
    mount(t)
    fireEvent.change(document.querySelector('.dm-comp textarea')!, { target: { value: 'Words' } })
    fireEvent.click(document.querySelector('.dm-comp [data-verb="compose-send"]')!)
    fireEvent.click(await screen.findByText('Send it'))
    await screen.findByText('Queued your reply to Cam.')
    expect(lib.composeReply).toHaveBeenCalledTimes(1)
  })

  it('Send anyway that got no answer reads the row: landed is queued and watched, not landed says so', async () => {
    const m = msg({ prospect_id: 'sa', prospect_name: 'Leighton Penrose', client_id: 'arch', message_text: 'Hey man', send_blocked_at: '2026-09-26T11:00:00Z', send_blocked_reason: 'duplicate_in_thread' })
    const [t] = threads([m]); mount(t)
    vi.mocked(sendRejectedDm).mockRejectedValueOnce(timedOut).mockRejectedValueOnce(timedOut)
    vi.mocked(lib.readSendState).mockResolvedValueOnce([state(m.id, { send_blocked_reason: 'duplicate_in_thread' })]).mockResolvedValueOnce([state(m.id, { approved_at: '2026-09-27T09:15:10Z' })])
    fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }))
    fireEvent.click(await waitFor(() => key('confirm-send-anyways')))
    await screen.findByText(NO_ANSWER_NOT_SENT)
    expect(watchedIds()).toEqual([])
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Send anyway' })))
    fireEvent.click(await waitFor(() => key('confirm-send-anyways')))
    await screen.findByText('Queued to Leighton Penrose.')
    expect(watchedIds()).toEqual([m.id])
  })
})

// Ivan 10-21 (Leighton Penrose): the sender held his Send anyway again 3 s after taking it, cleared the
// approval, and nothing on screen said so. The row is watched after Send; a hold that comes back says why.
describe('after Send, a hold that comes back says so', () => {
  const held = (id: string, reason: string, p: Partial<lib.SendState> = {}): lib.SendState => ({ id, direction: 'outbound', message_text: 'Hey man', message_type: 'dm', channel: 'linkedin', sent_at: null, approved_at: null,
    send_blocked_reason: reason, send_blocked_at: '2026-09-27T09:16:07Z', unipile_message_id: null, created_at: '2026-09-26T10:00:00Z', draft_evidence: null, ...p })

  it('Send anyway held again raises a failure toast naming the reason, once', async () => {
    const m = msg({ prospect_id: 'w1', prospect_name: 'Leighton Penrose', client_id: 'arch', message_text: 'Hey man', send_blocked_at: '2026-09-26T11:00:00Z', send_blocked_reason: 'duplicate_in_thread' })
    const [t] = threads([m]); mount(t)
    fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }))
    fireEvent.click(await waitFor(() => key('confirm-send-anyways')))
    await screen.findByText('Queued to Leighton Penrose.')
    vi.mocked(lib.readSendState).mockResolvedValueOnce([{ ...held(m.id, ''), send_blocked_reason: null, approved_at: '2026-09-27T09:15:10Z' }]).mockResolvedValue([held(m.id, 'duplicate_in_thread')])
    await vi.advanceTimersByTimeAsync(WATCH_EVERY_MS)
    expect(screen.queryByText(/^Not sent to/)).toBeNull()
    await vi.advanceTimersByTimeAsync(WATCH_EVERY_MS)
    await screen.findByText('Not sent to Leighton Penrose: It repeats a message already in the thread.')
    expect(ctx.refresh).toHaveBeenCalled()
    expect(watchedIds()).toEqual([])
    await vi.advanceTimersByTimeAsync(WATCH_EVERY_MS * 2)
    expect(screen.getAllByText(/^Not sent to Leighton Penrose/)).toHaveLength(1)
  })

  it('a sent row stamped and then reverted is still caught; a row seen sent twice is done', async () => {
    const [t] = threads(drafted('w2', { prospect_name: 'Diane', unipile_chat_id: 'chat1' }))
    mount(t)
    fireEvent.click(key('send')); fireEvent.click(await screen.findByText('Approve & send'))
    await screen.findByText('Queued to Diane.')
    const id = t.draft!.id
    vi.mocked(lib.readSendState).mockResolvedValueOnce([held(id, '', { send_blocked_reason: null, sent_at: '2026-09-27T09:16:04Z' })])
      // The sender writes dispatch_error only on its 3rd and last try, and clears the approval there.
      .mockResolvedValueOnce([held(id, 'dispatch_error:riseReferralInmail is not defined', { approved_at: null })])
    await vi.advanceTimersByTimeAsync(WATCH_EVERY_MS * 2)
    await screen.findByText('Not sent to Diane: Couldn\u2019t reach LinkedIn after 3 tries. Nothing was sent. Send anyway to try again.')
    expect(screen.queryByText(/approval is kept/i)).toBeNull()

    cleanup(); stopWatching()
    const [u] = threads(drafted('w3', { prospect_name: 'Nina', unipile_chat_id: 'chat3' }))
    mount(u)
    fireEvent.click(key('send')); fireEvent.click(await screen.findByText('Approve & send'))
    await screen.findByText('Queued to Nina.')
    vi.mocked(lib.readSendState).mockResolvedValue([held(u.draft!.id, '', { send_blocked_reason: null, sent_at: '2026-09-27T09:16:04Z', unipile_message_id: 'u1' })])
    await vi.advanceTimersByTimeAsync(WATCH_EVERY_MS * 2)
    expect(watchedIds()).toEqual([])
    expect(screen.queryByText(/^Not sent/)).toBeNull()
  })

  // Ivan 10-21 (Ben Chehebar): a person who blocked us is not an error. One neutral line, no red toast.
  it('a send LinkedIn will not deliver ends the watch with one neutral line, never a failure toast', async () => {
    const [t] = threads(drafted('w5', { prospect_name: 'Ben Chehebar', unipile_chat_id: 'chat5' }))
    mount(t)
    fireEvent.click(key('send')); fireEvent.click(await screen.findByText('Approve & send'))
    await screen.findByText('Queued to Ben Chehebar.')
    vi.mocked(lib.readSendState).mockResolvedValue([held(t.draft!.id, 'send_failed_verified: hard error: Request failed with status code 422 [errors/blocked_recipient]')])
    await vi.advanceTimersByTimeAsync(WATCH_EVERY_MS)
    const note = await screen.findByText('Not delivered: Ben Chehebar blocked messages on LinkedIn')
    expect(note.closest('.d-toast')!.classList.contains('d-toast-failed')).toBe(false)
    expect(screen.queryByText(/^Not sent/)).toBeNull()
    expect(watchedIds()).toEqual([])
    expect(ctx.refresh).toHaveBeenCalled()
  })

  it('stops watching after about 3 minutes', async () => {
    const [t] = threads(drafted('w4', { prospect_name: 'Pia', unipile_chat_id: 'chat4' }))
    mount(t)
    fireEvent.click(key('send')); fireEvent.click(await screen.findByText('Approve & send'))
    await screen.findByText('Queued to Pia.')
    vi.mocked(lib.readSendState).mockResolvedValue([held(t.draft!.id, '', { send_blocked_reason: null, approved_at: '2026-09-27T09:15:10Z' })])
    await vi.advanceTimersByTimeAsync(185_000)
    expect(watchedIds()).toEqual([])
    const reads = vi.mocked(lib.readSendState).mock.calls.length
    await vi.advanceTimersByTimeAsync(WATCH_EVERY_MS * 3)
    expect(vi.mocked(lib.readSendState).mock.calls.length).toBe(reads)
  })
})

// Ivan 10-21 (Barak Zuman): a lint hold put his own edited reply back in the draft box titled "AI draft".
describe('his own words in the draft box', () => {
  it('a held reply he edited and approved is titled as his message, with the hold time', () => {
    const pid = 'barakz'
    const rows = drafted(pid, { prospect_name: 'Barak Zuman', client_id: 'arch' })
    rows[2] = { ...rows[2], ai_model: 'arch_reply_draft_v2', message_text: 'Tuesday works, which day are you in Tel Aviv?', send_blocked_at: '2026-09-27T07:30:00Z', send_blocked_reason: 'lint_calendar_proposal_edited',
      draft_evidence: { generated_text: 'Drafted words', operator_copy_approval: { text: 'Tuesday works, which day are you in Tel Aviv?', approved_at: '2026-09-27T07:29:00Z' } } as never }
    const [t] = threads(rows)
    expect(t.draft?.id).toBe(rows[2].id)
    mount(t)
    expect(screen.getByText(/Your message · held 09:30/)).toBeTruthy()
    expect(screen.queryByText(/AI draft/)).toBeNull()
  })
  it('a plain drafter draft is still an AI draft', () => {
    const [t] = threads(drafted('plain', { prospect_name: 'Cam' }))
    mount(t)
    expect(screen.getByText(/AI draft/)).toBeTruthy()
  })
})
