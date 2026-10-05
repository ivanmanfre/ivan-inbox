import { createClient } from 'npm:@supabase/supabase-js@2'
import { forwardReceivedEmail, validateForwardInput } from './forward.ts'
import { checkForwardUser } from './auth.ts'

const url = Deno.env.get('SUPABASE_URL')
const anon = Deno.env.get('SUPABASE_ANON_KEY')
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const allowedUser = Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')
const resendKey = Deno.env.get('RESEND_API_KEY')
const origins = ['https://ivanmanfre.github.io', 'http://localhost:4173', 'http://localhost:4174', 'http://localhost:4175', 'http://localhost:5173', 'http://localhost:5431']

Deno.serve(async req => {
  const origin = req.headers.get('origin')
  const cors = { 'Access-Control-Allow-Origin': origin && origins.includes(origin) ? origin : origins[0],
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }
  const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { ok: false, error: 'Method not allowed.' })
  if (!url || !anon || !service || !allowedUser || !resendKey) return reply(503, { ok: false, error: 'Email forwarding is not configured.' })
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || ''
  const auth = createClient(url, anon, { auth: { persistSession: false } })
  const authFailure = await checkForwardUser(auth.auth, token, allowedUser)
  if (authFailure) return reply(authFailure.status, { ok: false, error: authFailure.error })
  let input
  try { input = validateForwardInput(await req.json()) } catch (e) { return reply(400, { ok: false, error: e instanceof Error ? e.message : 'Invalid forwarding request.' }) }
  const db = createClient(url, service, { auth: { persistSession: false } })
  const { data: message, error: readError } = await db.from('outreach_messages')
    .select('id,prospect_id,direction,channel,unipile_message_id,draft_evidence').eq('id', input.message_id).single()
  if (readError || !message) return reply(404, { ok: false, error: 'The original email could not be found. Refresh and try again.' })
  if (message.direction !== 'inbound' || message.channel !== 'email') return reply(400, { ok: false, error: 'Choose a received email to forward.' })
  const { data: prospect, error: prospectError } = await db.from('outreach_prospects').select('campaign_id').eq('id', message.prospect_id).single()
  if (prospectError || !prospect) return reply(409, { ok: false, error: 'The email owner could not be verified.' })
  const { data: campaign, error: campaignError } = await db.from('outreach_campaigns').select('client_id').eq('id', prospect.campaign_id).single()
  if (campaignError || !campaign || !['arch', 'risedtc'].includes(campaign.client_id)) return reply(409, { ok: false, error: 'Forwarding is unavailable for this email account.' })
  const { data: config, error: configError } = await db.from('integration_config').select('value').eq('key', 'outreach_email_identities').single()
  let from = ''
  try { from = (typeof config?.value === 'string' ? JSON.parse(config.value) : config?.value)?.[campaign.client_id]?.from || '' } catch { /* Fail closed. */ }
  if (configError || !from) return reply(503, { ok: false, error: 'The sender identity is unavailable. The forward was not sent.' })
  const resendId = message.draft_evidence?.email?.resend_id || (message.unipile_message_id?.startsWith('resend:') ? message.unipile_message_id.slice(7) : '')
  if (!resendId) return reply(409, { ok: false, error: 'The original email is unavailable for forwarding.' })
  try {
    const emailId = await forwardReceivedEmail(resendId, from, input, resendKey)
    return reply(200, { ok: true, email_id: emailId })
  } catch (e) { return reply(502, { ok: false, error: e instanceof Error ? e.message : 'Forwarding failed. Try again.' }) }
})
