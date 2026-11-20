import { supabase } from './supabase'

/** What the pane says while a yes to the scan/report/audit is still being built, for the two lanes that
 *  build after the yes and had no status at all (Ivan 11-20, Cameron Shute / Margaret So: "this doesnt
 *  even say if the scan is being built"). RISE keeps its own scan_owed banner (scanHold.ts).
 *
 *  SwishDM: the Accept + Reply Detector stamps enrichment_data.swishdm_page_request {status:'requested'}
 *  on a yes; the Comparison Page Builder (Z1i8e08XhYtcEU6h) moves it to held_rebuild / error / built_held
 *  and claims the long build in `v8` {state:'running', first_at, until}.
 *  Ivan: the Warm Reply Drafter (X8woPv26UrC4Mnhz) stamps enrichment_data.scan_build
 *  {requested_at, first_requested_at, attempts} on every build attempt (every 25 min until it exists), or
 *  {skipped:'thin_corpus'}. The stamp is never cleared after the build (235 rows on 11-20), so it only
 *  counts when an attempt ran at or after the yes the thread is owed on. */

export type SwishRequest = {
  status?: string; at?: string; hold?: string; error?: string; url?: string | null
  reasons_error?: string; checks_error?: string
  v8?: { state?: string; first_at?: string; at?: string; until?: string; why?: string; retry_after?: string } | null
}
export type IvanBuild = { requested_at?: string; first_requested_at?: string; attempts?: number; skipped?: string; at?: string; exhausted_alert_at?: string }

export type BuildStatus = { tone: 'wait' | 'alert'; head: string; body: string; url?: string | null }

type Ctx = { first: string; since: string | null; now: number; hm: (iso: string) => string }

const SWISH_HOLD: Record<string, string> = {
  post_accept_check_pending: 'the ChatGPT and Gemini check on the brand to finish',
  fairness_rebuild_pending: 'a fresh ChatGPT and Gemini check on the brand',
  fairness_v1_pending: 'a fresh ChatGPT and Gemini check on the brand',
}
const SWISH_ERROR: Record<string, string> = {
  no_evidence: 'there are no saved ChatGPT or Gemini answers for this brand',
  search_too_few_brand_answers: 'too few ChatGPT and Gemini answers name the brand to make a fair page',
}

const RECENT_SLACK_MS = 15 * 60e3   // a stamp a few minutes before the owed message still belongs to it

export function readSwishBuild(rq: SwishRequest | null, c: Ctx): BuildStatus | null {
  if (!rq || !rq.status) return null
  const yes = `${c.first} said yes to the report.`
  const nothing = 'Nothing goes out without the report.'
  if (rq.status === 'requested') {
    const v8 = rq.v8 ?? null
    if (v8?.state === 'running' && (!v8.until || Date.parse(v8.until) > c.now)) return {
      tone: 'wait', head: `${yes} It is being built now${v8.first_at ? ` (started ${c.hm(v8.first_at)})` : ''}.`,
      body: `The reply with the link drafts itself here when the page is ready, usually within 30 minutes. ${nothing}`,
    }
    const retry = rq.v8?.retry_after && Date.parse(rq.v8.retry_after) > c.now ? ` A build try failed${rq.v8.why ? ` (${rq.v8.why})` : ''}, next try ${c.hm(rq.v8.retry_after)}.`
      : rq.reasons_error || rq.checks_error ? ` The last try failed (${rq.reasons_error || rq.checks_error}), it retries on the next run.` : ''
    return {
      tone: 'wait', head: `${yes} It is queued to build${rq.at ? ` (asked ${c.hm(rq.at)})` : ''}.`,
      body: `The page builder checks every few minutes.${retry} The reply with the link drafts itself here when the page is ready. ${nothing}`,
    }
  }
  if (rq.status === 'held_rebuild') return {
    tone: 'wait', head: `${yes} The page waits for ${SWISH_HOLD[rq.hold ?? ''] ?? 'a fresh check on the brand'}.`,
    body: `It is re-checked every run and builds on its own after that. ${nothing}`,
  }
  // error / built_held are finished states: they speak only for the yes this thread is owed on, never a later "thanks"
  const forThisYes = Boolean(c.since && rq.at && Date.parse(rq.at) >= Date.parse(c.since) - RECENT_SLACK_MS)
  if (!forThisYes) return null
  if (rq.status === 'error') return {
    tone: 'alert', head: `${yes} The page could not be built: ${SWISH_ERROR[rq.error ?? ''] ?? rq.error ?? 'unknown error'}.`,
    body: 'No reply was drafted. Write it yourself below, or answer on LinkedIn.',
  }
  if (rq.status === 'built_held' && rq.url) return {
    tone: 'alert', head: `${c.first}'s report page is built, but no reply with it is waiting here.`,
    body: 'The drafted reply was sent, blocked or deleted. Check the page, then write the reply yourself.', url: rq.url,
  }
  return null
}

export function readIvanBuild(sb: IvanBuild | null, c: Ctx): BuildStatus | null {
  if (!sb || !c.since) return null
  const since = Date.parse(c.since) - RECENT_SLACK_MS
  const yes = `${c.first} said yes to the audit.`
  if (sb.skipped === 'thin_corpus') {
    if (!sb.at || Date.parse(sb.at) < since) return null
    return { tone: 'alert', head: `${yes} There is too little on their profile to build it.`, body: 'No reply was drafted. Write it yourself below.' }
  }
  if (!sb.requested_at || Date.parse(sb.requested_at) < since) return null
  const n = sb.attempts ?? 1
  const first = sb.first_requested_at ?? sb.requested_at
  const slow = n >= 3 || Boolean(sb.exhausted_alert_at)
  return {
    tone: 'wait',
    head: `${yes} It is being built now (started ${c.hm(first)}).`,
    body: slow
      ? `Taking longer than usual: try ${n}, the last one at ${c.hm(sb.requested_at)}. It retries every 25 minutes until it is ready. Nothing goes out without the audit.`
      : 'The reply with the link drafts itself here when it is ready, usually within 30 minutes. Nothing goes out without the audit.',
  }
}

export type BuildRaw = { sw: SwishRequest | null; sb: IvanBuild | null; readAt?: string | null }

export async function fetchBuildRaw(prospectId: string): Promise<BuildRaw> {
  const { data, error } = await supabase.from('outreach_prospects')
    .select('sw:enrichment_data->swishdm_page_request,sb:enrichment_data->scan_build,readAt:enrichment_data->swishdm_reply->>at').eq('id', prospectId).single()
  if (error) throw error
  return data as BuildRaw
}

/** Before the drafter has read a new reply there is no stamp yet: SwishDM's Accept + Reply Detector runs
 *  every 15 min, Ivan's Warm Reply Drafter every 5 (Ivan 11-20, Jake/Hadley Pottery: yes at 16:42Z, stamp
 *  16:45Z, and the pane said "no draft" in between). Shown only inside that window plus a few minutes. */
export function readFreshReply(c: Ctx, everyMin: number, readAt?: string | null): BuildStatus | null {
  if (!c.since) return null
  if (readAt && Date.parse(readAt) >= Date.parse(c.since)) return null   // already read (SwishDM stamps swishdm_reply.at)
  const ago = Math.max(0, Math.round((c.now - Date.parse(c.since)) / 60e3))
  if (!Number.isFinite(ago) || ago > everyMin + 5) return null
  return {
    tone: 'wait',
    head: `${c.first} replied ${ago === 0 ? 'just now' : `${ago} min ago`}. The drafter has not read it yet.`,
    body: `It reads new replies every ${everyMin} minutes. A yes to the ${everyMin === 15 ? 'report' : 'audit'} starts the build then, and this note updates on its own.`,
  }
}

/** The name to address someone by: the first word that is not a bare initial ("C. Jake George" is Jake). */
export function firstName(full: string): string {
  const words = full.trim().split(/\s+/)
  return words.find(w => !/^\p{L}\.?$/u.test(w)) ?? words[0] ?? full
}
