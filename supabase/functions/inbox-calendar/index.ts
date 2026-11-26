import { createClient } from 'npm:@supabase/supabase-js@2'
import { calendarUser, handleCalendar, type Booking, type Store } from './handler.ts'
import { handleBookCard, type CardStore } from './card.ts'

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
    // CALENDAR_BOOKED_LABELS_V1: our own booked intro calls on this owner's calendar (30 minutes each): the attribution
    // ledger plus inbox bookings confirmed but not yet attributed. Any read error throws (the handler marks it degraded).
    async booked(client, from, to) {
      const since = new Date(Date.parse(from) - 3600000).toISOString()
      const rows: { start: string; prospect_id: string | null; name: string | null }[] = [], attributed = new Set<string>()
      const pageAll = async <T,>(q: (lo: number, hi: number) => PromiseLike<{ data: T[] | null; error: unknown }>) => {
        const out: T[] = []
        for (let page = 0; ; page++) {
          if (page >= 10) throw Error('booked')   // over 2,000 rows in a month: say the labels are incomplete
          const { data, error } = await q(page * 200, page * 200 + 199)
          if (error) throw Error('booked')
          out.push(...(data ?? []))
          if ((data ?? []).length < 200) return out
        }
      }
      // every attribution (canceled too): a canceled meeting is never shown again from the inbox ledger
      const att = await pageAll<{ meeting_id: string | null; meeting_start: string; prospect_id: string | null; booker_name: string | null; booker_email: string | null; meeting_outcome: string | null }>((lo, hi) => sb.from('booking_attributions').select('meeting_id,meeting_start,prospect_id,booker_name,booker_email,meeting_outcome').eq('client_id', client).gte('meeting_start', since).lt('meeting_start', to).order('meeting_start').order('meeting_id').range(lo, hi))
      const canceled = (o: string | null) => /^cancel+ed$/i.test(String(o ?? ''))   // CANCELED, CANCELLED and canceled all occur
      for (const r of att) {
        if (r.meeting_id) attributed.add(String(r.meeting_id))
        if (!canceled(r.meeting_outcome)) rows.push({ start: r.meeting_start, prospect_id: r.prospect_id, name: r.booker_name })
      }
      const inbox = await pageAll<{ start_at: string; prospect_id: string | null; meeting_id: string | null; calendar_event_id: string | null; email: string | null }>((lo, hi) => sb.from('inbox_calendar_bookings').select('start_at,prospect_id,meeting_id,calendar_event_id,email').eq('client_id', client).eq('status', 'confirmed').gte('start_at', since).lt('start_at', to).order('start_at').order('request_id').range(lo, hi))
      for (const r of inbox) {
        // attributed (or canceled) already: same meeting id, same prospect + start, or same invite email + start (a cancel
        // can clear the attribution's prospect before the receipt has its meeting id)
        const sameStart = (x: { meeting_start: string }) => Date.parse(x.meeting_start) === Date.parse(r.start_at)
        if ((r.meeting_id && attributed.has(String(r.meeting_id))) || att.some(x => sameStart(x) && ((r.prospect_id && x.prospect_id === r.prospect_id) || (r.email && String(x.booker_email ?? '').trim().toLowerCase() === r.email.trim().toLowerCase())))) continue
        rows.push({ start: r.start_at, prospect_id: r.prospect_id, name: null })
      }
      const ids = [...new Set(rows.map(r => r.prospect_id).filter((x): x is string => !!x))], byId = new Map<string, { name: string | null; company: string | null }>()
      for (let i = 0; i < ids.length; i += 50) {
        const { data: ps, error } = await sb.from('outreach_prospects').select('id,name,company').in('id', ids.slice(i, i + 50))
        if (error) throw Error('booked')
        for (const p of ps ?? []) byId.set(p.id, p)
      }
      return rows.filter(r => Number.isFinite(Date.parse(r.start))).map(r => {
        const p = r.prospect_id ? byId.get(r.prospect_id) : undefined, name = String(p?.name || r.name || 'Booked call').trim()
        return { start: new Date(r.start).toISOString(), end: new Date(Date.parse(r.start) + 1800000).toISOString(), label: `Intro call: ${name}${p?.company ? ` (${p.company})` : ''}`, ours: true }
      })
    },
  }
  // BOOKING_CARD_OFFERED_SLOT_V1: the Book key on an Ops card (card.ts). Same login, same private ledger.
  const cardStore: CardStore = {
    async card(id) {
      const { data, error } = await sb.from('ops_drafts').select('id,kind,approved_at,sent_at,send_blocked_reason,context').eq('id', id).maybeSingle()
      if (error) throw Error('The card could not be loaded.')
      return data
    },
    async prospect(id) {
      const p = await store.prospect(id)
      if (!p) return null
      const { data, error } = await sb.from('outreach_prospects').select('company_domain').eq('id', id).single()
      if (error) throw Error('Conversation could not be loaded.')
      const domain = String(data?.company_domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      return { id: p.id, name: p.name, client_id: p.client_id, call_booked_at: p.call_booked_at, closed: p.closed, company_domain: /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null }
    },
    async existing(id, client) {
      const { data, error } = await sb.from('inbox_calendar_bookings').select('request_id,status,start_at,calendar_event_id,meeting_id,booked_at').eq('prospect_id', id).eq('client_id', client).neq('status', 'failed').limit(1).maybeSingle()
      if (error) throw Error('Booking status could not be verified. Nothing was booked.')
      if (data) return { request_id: data.request_id, status: data.status, start: data.start_at, calendar_event_id: data.calendar_event_id, meeting_id: data.meeting_id, booked_at: data.booked_at }
      const { data: a, error: ae } = await sb.from('booking_attributions').select('meeting_id').eq('prospect_id', id).eq('client_id', client).or('meeting_outcome.is.null,meeting_outcome.neq.CANCELED').limit(1).maybeSingle()
      if (ae) throw Error('Existing bookings could not be verified. Nothing was booked.')
      return a ? { request_id: '', status: 'booked' } : null
    },
    secret: store.secret,
    claim: store.claim,
    async current(ctx, slot, email) {
      const draftId = typeof ctx.draft_message_id === 'string' ? ctx.draft_message_id : null, sourceId = typeof ctx.source_message_id === 'string' ? ctx.source_message_id : null
      if (!draftId || !sourceId) return { ok: false, reason: 'This card does not name the reply and message it goes with. Book by hand. Nothing was booked.' }
      {
        const { data: d, error } = await sb.from('outreach_messages').select('prospect_id,sent_at,send_blocked_reason,draft_evidence').eq('id', draftId).maybeSingle()
        if (error) throw Error('The staged reply could not be checked. Nothing was booked.')
        const cs = (d?.draft_evidence as { calendar_slots?: { hold_reason?: string; invite_email?: string; accepted_slot?: { start?: string; end?: string } } } | null)?.calendar_slots
        if (!d || d.prospect_id !== ctx.prospect_id || d.sent_at || !['', 'lint_calendar_booking_pending', 'awaiting_client_review'].includes(d.send_blocked_reason ?? '')) return { ok: false, reason: 'The reply this card goes with was sent, discarded or blocked. Nothing was booked.' }
        if (cs?.hold_reason !== 'calendar_booking_pending' || Date.parse(String(cs.accepted_slot?.start)) !== Date.parse(slot.start) || Date.parse(String(cs.accepted_slot?.end)) !== Date.parse(slot.end) || String(cs.invite_email ?? '').toLowerCase() !== email) return { ok: false, reason: 'The staged reply no longer names this time and email. Nothing was booked.' }
      }
      {
        const { data: src, error } = await sb.from('outreach_messages').select('prospect_id,sent_at,created_at').eq('id', sourceId).maybeSingle()
        if (error || !src || src.prospect_id !== ctx.prospect_id) throw Error('The message this card answers could not be checked. Nothing was booked.')
        // the drafter's own clock: sent_at, else created_at (an inbound row with no sent_at still counts)
        const since = new Date(src.sent_at ?? src.created_at).toISOString()
        const { data: newer, error: ne } = await sb.from('outreach_messages').select('id').eq('prospect_id', ctx.prospect_id as string).eq('direction', 'inbound').or(`sent_at.gt.${since},and(sent_at.is.null,created_at.gt.${since})`).or('is_reaction.is.null,is_reaction.eq.false').neq('id', sourceId).limit(1)
        if (ne) throw Error('New messages could not be checked. Nothing was booked.')
        if (newer?.length) return { ok: false, reason: 'They wrote again after this card was made. Read the thread before booking. Nothing was booked.' }
      }
      return { ok: true }
    },
    async commit(requestId, cardId, event, meeting, booked) {
      const { data, error } = await sb.rpc('inbox_booking_card_commit', { p_request: requestId, p_card: cardId, p_event: event, p_meeting: meeting, p_booked: booked })
      if (error) throw Error('The booking could not be saved.')
      return data ?? {}
    },
  }
  let input
  try { input = await req.json(); if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error() }
  catch { return respond({ error: 'A valid calendar request is required.' }, 400) }
  try { return respond(input.action === 'book_card' ? await handleBookCard(input, cardStore) : await handleCalendar(input, store)) }
  catch (e) {
    // Only controlled errors are returned. Do not log contact data, tokens or provider responses.
    return respond({ error: e instanceof Error ? e.message : 'Calendar assistance is unavailable. Try again.' }, 409)
  }
})
