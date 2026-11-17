import { describe, expect, it } from 'vitest'
import { fileName, fileSize, fileType, parseDmAttachments } from './dmAttachments'

const FN = 'https://project.supabase.co/functions/v1/inbox-dm-attachments'
const deck = { id: 'a1', kind: 'file', mime: 'application/pdf', name: 'partner-deck.pdf', size: 3250586, width: null, height: null, unavailable: false, href: `${FN}?m=x&a=a1&e=1&s=sig` }

describe('reading the files answer', () => {
  it('groups files by our message id and keeps wordless ones in time order', () => {
    const out = parseDmAttachments({ ok: true, expires_at: '2026-11-17T13:00:00.000Z', groups: [
      { message_id: null, direction: 'outbound', at: '2026-11-14T10:00:00Z', files: [{ ...deck, id: 'late' }] },
      { message_id: 'row-1', direction: 'outbound', at: '2026-11-10T12:00:00Z', files: [deck] },
      { message_id: null, direction: 'inbound', at: '2026-11-12T10:00:00Z', files: [{ ...deck, id: 'early' }] },
    ] }, FN)
    expect([...out.byMessage.keys()]).toEqual(['row-1'])
    expect(out.byMessage.get('row-1')![0]).toMatchObject({ name: 'partner-deck.pdf', href: deck.href })
    expect(out.loose.map(l => [l.files[0].id, l.direction])).toEqual([['early', 'inbound'], ['late', 'outbound']])
    expect(out.expiresAt).toBe(Date.parse('2026-11-17T13:00:00.000Z'))
  })

  it('never turns a link to anywhere else into something to tap', () => {
    const out = parseDmAttachments({ groups: [{ message_id: 'row-1', files: [
      { ...deck, id: 'evil', href: 'https://evil.example/x.pdf' }, { ...deck, id: 'near', href: `${FN}.evil.example?m=x` }, { ...deck, id: 'script', href: 'javascript:alert(1)' },
    ] }] }, FN)
    expect(out.byMessage.get('row-1')!.map(f => [f.href, f.unavailable])).toEqual([[null, true], [null, true], [null, true]])
  })

  it('drops what it cannot read and survives an empty or broken answer', () => {
    expect(parseDmAttachments(null, FN).byMessage.size).toBe(0)
    expect(parseDmAttachments({ groups: 'no' }, FN).loose).toEqual([])
    const out = parseDmAttachments({ groups: [{ message_id: 'row-1', files: [{ id: 1 }, { ...deck, kind: 'poll' }, null] }, { message_id: null, at: 'not a date', files: [deck] }] }, FN, 5)
    expect(out.byMessage.size).toBe(0)
    expect(out.loose).toEqual([])
    expect(out.expiresAt).toBe(5)
  })
})

describe('what a chip says', () => {
  it('names the type from the mime type, then the extension, then the kind', () => {
    expect(fileType({ kind: 'file', mime: 'application/pdf', name: 'deck.pdf' })).toBe('PDF')
    expect(fileType({ kind: 'file', mime: 'application/x-unknown', name: 'plan.key' })).toBe('KEY')
    expect(fileType({ kind: 'image', mime: null, name: null })).toBe('Image')
  })

  it('writes sizes the way a person reads them', () => {
    expect(fileSize(3250586)).toBe('3.1 MB')
    expect(fileSize(31 * 1024 * 1024)).toBe('31 MB')
    expect(fileSize(320_000)).toBe('313 KB')
    expect(fileSize(900)).toBe('900 B')
    expect(fileSize(null)).toBeNull()
  })

  it('falls back to the kind when LinkedIn gave no name', () => {
    expect(fileName({ kind: 'image', name: null })).toBe('Image')
    expect(fileName({ kind: 'file', name: 'deck.pdf' })).toBe('deck.pdf')
  })
})
