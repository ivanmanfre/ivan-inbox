// brain-undo: the Undo link on the brain's Monday / monthly feed line (self-updating brain, 11 Oct 2026).
// GET ?t=<undo_token uuid> -> public.brain_rule_undo(token): restores the consumer's before value from
// brain_rule_events and sets veto=true so the rule never re-applies by itself. The token is a random uuid
// stored on the apply event; nothing else is accepted. Deployed with --no-verify-jwt (a plain link).
// 12 Oct 2026: answers in plain text. Supabase serves function HTML on *.supabase.co as text/plain, so the old
// HTML answer showed as raw markup in the browser. (A confirm button is not possible for the same reason; the
// line is feed-only, nothing unfurls it, and an accidental undo only restores the old value.)
const SB = Deno.env.get('SUPABASE_URL')!
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function page(title: string, body: string, status = 200): Response {
  return new Response(`${title}\n\n${body}\n`, {
    status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  })
}

Deno.serve(async (req) => {
  const t = new URL(req.url).searchParams.get('t') || ''
  if (!UUID.test(t)) return page('Unknown link', 'This undo link is not valid.', 400)
  const r = await fetch(`${SB}/rest/v1/rpc/brain_rule_undo`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: t }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return page('Undo failed', 'The change was not undone. Nothing else was touched.', 500)
  if (j.error === 'unknown_token') return page('Unknown link', 'No brain change matches this link.', 404)
  if (j.already_rolled_back) return page('Already undone', 'This change was already undone.')
  return page('Undone', 'The brain change is rolled back and this rule will not re-apply by itself.')
})
