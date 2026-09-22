// inbox-delete-thread — deletes a conversation from the seat's LinkedIn inbox via Unipile
// (Ivan, 2026-09-22: "build in my inbox an option to delete thread whenever i want to").
//
// WHAT IT DOES, IN ORDER
//   1. Operator-only: bearer verified with auth.getUser, single-user allowlist (mirrors
//      inbox-stt). Fails CLOSED on missing config.
//   2. Resolves every Unipile chat id the thread has used (outreach_messages.unipile_chat_id).
//   3. DELETE /api/v1/chats/{id} on each (Unipile: "Supported for WhatsApp and LinkedIn").
//   4. REFUSES to report success unless a re-read of each chat 404s. A delete Unipile
//      accepts but LinkedIn ignores must never read as "gone" (same rule as linkedin-unpublish).
//   5. Only then closes the prospect: disqualified + blacklisted + skip_reason
//      DELETED_REASON, so no sender or drafter touches the person again and the inbox
//      drops the thread. Our own message rows stay; only LinkedIn's copy is removed.
//
// Deleting removes the chat from THIS seat's inbox. The other person keeps their copy.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ALLOWED_USER_ID = Deno.env.get('INBOX_DELETE_ALLOWED_USER_ID')
  ?? Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')
const DSN = Deno.env.get('UNIPILE_DSN') ?? Deno.env.get('FOLLOWER_UNIPILE_DSN')
const KEY = Deno.env.get('UNIPILE_KEY') ?? Deno.env.get('FOLLOWER_UNIPILE_KEY')

// Read by the inbox (groupThreads drops these threads). Keep in sync with DELETED_REASON
// in src/lib/inbox.ts.
const DELETED_REASON = 'thread_deleted_by_operator'

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
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  })
}

const uni = (path: string, method = 'GET') =>
  fetch(`https://${DSN}/api/v1${path}`, {
    method,
    headers: { 'X-API-KEY': KEY!, accept: 'application/json' },
  })

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) })
  if (req.method !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' }, origin)

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_KEY || !ALLOWED_USER_ID || !DSN || !KEY) {
    console.error('refusing: incomplete config', {
      url: !!SUPABASE_URL, anon: !!SUPABASE_ANON_KEY, service: !!SERVICE_KEY,
      allow: !!ALLOWED_USER_ID, dsn: !!DSN, key: !!KEY,
    })
    return reply(503, { ok: false, error: 'not_configured' }, origin)
  }

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
    .select('unipile_chat_id').eq('prospect_id', prospectId).not('unipile_chat_id', 'is', null)
  if (rowsErr) return reply(500, { ok: false, error: 'read_failed', detail: rowsErr.message }, origin)
  const chatIds = [...new Set((rows ?? []).map(r => r.unipile_chat_id as string).filter(Boolean))]
  if (chatIds.length === 0) {
    return reply(409, { ok: false, error: 'no_linkedin_chat', detail: 'Invite only: there is no LinkedIn conversation to delete.' }, origin)
  }

  const results: { chat_id: string; deleted: boolean; status?: number; detail?: string }[] = []
  for (const id of chatIds) {
    const del = await uni(`/chats/${encodeURIComponent(id)}`, 'DELETE')
    const delText = await del.text()
    // A chat that is already gone reads 404 on both calls; that counts as deleted.
    const check = await uni(`/chats/${encodeURIComponent(id)}`)
    await check.body?.cancel()
    const gone = check.status === 404
    results.push({ chat_id: id, deleted: gone, status: del.status, detail: gone ? undefined : delText.slice(0, 300) })
  }
  const failed = results.filter(r => !r.deleted)
  if (failed.length > 0) {
    console.error('delete not confirmed', failed)
    return reply(502, { ok: false, error: 'delete_not_confirmed', results }, origin)
  }

  const { error: upErr } = await db.from('outreach_prospects')
    .update({
      stage: 'disqualified', blacklisted: true, needs_manual_reply: false,
      skip_reason: DELETED_REASON, updated_at: new Date().toISOString(),
    })
    .eq('id', prospectId)
  if (upErr) {
    // LinkedIn side is done; say so plainly so the operator is not told it failed.
    return reply(500, { ok: false, error: 'deleted_but_not_closed', detail: upErr.message, results }, origin)
  }
  return reply(200, { ok: true, results }, origin)
})
