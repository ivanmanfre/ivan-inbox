// inbox-notify — the front door to the one notification feed.
//
// Server-to-server only: n8n workflows, the turn webhook, anything else that
// wants Ivan's attention. The gate is `x-inbox-secret` equal to INBOX_PUSH_SECRET,
// checked BEFORE the body is read, and it is never the anon key: a browser bearer
// must not be able to write this feed, so an `Authorization` header on its own
// buys nothing here. Deployed with --no-verify-jwt for exactly that reason.
//
// The work itself lives in ../_shared/notify.ts so inbox-turn-run runs the same
// implementation in-process instead of HTTP-hopping to its neighbour.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { notify, NotifyError } from '../_shared/notify.ts'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function err(status: number, code: string, detail?: string) {
  return new Response(JSON.stringify({ error: code, detail }), { status, headers: JSON_HEADERS })
}

Deno.serve(async (req) => {
  // 1. secret, before anything else touches the request
  const secret = Deno.env.get('INBOX_PUSH_SECRET')
  if (!secret) return err(503, 'notify_not_configured')
  if (req.headers.get('x-inbox-secret') !== secret) return err(401, 'unauthorized')
  if (req.method !== 'POST') return err(405, 'method_not_allowed')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return err(400, 'bad_json')
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  try {
    const out = await notify(db, body)
    return new Response(JSON.stringify(out), { headers: JSON_HEADERS })
  } catch (e) {
    if (e instanceof NotifyError) return err(e.status, e.code, e.message === e.code ? undefined : e.message)
    // Never a stack out the door. The log keeps the detail; the caller gets a name.
    console.error('inbox-notify failed', e)
    return err(500, 'notify_failed')
  }
})
