import { createClient } from 'npm:@supabase/supabase-js@2'
import { calendarUser, handleCalendar, type Booking, type Store } from './handler.ts'

// INBOX_CALENDAR_V1. Provider credentials and the private write ledger never reach the browser.
Deno.serve(async req => {
  const origin = req.headers.get('origin') ?? ''
  const headers = { 'Access-Control-Allow-Origin': origin === 'https://ivanmanfre.github.io' || /^http:\/\/localhost:\d{4,5}$/.test(origin) ? origin : 'https://ivanmanfre.github.io',
    'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', Vary: 'Origin' }
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers })
  if (req.method === 'OPTIONS') return respond({ ok: true })
  if (req.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405)
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), allowed = Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')
  if (!url || !anon || !service || !allowed) return respond({ error: 'Calendar assistance is not configured.' }, 503)
  const auth = createClient(url, anon, { auth: { persistSession: false } })
  const denied = await calendarUser(auth.auth, (req.headers.get('Authorization') ?? '').replace(/^Bearer /, ''), allowed)
  if (denied) return respond({ error: denied === 503 ? 'Login verification is unavailable. Try again.' : denied === 403 ? 'Access denied.' : 'Sign in again to use calendar assistance.' }, denied)
  const sb = createClient(url, service, { auth: { persistSession: false } })
  const store: Store = {
    async prospect(id) {
      const { data: p, error } = await sb.from('outreach_prospects').select('id,name,email,campaign_id,call_booked_at,stage,blacklisted,skip_reason').eq('id', id).maybeSingle()
      if (error) throw Error('Conversation could not be loaded.')
      if (!p?.campaign_id) return null
      const { data: c, error: ce } = await sb.from('outreach_campaigns').select('client_id').eq('id', p.campaign_id).single()
      if (ce) throw Error('Conversation identity could not be verified.')
      return { ...p, client_id: c.client_id, closed: Boolean(p.blacklisted || p.skip_reason || ['archived', 'skipped', 'disqualified', 'unsubscribed', 'blacklisted'].includes(p.stage)) }
    },
    async existing(id, client) {
      const { data, error } = await sb.from('inbox_calendar_bookings').select('request_id,status,start_at,end_at,calendar_event_id,meeting_id,booked_at,handoff_at').eq('prospect_id', id).eq('client_id', client).neq('status', 'failed').limit(1).maybeSingle()
      if (error) throw Error('Booking status could not be verified. No new invite was created.')
      if (data) return { request_id: data.request_id, status: data.status, start: data.start_at, end: data.end_at, calendar_event_id: data.calendar_event_id, meeting_id: data.meeting_id, booked_at: data.booked_at, handoff: Boolean(data.handoff_at) } as Booking
      const { data: attributed, error: ae } = await sb.from('booking_attributions').select('meeting_id,meeting_start,booked_at').eq('prospect_id', id).eq('client_id', client).or('meeting_outcome.is.null,meeting_outcome.neq.CANCELED').order('meeting_start', { ascending: false }).limit(1).maybeSingle()
      if (ae) throw Error('Existing bookings could not be verified. No new invite was created.')
      return attributed ? { status: 'booked', meeting_id: attributed.meeting_id, start: attributed.meeting_start, booked_at: attributed.booked_at } : null
    },
    async secret(key) {
      const { data, error } = await sb.from('integration_config').select('value').eq('key', key).single()
      if (error || !data?.value) throw Error('The owner calendar is not connected. Use the booking link.')
      return data.value
    },
    async claim(id, client, requestId, start, email, timezone) {
      const { data, error } = await sb.rpc('inbox_calendar_claim', { p_prospect: id, p_client: client, p_request: requestId, p_start: start, p_email: email, p_timezone: timezone })
      if (error) throw Error('A booking could not be started. No new invite was created.')
      return data === true
    },
    async save(id, status, receipt) {
      if (status === 'confirmed' && receipt) {
        const { error } = await sb.rpc('inbox_calendar_confirm', { p_request: id, p_event: receipt.calendar_event_id })
        if (error) throw Error('The calendar receipt and Ops handoff could not be saved.')
        return
      }
      const { data, error } = await sb.from('inbox_calendar_bookings').update({ status, ...(receipt ? { calendar_event_id: receipt.calendar_event_id } : {}), updated_at: new Date().toISOString() }).eq('request_id', id).eq('status', 'pending').select('request_id')
      if (error || !data?.length) throw Error('The booking receipt could not be saved.')
    },
    async finish(id, meeting) {
      const { error } = await sb.rpc('inbox_calendar_finish', { p_request: id, p_meeting: meeting.meeting_id, p_booked: meeting.booked_at })
      if (error) throw Error('The invite is confirmed; the Ops handoff is awaiting sync.')
    },
  }
  let input
  try { input = await req.json(); if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error() }
  catch { return respond({ error: 'A valid calendar request is required.' }, 400) }
  try { return respond(await handleCalendar(input, store)) }
  catch (e) {
    // Only controlled errors are returned. Do not log contact data, tokens or provider responses.
    return respond({ error: e instanceof Error ? e.message : 'Calendar assistance is unavailable. Try again.' }, 409)
  }
})
