import { describe, expect, it, vi } from 'vitest'
import { forwardReceivedEmail, validateForwardInput } from './forward'

const input = { message_id: '7532bbf8-05f5-4c2c-9dd9-b7f6a6c67f8c', to: 'davorinsmit@arch.agency', note: 'Ofir sent these.', request_id: '2c3bd56f-1f9f-48e6-94e0-ecc9188d105a' }
const original = { id: 'received-id', from: 'Ofir <ofir.b@doktorabc.com>', to: ['davorin@madebyarch.com'], subject: 'Re: ARCH x DoktorABC', text: 'Deck https://drive.google.com/deck', html: '<a href="https://drive.google.com/deck">Deck</a>', created_at: '2026-10-05T12:14:00Z', attachments: [] }
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })

describe('forwarding an original email', () => {
  it('forwards an attachment-only email and requests CID HTML for inline images', async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ ...original, text: null, html: null, attachments: [{ id: 'image', filename: 'logo.png', size: 3, content_id: 'logo', content_type: 'image/png' }] }))
      .mockResolvedValueOnce(json({ download_url: 'https://storage.resend.com/logo.png' }))
      .mockResolvedValueOnce(new Response('PNG')).mockResolvedValueOnce(json({ id: 'sent-id' }))
    await forwardReceivedEmail('received-id', 'Davorin <davorin@madebyarch.com>', input, 'key', request)
    expect(request.mock.calls[0][0]).toBe('https://api.resend.com/emails/receiving/received-id?html_format=cid')
    expect(JSON.parse(request.mock.calls[3][1].body).attachments).toEqual([{ filename: 'logo.png', content: 'UE5H', content_id: 'logo', content_type: 'image/png' }])
  })
  it('preserves the original body and sender and sends a separate copy to the chosen address', async () => {
    const request = vi.fn().mockResolvedValueOnce(json(original)).mockResolvedValueOnce(json({ id: 'sent-id' }))
    expect(await forwardReceivedEmail('received-id', 'Davorin <davorin@madebyarch.com>', input, 'resend-key', request)).toBe('sent-id')
    const [url, options] = request.mock.calls[1]
    expect(url).toBe('https://api.resend.com/emails')
    const payload = JSON.parse(options.body)
    expect(payload.to).toEqual([input.to])
    expect(payload.reply_to).toBe('ofir.b@doktorabc.com')
    expect(payload.subject).toBe('Fwd: Re: ARCH x DoktorABC')
    expect(payload.text).toContain(original.text)
    expect(payload.html).toContain(original.html)
    expect(payload.text).toContain(original.from)
    expect(payload.headers).toBeUndefined()
    expect(options.headers['Idempotency-Key']).toContain(input.request_id)
  })

  it('preserves attachment bytes and blocks a forward if an attachment cannot be retrieved', async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ ...original, attachments: [{ id: 'pdf', filename: 'brand.pdf', size: 3 }] }))
      .mockResolvedValueOnce(json({ download_url: 'https://storage.resend.com/brand.pdf', filename: 'brand.pdf' }))
      .mockResolvedValueOnce(new Response('PDF')).mockResolvedValueOnce(json({ id: 'sent-id' }))
    await forwardReceivedEmail('received-id', 'Davorin <davorin@madebyarch.com>', input, 'key', request)
    expect(JSON.parse(request.mock.calls[3][1].body).attachments).toEqual([{ filename: 'brand.pdf', content: 'UERG' }])
    const failed = vi.fn().mockResolvedValueOnce(json({ ...original, attachments: [{ id: 'pdf', filename: 'brand.pdf', size: 3 }] }))
      .mockResolvedValueOnce(json({ message: 'Missing file' }, 404))
    await expect(forwardReceivedEmail('received-id', 'Davorin <davorin@madebyarch.com>', input, 'key', failed)).rejects.toThrow(/attachment/i)
    expect(failed.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true)
  })

  it('reports a provider send failure and refuses a missing original', async () => {
    const request = vi.fn().mockResolvedValueOnce(json(original)).mockResolvedValueOnce(json({ message: 'Daily quota exceeded' }, 429))
    await expect(forwardReceivedEmail('received-id', 'from@madebyarch.com', input, 'key', request)).rejects.toThrow('Daily quota exceeded')
    await expect(forwardReceivedEmail('received-id', 'from@madebyarch.com', input, 'key', vi.fn().mockResolvedValue(json({}, 404)))).rejects.toThrow(/original email/i)
  })

  it('rejects malformed input and multiple recipients', () => {
    expect(validateForwardInput(input)).toEqual(input)
    for (const patch of [{ to: 'Davorin' }, { to: 'a@arch.agency,b@arch.agency' }, { to: 'a@arch.agency\nBcc: x@evil.com' }, { message_id: 'no' }, { note: 'x'.repeat(8001) }]) {
      expect(() => validateForwardInput({ ...input, ...patch })).toThrow()
    }
  })
})
