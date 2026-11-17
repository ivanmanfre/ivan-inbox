// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { History } from './History'
import { msg, threads } from './fixtures'
import type { DmAttachments, DmFile } from '../../lib/dmAttachments'
import type { Thread } from '../../lib/inbox'

const fetchDmAttachments = vi.hoisted(() => vi.fn())
vi.mock('../../lib/dmAttachments', async orig => ({ ...(await orig<typeof import('../../lib/dmAttachments')>()), fetchDmAttachments }))
import { clearDmAttachmentsCache, useDmAttachments } from './useDmAttachments'

afterEach(() => { cleanup(); clearDmAttachmentsCache(); fetchDmAttachments.mockReset(); vi.useRealTimers() })

const FN = 'https://project.supabase.co/functions/v1/inbox-dm-attachments'
const file = (over: Partial<DmFile> = {}): DmFile => ({ id: 'a1', kind: 'file', mime: 'application/pdf', name: 'partner-deck.pdf', size: 3250586, width: null, height: null, unavailable: false, href: `${FN}?m=x&a=a1&e=1&s=sig`, ...over })
const files = (byMessage: [string, DmFile[]][] = [], loose: DmAttachments['loose'] = []): DmAttachments => ({ byMessage: new Map(byMessage), loose, expiresAt: Date.now() + 3_600_000 })

function deckThread() {
  const theirs = msg({ prospect_id: 'pat', prospect_name: 'Pat Example', direction: 'inbound', unipile_chat_id: 'chat', sent_at: '2026-11-10T09:00:00Z', message_text: 'Any chance we move it?' })
  const deck = msg({ prospect_id: 'pat', prospect_name: 'Pat Example', unipile_chat_id: 'chat', ai_model: 'manual_mirror', sent_at: '2026-11-10T12:00:00Z', message_text: "The deck is attached." })
  return { theirs, deck, t: threads([theirs, deck])[0] }
}

describe('files in the conversation', () => {
  it('shows a sent document as a chip with its name, type and size that opens in a new tab', () => {
    const { deck, t } = deckThread()
    const { container } = render(<History t={t} attachments={files([[deck.id, [file()]]])} />)
    const chip = screen.getByRole('link', { name: /Open partner-deck\.pdf, PDF · 3\.1 MB/ })
    expect(chip.getAttribute('href')).toBe(`${FN}?m=x&a=a1&e=1&s=sig`)
    expect(chip.getAttribute('target')).toBe('_blank')
    expect(chip.getAttribute('rel')).toBe('noreferrer')
    // Under the message's own words, inside its bubble, on our side.
    const bubble = container.querySelector(`[data-msg="${deck.id}"]`)!
    expect(bubble.getAttribute('data-side')).toBe('out')
    expect(bubble.querySelector('.dm-b-body')!.textContent).toBe("The deck is attached.")
    expect(bubble.querySelector('.dm-files')).toBeTruthy()
  })

  it('shows a received picture as a thumbnail, and falls back to a chip when it cannot be drawn', () => {
    const { theirs, t } = deckThread()
    const pic = file({ id: 'p1', kind: 'image', mime: 'image/jpeg', name: null, size: 81234, width: 1200, height: 800, href: `${FN}?m=y&a=p1&e=1&s=sig` })
    const { container } = render(<History t={t} attachments={files([[theirs.id, [pic]]])} />)
    const img = container.querySelector<HTMLImageElement>(`[data-msg="${theirs.id}"] .dm-file-img img`)!
    expect(img.getAttribute('src')).toBe(pic.href)
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.closest('a')!.getAttribute('href')).toBe(pic.href)
    fireEvent.error(img)
    expect(container.querySelector('.dm-file-img')).toBeNull()
    expect(screen.getByRole('link', { name: 'Open Image, JPG · 79 KB' })).toBeTruthy()
  })

  it('keeps a file LinkedIn no longer serves visible, with nothing to tap', () => {
    const { deck, t } = deckThread()
    const { container } = render(<History t={t} attachments={files([[deck.id, [file({ unavailable: true, href: null })]]])} />)
    expect(screen.queryByRole('link', { name: /partner-deck/ })).toBeNull()
    expect(container.querySelector('.dm-file-off')!.textContent).toContain('no longer on LinkedIn')
  })

  it('lets the file stand in for a message that had no words', () => {
    const wordless = msg({ prospect_id: 'pat', direction: 'inbound', unipile_chat_id: 'chat', sent_at: '2026-11-10T13:00:00Z', message_text: '' })
    const [t] = threads([wordless])
    const { container } = render(<History t={t} attachments={files([[wordless.id, [file()]]])} />)
    expect(screen.queryByText('Message text unavailable')).toBeNull()
    expect(container.querySelector(`[data-msg="${wordless.id}"] .dm-b-body`)).toBeNull()
    expect(container.querySelector(`[data-msg="${wordless.id}"] .dm-file`)).toBeTruthy()
  })

  it('places a file sent with no words (no row of ours) at its time, on the sender side', () => {
    const { theirs, deck, t } = deckThread()
    const loose = [{ key: 'k1', direction: 'outbound' as const, at: '2026-11-10T11:00:00Z', files: [file({ id: 'l1', name: 'pricing.pdf' })] }]
    const { container } = render(<History t={t} attachments={files([], loose)} />)
    const order = [...container.querySelectorAll('[data-msg],[data-files-only]')].map(e => e.getAttribute('data-msg') ?? `files:${e.getAttribute('data-files-only')}`)
    expect(order).toEqual([theirs.id, 'files:k1', deck.id])
    const own = container.querySelector('[data-files-only="k1"]')!
    expect(own.getAttribute('data-side')).toBe('out')
    expect(own.querySelector('.dm-b-who')!.textContent).toBe('You')
    expect(own.textContent).toContain('pricing.pdf')
  })

  it('renders a thread with no files exactly as before', () => {
    const { t } = deckThread()
    const before = render(<History t={t} />).container.innerHTML
    cleanup()
    expect(render(<History t={t} attachments={null} />).container.innerHTML).toBe(before)
    cleanup()
    // Files on some other message change nothing here either.
    expect(render(<History t={t} attachments={files([['another-thread-row', [file()]]])} />).container.innerHTML).toBe(before)
  })
})

describe('reading the files for an open conversation', () => {
  function Probe({ t }: { t: Thread }) {
    const a = useDmAttachments(t)
    return <output>{a ? `${a.byMessage.size} with files` : 'none'}</output>
  }

  it('reads once for a LinkedIn thread and hands the files over', async () => {
    const { deck, t } = deckThread()
    fetchDmAttachments.mockResolvedValue(files([[deck.id, [file()]]]))
    render(<Probe t={t} />)
    expect(screen.getByText('none')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('1 with files')).toBeTruthy())
    expect(fetchDmAttachments).toHaveBeenCalledTimes(1)
    expect(fetchDmAttachments).toHaveBeenCalledWith('pat')
  })

  it('never asks for a thread with no LinkedIn chat (an invite, an email)', async () => {
    const [t] = threads([msg({ prospect_id: 'inv', message_type: 'connection_note', sent_at: '2026-11-10T12:30:00Z' })])
    render(<Probe t={t} />)
    await act(async () => { await Promise.resolve() })
    expect(fetchDmAttachments).not.toHaveBeenCalled()
    expect(screen.getByText('none')).toBeTruthy()
  })

  it('stays quiet when the read fails, and when the thread has no files', async () => {
    const { t } = deckThread()
    fetchDmAttachments.mockRejectedValueOnce(new Error('files read failed (404)'))
    const first = render(<Probe t={t} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('none')).toBeTruthy()
    first.unmount()
    fetchDmAttachments.mockResolvedValueOnce(files())
    render(<Probe t={t} />)
    await waitFor(() => expect(fetchDmAttachments).toHaveBeenCalledTimes(2))
    expect(screen.getByText('none')).toBeTruthy()
  })

  it('shows the last read at once on reopening, and reads again when a message lands', async () => {
    const { theirs, deck, t } = deckThread()
    fetchDmAttachments.mockResolvedValue(files([[deck.id, [file()]]]))
    const first = render(<Probe t={t} />)
    await waitFor(() => expect(screen.getByText('1 with files')).toBeTruthy())
    first.unmount()
    const again = render(<Probe t={t} />)
    expect(screen.getByText('1 with files')).toBeTruthy()
    expect(fetchDmAttachments).toHaveBeenCalledTimes(1)
    const reply = msg({ prospect_id: 'pat', direction: 'inbound', unipile_chat_id: 'chat', sent_at: '2026-11-10T14:00:00Z', message_text: 'Got it' })
    again.rerender(<Probe t={threads([theirs, deck, reply])[0]} />)
    await waitFor(() => expect(fetchDmAttachments).toHaveBeenCalledTimes(2))
  })

  it('does not read again when older messages of the same conversation land', async () => {
    const { theirs, deck, t } = deckThread()
    fetchDmAttachments.mockResolvedValue(files([[deck.id, [file()]]]))
    const view = render(<Probe t={threads([deck])[0]} />)
    await waitFor(() => expect(screen.getByText('1 with files')).toBeTruthy())
    const older = msg({ prospect_id: 'pat', direction: 'inbound', unipile_chat_id: 'chat', sent_at: '2026-11-09T08:00:00Z', message_text: 'Hello' })
    view.rerender(<Probe t={threads([older, theirs, deck])[0]} />)
    view.rerender(<Probe t={t} />)
    await act(async () => { await Promise.resolve() })
    expect(fetchDmAttachments).toHaveBeenCalledTimes(1)
  })

  it('holds the read back for a pane nobody opened, and drops it when the pane goes first', async () => {
    vi.useFakeTimers()
    const { deck, t } = deckThread()
    fetchDmAttachments.mockResolvedValue(files([[deck.id, [file()]]]))
    const Shown = ({ t }: { t: Thread }) => { useDmAttachments(t, 1500); return null }
    const gone = render(<Shown t={t} />)
    await act(async () => { vi.advanceTimersByTime(1400) })
    gone.unmount()
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(fetchDmAttachments).not.toHaveBeenCalled()
    render(<Shown t={t} />)
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(fetchDmAttachments).toHaveBeenCalledTimes(1)
  })

  it('never shows one person’s files on another person’s thread', async () => {
    const { deck, t } = deckThread()
    fetchDmAttachments.mockResolvedValueOnce(files([[deck.id, [file()]]]))
    const view = render(<Probe t={t} />)
    await waitFor(() => expect(screen.getByText('1 with files')).toBeTruthy())
    fetchDmAttachments.mockReturnValueOnce(new Promise(() => {}))
    const other = threads([msg({ prospect_id: 'other', direction: 'inbound', unipile_chat_id: 'chat2', sent_at: '2026-11-10T14:00:00Z' })])[0]
    view.rerender(<Probe t={other} />)
    expect(screen.getByText('none')).toBeTruthy()
  })
})
