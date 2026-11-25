import { createClient } from 'npm:@supabase/supabase-js@2'
import { observeScanEmails } from './watch.ts'

Deno.serve(async (req) => {
  const secret = Deno.env.get('INBOX_PUSH_SECRET')
  const operator = Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')
  const url = Deno.env.get('SUPABASE_URL'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret || !operator || !url || !service) return Response.json({ error: 'unconfigured' }, { status: 503 })
  if (req.method !== 'POST') return Response.json({ error: 'method' }, { status: 405 })
  if (req.headers.get('x-inbox-secret') !== secret) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const db = createClient(url, service, { auth: { persistSession: false } })
  const { data: config, error: configError } = await db.from('integration_config').select('value').eq(
    'key',
    'assistant_scan_watch_mode',
  ).maybeSingle()
  if (configError) return Response.json({ error: 'mode_unavailable' }, { status: 503 })
  if (!['shadow', 'chat'].includes(config?.value)) return Response.json({ mode: 'off' })
  const now = new Date()
  // Fail closed on a truncated cohort so new requests cannot crowd older ones out of every pass.
  const { data, error } = await db.rpc('assistant_rise_scan_email').limit(201)
  if (error || !data || data.length > 200) {
    return Response.json({ error: 'cohort_unavailable_or_too_large' }, { status: 503 })
  }
  const observations = await observeScanEmails(data, async () => {
    const { data: key } = await db.from('integration_config').select('value').eq('key', 'resend_api_key').maybeSingle()
    return typeof key?.value === 'string' ? key.value : undefined
  }, now)
  const saved = await db.rpc('assistant_scan_watch_record', {
    p_operator: operator,
    p_started: now.toISOString(),
    p_observations: observations,
  })
  if (saved.error) return Response.json({ error: 'observation_save_failed' }, { status: 503 })
  return Response.json(saved.data)
})
