// inbox-dm-attachments — the files on a LinkedIn conversation, for the inbox thread
// (Ivan, 2026-11-17: a deck he sent on LinkedIn showed as words only; "see if unipile supports
// seeing attachments").
//
// READ-ONLY. Two calls, both GETs to the provider, no database write, nothing stored:
//
//   POST { prospect_id }   Operator-only (bearer verified with auth.getUser, single-user allowlist,
//                          same as inbox-delete-thread). Reads the person's chat pages and answers
//                          { ok, groups, expires_at, complete }: each file's name, type and size, tied
//                          to our message row, plus a signed link to its bytes.
//
//   GET ?m&a&e&s           The signed link. No session (a phone opens it in its own viewer), so the
//                          signature is the whole check: HMAC over (message id, attachment id, expiry)
//                          with a key only this function holds. It reads exactly that one file and
//                          lasts under an hour. A PDF or plain image shows in place; anything else
//                          downloads.
//
// The Unipile key, the account id and the provider's own `att://` url never reach the browser.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { gone, listFiles, serveFile, verifyLink, type MessageRow } from './attachments.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ALLOWED_USER_ID = Deno.env.get('INBOX_DELETE_ALLOWED_USER_ID')
  ?? Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')
const DSN = Deno.env.get('UNIPILE_DSN') ?? Deno.env.get('FOLLOWER_UNIPILE_DSN')
const KEY = Deno.env.get('UNIPILE_KEY') ?? Deno.env.get('FOLLOWER_UNIPILE_KEY')
// The links' signing key. Its own secret when set; otherwise derived from the service key, which
// never leaves the function either way.
const LINK_KEY = Deno.env.get('INBOX_DM_ATTACHMENT_LINK_KEY') ?? (SERVICE_KEY ? `dm-attachment-link:${SERVICE_KEY}` : '')
// Where the links point. Set only for a local run; live it is this function's own address.
const LINK_BASE = Deno.env.get('INBOX_DM_ATTACHMENT_LINK_BASE') ?? `${SUPABASE_URL}/functions/v1/inbox-dm-attachments`

const ALLOWED_ORIGINS = [
  'https://ivanmanfre.github.io',
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:4175',
  'http://localhost:5173',
  'http://localhost:5431',
]

function cors(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function reply(status: number, body: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

// GET only: this function can read the seat's chats and nothing else.
const read = (path: string) =>
  fetch(`https://${DSN}/api/v1${path}`, {
    method: 'GET',
    headers: { 'X-API-KEY': KEY!, accept: '*/*' },
    signal: AbortSignal.timeout(path.includes('/attachments/') ? 60_000 : 15_000),
  })

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) })

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_KEY || !ALLOWED_USER_ID || !DSN || !KEY || !LINK_KEY) {
    console.error('refusing: incomplete config', {
      url: !!SUPABASE_URL, anon: !!SUPABASE_ANON_KEY, service: !!SERVICE_KEY,
      allow: !!ALLOWED_USER_ID, dsn: !!DSN, key: !!KEY,
    })
    return req.method === 'GET' ? gone(502) : reply(503, { ok: false, error: 'not_configured' }, origin)
  }

  if (req.method === 'GET') {
    const link = await verifyLink(LINK_KEY, new URL(req.url).searchParams, Date.now())
    return link ? serveFile(link, read) : gone(403)
  }
  if (req.method !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' }, origin)

  const authz = req.headers.get('Authorization') ?? ''
  const jwt = authz.startsWith('Bearer ') ? authz.slice(7).trim() : ''
  if (!jwt) return reply(401, { ok: false, error: 'unauthenticated' }, origin)
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: who, error: authErr } = await authClient.auth.getUser(jwt)
  if (authErr || !who?.user) return reply(401, { ok: false, error: 'invalid_token' }, origin)
  if (who.user.id !== ALLOWED_USER_ID) return reply(403, { ok: false, error: 'forbidden_user' }, origin)

  let prospectId = ''
  try { prospectId = String((await req.json())?.prospect_id ?? '').trim() } catch { /* empty */ }
  if (!/^[0-9a-f-]{36}$/i.test(prospectId)) return reply(400, { ok: false, error: 'bad_prospect_id' }, origin)

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: rows, error: rowsErr } = await db.from('outreach_messages')
    .select('id,unipile_message_id,unipile_chat_id').eq('prospect_id', prospectId).not('unipile_chat_id', 'is', null).limit(1000)
  if (rowsErr) return reply(500, { ok: false, error: 'db_read_failed' }, origin)

  try {
    const out = await listFiles((rows ?? []) as MessageRow[], { read, key: LINK_KEY, base: LINK_BASE, now: Date.now() })
    return reply(200, { ok: true, ...out }, origin)
  } catch {
    return reply(502, { ok: false, error: 'chat_read_failed' }, origin)
  }
})
