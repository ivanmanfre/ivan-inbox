import { createClient } from 'npm:@supabase/supabase-js@2'
import { BUCKET, MAX_BYTES, UUID, objectName, pdfInfo, providerForm, validAttachment, type Attachment } from './file.ts'

const base = Deno.env.get('SUPABASE_URL')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const owner = Deno.env.get('INBOX_DELETE_ALLOWED_USER_ID') ?? Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')
const dsn = Deno.env.get('UNIPILE_DSN') ?? Deno.env.get('FOLLOWER_UNIPILE_DSN')
const providerKey = Deno.env.get('UNIPILE_KEY') ?? Deno.env.get('FOLLOWER_UNIPILE_KEY')
const options = { auth: { persistSession: false } }
const origins = ['https://ivanmanfre.github.io', 'https://inbox.ivanmanfredi.com', 'http://localhost:5173']

Deno.serve(async req => {
  const origin = req.headers.get('origin') ?? ''
  const cors = {
    'Access-Control-Allow-Origin': origins.includes(origin) ? origin : origins[0],
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body),
    { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'Method unavailable.' })
  if (!base || !anon || !service || !owner) return reply(503, { error: 'Draft attachments unavailable.' })

  const send = new URL(req.url).searchParams.get('action') === 'send'
  const token = /^Bearer (\S+)$/.exec(req.headers.get('authorization') ?? '')?.[1]
  if (!token) return reply(401, { error: 'Sign in to use draft attachments.' })
  if (!send) {
    const { data, error } = await createClient(base, anon, options).auth.getUser(token)
    if (error || data?.user?.id !== owner) return reply(403, { error: 'Inbox owner only.' })
  }

  // Dispatch uses the supplied project key throughout. PostgreSQL only grants the claim to service_role.
  const db = createClient(base, send ? token : service, options)
  const bucket = db.storage.from(BUCKET)
  try {
    if (Number(req.headers.get('content-length')) > MAX_BYTES + 32_768) return reply(413, { error: 'Choose a PDF under 10 MB.' })
    const multipart = !send && req.headers.get('content-type')?.startsWith('multipart/form-data')
    const input = multipart ? null : await req.json()
    const form = multipart ? await req.formData() : null
    const id = multipart ? form?.get('draft_id') : input?.draft_id
    if (typeof id !== 'string' || !UUID.test(id)) return reply(400, { error: 'Invalid draft.' })
    const { data: row, error } = await db.from('outreach_messages')
      .select('channel,direction,message_type,ai_model,approved_at,sent_at,send_blocked_at,unipile_message_id,unipile_chat_id,message_text,draft_evidence')
      .eq('id', id).maybeSingle()
    if (error) return reply(503, { error: 'Could not check the draft.' })
    if (!row || row.channel !== 'linkedin' || row.direction !== 'outbound' ||
        row.ai_model !== 'inbox_on_demand_reply' || row.draft_evidence?.v !== 'inbox_on_demand_reply_v1' ||
        !row.unipile_chat_id || !['dm', 'manual_reply'].includes(row.message_type)) return reply(404, { error: 'Open a LinkedIn reply draft first.' })
    const { data: scoped, error: scopeError } = await db.from('inbox_messages_v').select('client_id')
      .eq('id', id).eq('client_id', 'ivan').maybeSingle()
    if (scopeError || !scoped) return reply(403, { error: 'This draft is outside your LinkedIn seat.' })
    const current = row.draft_evidence.dm_attachment
    const attachment = validAttachment(current) ? current : null

    if (send) {
      if (!dsn || !providerKey) return reply(503, { error: 'LinkedIn attachment delivery unavailable.' })
      if (!attachment || input.file_id !== attachment.id ||
          row.draft_evidence.operator_copy_approval?.attachment_id !== attachment.id ||
          row.draft_evidence.operator_copy_approval?.attachment_chat !== input.chat_id ||
          row.draft_evidence.operator_copy_approval?.text !== row.message_text ||
          row.unipile_chat_id !== input.chat_id || typeof input.account_id !== 'string' || !input.account_id ||
          !row.approved_at || !row.sent_at || !Number.isFinite(Date.parse(input.claimed_at)) ||
          Date.parse(row.sent_at) !== Date.parse(input.claimed_at) ||
          row.send_blocked_at || row.unipile_message_id || row.message_type !== 'manual_reply' ||
          typeof input.text !== 'string' || input.text !== row.message_text.trim()) {
        return reply(409, { error: 'The attachment, approved message or chat changed.' })
      }
      const file = await bucket.download(objectName(id, attachment.id))
      if (file.error || !file.data) return reply(422, { error: 'The approved PDF is unavailable.' })
      const payload = await providerForm(input.text, input.account_id, attachment, file.data)
      const claimed = await db.rpc('claim_inbox_dm_pdf_transport', {
        p_id: id, p_claimed_at: input.claimed_at, p_file_id: attachment.id,
        p_account_id: input.account_id, p_chat_id: input.chat_id, p_text: input.text,
      })
      if (claimed.error || claimed.data !== true) return reply(409, { error: 'The PDF dispatch was already attempted or the approval changed.' })
      const url = new URL(['api', 'v1', 'chats', encodeURIComponent(input.chat_id), 'messages'].join('/'), `https://${dsn}`)
      const upstream = await fetch(url, {
        method: 'POST', headers: { 'X-API-KEY': providerKey, Accept: 'application/json' },
        body: payload, signal: AbortSignal.timeout(25_000),
      })
      const result = await upstream.json().catch(() => null)
      return result ? reply(upstream.ok ? 200 : upstream.status, result)
        : reply(502, { error: 'Unipile returned no message receipt.' })
    }

    if (input?.action === 'preview' && attachment && input.file_id === attachment.id && !row.sent_at) {
      const link = await bucket.createSignedUrl(objectName(id, attachment.id), 180, { download: attachment.name })
      return link.data ? reply(200, { url: link.data.signedUrl }) : reply(404, { error: 'Could not open the PDF.' })
    }
    if (row.approved_at || row.sent_at || row.unipile_message_id || row.send_blocked_at) return reply(409, { error: 'This draft is no longer editable.' })
    let next: Attachment | null = null
    if (multipart) {
      const file = form?.get('file')
      if (!(file instanceof File)) return reply(400, { error: 'Choose a PDF.' })
      if ((form?.get('file_id') || null) !== (attachment?.id ?? null)) return reply(409, { error: 'The attachment changed. Refresh the draft.' })
      next = { id: crypto.randomUUID(), name: file.name, ...await pdfInfo(file) }
      if (!validAttachment(next)) return reply(400, { error: 'Choose a PDF with a valid filename.' })
      const upload = await bucket.upload(objectName(id, next.id), file, { contentType: 'application/pdf', upsert: false })
      if (upload.error) return reply(503, { error: 'The PDF could not be uploaded.' })
    } else if (!attachment || input?.action !== 'remove' || input.file_id !== attachment.id) {
      return reply(409, { error: 'The attachment changed. Refresh the draft.' })
    }

    const { data: evidence, error: saveError } = await db.rpc('set_inbox_dm_draft_file', {
      p_id: id, p_expected_file_id: attachment?.id ?? null, p_file: next,
    })
    if (saveError || !evidence) {
      if (!saveError && next) await bucket.remove([objectName(id, next.id)])
      return reply(409, { error: 'Could not confirm the attachment change. Refresh the draft.' })
    }
    if (attachment) await bucket.remove([objectName(id, attachment.id)])
    return reply(200, { evidence })
  } catch (error) {
    const message = error instanceof Error && error.message === 'Choose a PDF under 10 MB.' ? error.message : 'Could not complete the PDF request.'
    return reply(send ? 502 : 400, { error: message })
  }
})
