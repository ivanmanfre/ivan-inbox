import { describe, expect, it, vi } from 'vitest'
import { LINK_STEP_MS, MAX_PAGES, linkExpiry, listFiles, serveFile, signLink, verifyLink } from './attachments'

const KEY = 'test-link-key'
const BASE = 'https://project.supabase.co/functions/v1/inbox-dm-attachments'
const NOW = Date.parse('2026-11-17T12:10:00Z')
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })

// The shape Unipile returns for a PDF sent in a LinkedIn DM (field names from a real read; every id and name is made up).
const deck = { id: 'DeckAttachment00000001', url: 'att://ACCOUNTIDACCOUNTIDACCO/aHR0cHM6Ly93d3cubGlua2VkaW4uY29tL2Rtcy9wcnY', type: 'file', mimetype: 'application/pdf', file_name: 'partner-deck.pdf', file_size: 3250586, unavailable: false }
const sent = { id: 'SentDeckMessage0000001', is_sender: 1, timestamp: '2026-11-10T12:00:00.000Z', text: 'Here is the deck', attachments: [deck] }
const rows = [
  { id: 'row-sent', unipile_message_id: 'SentDeckMessage0000001', unipile_chat_id: 'ChatWithThePerson00001' },
  { id: 'row-listen', unipile_message_id: 'listen:InboundMessage0000001', unipile_chat_id: 'ChatWithThePerson00001' },
  { id: 'row-invite', unipile_message_id: null, unipile_chat_id: null },
]

describe('listing the files on a conversation', () => {
  it('ties a sent file to our message row and signs a link to it, without the provider url or account id', async () => {
    const read = vi.fn(async () => json({ items: [sent, { id: 'NoFilesMessage00000001', is_sender: 0, attachments: [] }], cursor: null }))
    const out = await listFiles(rows, { read, key: KEY, base: BASE, now: NOW })
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith('/chats/ChatWithThePerson00001/messages?limit=100')
    expect(out.complete).toBe(true)
    expect(out.groups).toHaveLength(1)
    const [g] = out.groups
    expect(g).toMatchObject({ message_id: 'row-sent', direction: 'outbound', at: '2026-11-10T12:00:00.000Z' })
    expect(g.files[0]).toMatchObject({ id: deck.id, kind: 'file', mime: 'application/pdf', name: 'partner-deck.pdf', size: 3250586, unavailable: false })
    const text = JSON.stringify(out)
    expect(text).not.toContain('att://')
    expect(text).not.toContain('ACCOUNTID')
    const link = new URL(g.files[0].href!)
    expect(`${link.origin}${link.pathname}`).toBe(BASE)
    expect(await verifyLink(KEY, link.searchParams, NOW)).toEqual({ messageId: sent.id, attachmentId: deck.id })
    expect(Date.parse(out.expires_at)).toBe(linkExpiry(NOW))
  })

  it('reads a received image, matches the listener lane id, and keeps a wordless file as its own entry', async () => {
    const image = { id: 'ImageAttachment0000001', type: 'img', mimetype: 'image/jpeg', file_size: 81234, size: { width: 1200, height: 800 }, sticker: false, unavailable: false, url: 'att://x/y' }
    const read = vi.fn(async () => json({ items: [
      { id: 'InboundMessage0000001', is_sender: 0, timestamp: '2026-11-14T09:00:00.000Z', attachments: [image] },
      { id: 'WordlessFileMessage01', is_sender: true, timestamp: '2026-11-14T10:00:00.000Z', attachments: [{ ...deck, id: 'SecondDeckAttachment01' }] },
    ] }))
    const out = await listFiles(rows, { read, key: KEY, base: BASE, now: NOW })
    expect(out.groups.map(g => [g.message_id, g.direction])).toEqual([['row-listen', 'inbound'], [null, 'outbound']])
    expect(out.groups[0].files[0]).toMatchObject({ kind: 'image', mime: 'image/jpeg', name: null, width: 1200, height: 800 })
  })

  it('shows a file LinkedIn no longer serves without a link, and skips what is not a file', async () => {
    const read = vi.fn(async () => json({ items: [{ ...sent, attachments: [
      { ...deck, unavailable: true }, { id: 'SharedPostAttachment01', type: 'linkedin_post', unavailable: false }, { id: '../../etc', type: 'file', file_name: 'x', unavailable: false }, null,
    ] }] }))
    const out = await listFiles(rows, { read, key: KEY, base: BASE, now: NOW })
    expect(out.groups[0].files).toHaveLength(1)
    expect(out.groups[0].files[0]).toMatchObject({ unavailable: true, href: null })
  })

  it('follows the cursor up to the page cap and says when it stopped short', async () => {
    const read = vi.fn(async (path: string) => json({ items: [{ ...sent, id: `PageMessage${path.length}`.padEnd(22, '0') }], cursor: 'next' }))
    const out = await listFiles(rows, { read, key: KEY, base: BASE, now: NOW })
    expect(read).toHaveBeenCalledTimes(MAX_PAGES)
    expect(read.mock.calls[1][0]).toBe('/chats/ChatWithThePerson00001/messages?limit=100&cursor=next')
    expect(out.complete).toBe(false)
  })

  it('reads nothing for a person with no LinkedIn chat, and fails loudly when the chat cannot be read', async () => {
    const read = vi.fn(async () => json({ error: 'nope' }, 500))
    expect(await listFiles([rows[2]], { read, key: KEY, base: BASE, now: NOW })).toMatchObject({ groups: [], complete: true })
    expect(read).not.toHaveBeenCalled()
    await expect(listFiles(rows, { read, key: KEY, base: BASE, now: NOW })).rejects.toThrow('chat_read_failed')
  })
})

describe('the signed link', () => {
  const params = async (over: Record<string, string> = {}, exp = linkExpiry(NOW)) =>
    new URLSearchParams({ m: sent.id, a: deck.id, e: String(exp), s: await signLink(KEY, sent.id, deck.id, exp), ...over })

  it('opens exactly the file it was signed for, until it runs out', async () => {
    expect(await verifyLink(KEY, await params(), NOW)).toEqual({ messageId: sent.id, attachmentId: deck.id })
    expect(await verifyLink(KEY, await params(), linkExpiry(NOW) + 1)).toBeNull()
  })

  it('refuses another file, another message, a moved expiry, another key and a far-off expiry', async () => {
    expect(await verifyLink(KEY, await params({ a: 'SecondDeckAttachment01' }), NOW)).toBeNull()
    expect(await verifyLink(KEY, await params({ m: 'InboundMessage0000001' }), NOW)).toBeNull()
    expect(await verifyLink(KEY, await params({ e: String(linkExpiry(NOW) + LINK_STEP_MS) }), NOW)).toBeNull()
    expect(await verifyLink('other-key', await params(), NOW)).toBeNull()
    expect(await verifyLink(KEY, await params({}, NOW + 10 * LINK_STEP_MS), NOW)).toBeNull()
    expect(await verifyLink(KEY, new URLSearchParams(), NOW)).toBeNull()
  })

  it('keeps one link per file for a stretch, between 30 and 60 minutes long', () => {
    expect(linkExpiry(NOW)).toBe(linkExpiry(NOW + 60_000))
    for (const at of [NOW, NOW + 29 * 60_000, NOW + 31 * 60_000]) {
      expect(linkExpiry(at) - at).toBeGreaterThan(LINK_STEP_MS - 1)
      expect(linkExpiry(at) - at).toBeLessThanOrEqual(2 * LINK_STEP_MS)
    }
  })
})

describe('serving the bytes', () => {
  const link = { messageId: sent.id, attachmentId: deck.id }
  const upstream = (type: string, name: string, body = 'bytes') => vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': type, 'content-disposition': `attachment; filename="${name}"` } }))

  it('shows a PDF in place under its own name', async () => {
    const read = upstream('application/pdf', 'partner-deck.pdf', '%PDF-1.7')
    const res = await serveFile(link, read)
    expect(read).toHaveBeenCalledWith(`/messages/${sent.id}/attachments/${deck.id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('inline; filename="partner-deck.pdf"')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('private, max-age=1800')
    expect(await res.text()).toBe('%PDF-1.7')
  })

  it('never lets a page, a vector image or an unknown type run: they download as plain bytes', async () => {
    for (const type of ['text/html; charset=utf-8', 'image/svg+xml', 'application/javascript', 'video/mp4', '']) {
      const res = await serveFile(link, upstream(type, 'x\\y/../z.html'))
      expect(res.headers.get('content-type')).toBe('application/octet-stream')
      expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="x y \.\. z\.html"/)
      expect(res.headers.get('content-security-policy')).toContain('sandbox')
    }
  })

  it('says so plainly when LinkedIn no longer has the file or the read fails', async () => {
    expect((await serveFile(link, vi.fn(async () => json({ error: 'not found' }, 404)))).status).toBe(404)
    expect((await serveFile(link, vi.fn(async () => json({ error: 'boom' }, 500)))).status).toBe(502)
    const failed = await serveFile(link, vi.fn(async () => { throw new Error('network') }))
    expect(failed.status).toBe(502)
    expect(failed.headers.get('cache-control')).toBe('no-store')
  })
})
