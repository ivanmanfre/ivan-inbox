export type ForwardInput = { message_id: string; to: string; note: string; request_id: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const email = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

export function validateForwardInput(value: unknown): ForwardInput {
  const v = value as Partial<ForwardInput> | null
  if (!v || typeof v.message_id !== 'string' || !uuid.test(v.message_id) || typeof v.request_id !== 'string' || !uuid.test(v.request_id)) throw new Error('Invalid forwarding request. Refresh and try again.')
  if (typeof v.to !== 'string' || v.to.length > 254 || !email.test(v.to.trim())) throw new Error('Enter one valid email address.')
  if (typeof v.note !== 'string' || v.note.length > 8000) throw new Error('The note must be 8000 characters or fewer.')
  return { message_id: v.message_id, to: v.to.trim(), note: v.note, request_id: v.request_id }
}

type ReceivedEmail = {
  id: string; from: string; to: string[]; subject: string; text?: string | null; html?: string | null; created_at: string; reply_to?: string[]
  attachments?: { id: string; filename: string; content_type?: string; content_id?: string | null; size: number }[]
}
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const base64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

/** Only Resend reads and one send. Never writes to the prospect's conversation or drafts. */
export async function forwardReceivedEmail(resendId: string, from: string, input: ForwardInput, key: string, request: typeof fetch = fetch): Promise<string> {
  const headers = { Authorization: `Bearer ${key}` }
  const originalResponse = await request(`https://api.resend.com/emails/receiving/${encodeURIComponent(resendId)}?html_format=cid`, { headers })
  if (!originalResponse.ok) throw new Error('Could not retrieve the original email. Try again.')
  const original: ReceivedEmail = await originalResponse.json()
  if (!original.id || !original.from || (!original.text && !original.html && !original.attachments?.length)) throw new Error('The original email content is unavailable. The forward was not sent.')
  if ((original.attachments ?? []).reduce((n, a) => n + Math.ceil(a.size / 3) * 4, 0) > 35_000_000) throw new Error('The attachments are too large to forward by email.')
  const attachments: { filename: string; content: string; content_type?: string; content_id?: string }[] = []
  for (const a of original.attachments ?? []) {
    const detail = await request(`https://api.resend.com/emails/receiving/${encodeURIComponent(resendId)}/attachments/${encodeURIComponent(a.id)}`, { headers })
    if (!detail.ok) throw new Error(`Could not retrieve attachment ${a.filename}. The forward was not sent.`)
    const { download_url } = await detail.json()
    if (typeof download_url !== 'string' || !download_url.startsWith('https://')) throw new Error(`Attachment ${a.filename} is unavailable.`)
    const file = await request(download_url)
    if (!file.ok) throw new Error(`Could not download attachment ${a.filename}. The forward was not sent.`)
    attachments.push({ filename: a.filename, content: base64(new Uint8Array(await file.arrayBuffer())),
      ...(a.content_type ? { content_type: a.content_type } : {}), ...(a.content_id ? { content_id: a.content_id } : {}) })
  }
  const subject = /^fwd?:/i.test(original.subject) ? original.subject : `Fwd: ${original.subject || 'Email'}`
  const metadata = `---------- Forwarded email ----------\nFrom: ${original.from}\nDate: ${original.created_at}\nSubject: ${original.subject}\nTo: ${(original.to ?? []).join(', ')}`
  const intro = `${input.note ? `${input.note}\n\n` : ''}${metadata}\n\n`
  const replyTo = original.reply_to?.[0] || original.from.match(/<([^<>]+)>/)?.[1] || original.from
  const sent = await request('https://api.resend.com/emails', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': `inbox-forward/${input.message_id}/${input.request_id}` },
    body: JSON.stringify({ from, to: [input.to], subject, ...(email.test(replyTo.trim()) ? { reply_to: replyTo.trim() } : {}),
      ...(original.text ? { text: intro + original.text } : {}),
      html: `<div style="white-space:pre-wrap">${escape(intro)}</div>${original.html || `<div style="white-space:pre-wrap">${escape(original.text || '')}</div>`}`,
      ...(attachments.length ? { attachments } : {}), tags: [{ name: 'source', value: 'inbox-forward' }] }),
  })
  const result = await sent.json()
  if (!sent.ok || typeof result.id !== 'string') throw new Error(result.message || 'The email service did not confirm the forward. Try again.')
  return result.id
}
