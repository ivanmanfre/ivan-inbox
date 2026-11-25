import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

// On-demand evidence for the operator's RISE scan questions. Prospect text and
// provider bodies are inspected for exact URLs and never passed to the agent.
export interface ScanCase {
  inbound_id: string
  prospect_id: string
  person: string
  company: string | null
  asked_at: string
  address: string
  address_count: number
  sender: string | null
  request_signal: string
  disposition: string | null
  report_url: string | null
  email_at: string | null
  email_report_at: string | null
  linkedin_report_at: string | null
}

export const staleScanAlert = 'This alert no longer matches a current RISE scan request. Open the latest scan check to find the request.'
export async function readScanAlertInbound(db: SupabaseClient, owner: string, threadId: string, alertId: string): Promise<string | undefined> {
  const { data, error } = await db.from('inbox_turns').select('sources')
    .match({ id: alertId, user_id: owner, thread_id: threadId, origin: 'bot', status: 'done' }).maybeSingle()
  if (error) throw new Error('scan_alert_lookup_failed')
  const sources = Array.isArray(data?.sources)
    ? data.sources.filter((s: { kind?: string } | null) => s?.kind === 'rise_scan_watch') : []
  if (sources.length !== 1) return
  const path = sources[0].path
  if (typeof path === 'string' && uuid.test(path)) return path
}

const draftRequest = /^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:draft|write|prepare)\b/i
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export type ScanReference = { kind: 'alert' | 'question'; path: string } | { kind: 'unresolved' }
export function scanAnswerSource(ref: ScanReference | null) {
  if (ref?.kind === 'alert' || ref?.kind === 'unresolved') {
    return { kind: 'rise_scan_email_alert', path: ref.kind === 'alert' ? ref.path : 'unresolved' }
  }
  return { kind: 'rise_scan_email', path: 'RISE scan-email check' }
}

export function scanFollowupReference(prior: { id: string; status: string; origin: string; prompt: string; sources: unknown } | null): ScanReference | null {
  if (!prior || !Array.isArray(prior.sources)) return null
  const saved = prior.sources.find(s => s?.kind === 'rise_scan_email_alert')
  if (prior.origin === 'operator' && saved) {
    return typeof saved.path === 'string' && uuid.test(saved.path) ? { kind: 'alert', path: saved.path } : { kind: 'unresolved' }
  }
  if (prior.status !== 'done') return null
  if (prior.origin === 'bot' && prior.sources.some(s => s?.kind === 'rise_scan_watch')) return { kind: 'alert', path: prior.id }
  if (prior.origin === 'operator' && prior.sources.some(s => s?.kind === 'rise_scan_email')) {
    // Older private drafts did not save the alert that produced them.
    return draftRequest.test(prior.prompt) ? { kind: 'unresolved' } : { kind: 'question', path: prior.prompt }
  }
  return null
}
export const scanDraftReference =
  /^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:draft|write|prepare) (?:it|the email|that email|the scan email)(?: please)?[.!?]?$/i
export function asksAboutScanEmail(prompt: string): boolean {
  if (/\b(swishdm|arch|jonathan|davorin)\b/i.test(prompt) && !/\b(rise|mattan)\b/i.test(prompt)) return false
  if (draftRequest.test(prompt.trim())) {
    return /\bscan\b/i.test(prompt) && /\be-?mail\b/i.test(prompt) &&
      !/\b(send|schedule|post|publish|carousel)\b/i.test(prompt)
  }
  if (/\b(posts?|editorial|calendar|carousel|content plan)\b/i.test(prompt)) return false
  // A read never consumes an instruction to send, change or prepare anything.
  if (
    /\b(?:send|email|draft|write|prepare|create|fix|investigate|generate|publish|plan|schedule|make)\b/i.test(prompt) &&
    !/^(?:did|has|have|was|were|who|which|when|where|what|is|are|show|check|list)\b/i.test(prompt.trim())
  ) return false
  if (
    /\b(?:and|then|also)\s+(?:please\s+)?(?:send|email|draft|write|prepare|create|edit|schedule|publish)\b/i.test(
      prompt,
    )
  ) return false
  return /\b(scans?|growth audits?)\b/i.test(prompt) &&
    /\b(mail(?:box|ed)?|e-?mails?|inbox|sent|send|delivered?|delivery|owe[ds]?|pending|miss(?:ed|ing)|receiv(?:ed|e)|get|got|follow[ -]?through)\b/i
      .test(prompt) &&
    !/\b(write|draft|plan|make)\b[^.!?]{0,26}\b(post|article|carousel)\b/i.test(prompt)
}

type ProviderEmail = { id: string; from: string; to: string[]; created_at: string; last_event?: string }
type EmailDetail = ProviderEmail & { text?: string | null; html?: string | null }
type Receipt = { state: string; event?: string; email_id?: string; at?: string }
type Page = { data: ProviderEmail[]; has_more: boolean }

function mailbox(value: string): string {
  return (value.match(/<([^<>]+)>\s*$/)?.[1] ?? value).trim().toLowerCase()
}
function sameEnvelope(email: ProviderEmail, row: ScanCase): boolean {
  return !!row.sender && row.address_count === 1 && mailbox(email.from) === mailbox(row.sender) &&
    email.to.some((a) => mailbox(a) === row.address) && Date.parse(email.created_at) >= Date.parse(row.asked_at)
}
export function containsReport(body: string, report: string): boolean {
  // Exclude a longer slug, a sub-path, and occurrences nested in another URL.
  const links = body.match(/https?:\/\/[^\s<>"']+/gi) ?? []
  return links.some((link) => {
    try {
      const u = new URL(link.replace(/[.,;!?)\]]+$/, ''))
      return u.origin + u.pathname.replace(/\/$/, '') === report && !u.username && !u.password
    } catch {
      return false
    }
  })
}

function namedCases(prompt: string, rows: ScanCase[]): ScanCase[] {
  const words = new Set(prompt.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  const named = rows.filter((r) =>
    r.person.toLowerCase().split(/\s+/).some((w) => w.length > 2 && words.has(w)) ||
    (r.company && prompt.toLowerCase().includes(r.company.toLowerCase()))
  )
  return named
}

function draftCases(prompt: string, rows: ScanCase[]): ScanCase[] {
  const question = prompt.trim().replace(/[.!?]+$/, '')
  const name = [
    /^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:draft|write|prepare)\s+(?:(?:the|an?)\s+)?(?:RISE\s+)?(?:growth\s+)?scan e-?mail\s+(?:for|about|to)\s+(.+)$/i,
    /^(?:did|has)\s+(.+?)\s+(?:get|got|received?|been sent)\s+(?:(?:the|their|its|his|her|our)\s+)?(?:growth\s+)?scan(?:\s+by\s+e-?mail)?$/i,
  ].map(pattern => pattern.exec(question)?.[1]).find(Boolean)
  if (!name) return []
  const normalized = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
  return rows.filter(r => [r.person, r.company].some(value => value && normalized(value) === normalized(name)))
}

// Read one account listing and fetch bodies only for the requested sender and
// recipient. A partial listing or rate limit can never establish a missing send.
export async function readReceipts(
  rows: ScanCase[],
  key: string | undefined,
  request = fetch,
): Promise<Map<string, Receipt>> {
  const receipts = new Map(rows.map((r) => [r.inbound_id, { state: 'provider_unavailable' } as Receipt]))
  if (!key || !rows.length) return receipts
  const deadline = AbortSignal.timeout(12_000)
  const get = async <T>(path: string): Promise<T> => {
    const res = await request('https://api.resend.com' + path, {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: 'Bearer ' + key },
      signal: deadline,
    })
    if (res.status === 429) {
      const retrySeconds = Number(res.headers.get('retry-after') ?? 1)
      if (Number.isFinite(retrySeconds) && retrySeconds >= 0 && retrySeconds <= 2) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(200, retrySeconds * 1000)))
        const retry = await request('https://api.resend.com' + path, {
          method: 'GET',
          redirect: 'error',
          headers: { Authorization: 'Bearer ' + key },
          signal: deadline,
        })
        if (retry.ok) return await retry.json() as T
      }
    }
    if (!res.ok) throw new Error('provider read unavailable')
    return await res.json() as T
  }
  const emails: ProviderEmail[] = []
  let hasMore = true
  let oldest = Infinity
  try {
    for (let i = 0; i < 3 && hasMore; i++) {
      const after = emails.at(-1)?.id
      const page = await get<Page>('/emails?limit=100' + (after ? '&after=' + encodeURIComponent(after) : ''))
      if (!Array.isArray(page.data) || typeof page.has_more !== 'boolean' || (page.has_more && !page.data.length)) {
        throw new Error('invalid page')
      }
      emails.push(...page.data)
      hasMore = page.has_more
      oldest = Date.parse(emails.at(-1)?.created_at ?? '')
      if (rows.every((r) => Date.parse(r.asked_at) >= oldest)) break
    }
  } catch {
    return receipts
  }
  const details = new Map<string, EmailDetail | null>()
  for (const r of rows) {
    if (!r.sender || r.address_count !== 1) {
      receipts.set(r.inbound_id, { state: 'sender_or_destination_unknown' })
      continue
    }
    const matches = emails.filter((e) => sameEnvelope(e, r))
    const covered = !hasMore || Date.parse(r.asked_at) >= oldest
    let complete = covered
    let receipt: Receipt | undefined
    for (const email of matches) {
      if (!r.report_url) break
      if (!details.has(email.id)) {
        if (details.size >= 20) {
          complete = false
          break
        }
        try {
          details.set(email.id, await get<EmailDetail>('/emails/' + encodeURIComponent(email.id)))
        } catch {
          details.set(email.id, null)
        }
      }
      const detail = details.get(email.id)
      if (!detail || !sameEnvelope(detail, r) || (typeof detail.text !== 'string' && typeof detail.html !== 'string')) {
        complete = false
        continue
      }
      if (containsReport(detail.text ?? '', r.report_url) || containsReport(detail.html ?? '', r.report_url)) {
        receipt = {
          state: 'exact_report_email',
          email_id: email.id,
          event: detail.last_event ?? 'unknown',
          at: detail.created_at,
        }
        break
      }
    }
    receipts.set(
      r.inbound_id,
      receipt ?? {
        state: !complete
          ? 'provider_check_incomplete'
          : !matches.length
          ? 'no_matching_email_in_connected_sender'
          : r.report_url
          ? 'email_found_without_exact_report'
          : 'email_found_report_identity_unknown',
      },
    )
  }
  return receipts
}

type Reader = {
  currentDraft?: (inboundId: string) => PromiseLike<{ data: ScanCase | null; error: unknown }>
  cases: () => PromiseLike<{ data: ScanCase[] | null; error: unknown }>
  providerKey: () => Promise<string | undefined>
}
async function draftStillCurrent(reader: Reader, row: ScanCase): Promise<boolean> {
  if (!reader.currentDraft) return false
  const { data, error } = await reader.currentDraft(row.inbound_id)
  if (error) throw new Error('current scan request unavailable')
  return !!data && !data.disposition && !data.email_at && !data.email_report_at && data.address_count === 1 &&
    data.inbound_id === row.inbound_id && data.prospect_id === row.prospect_id && Date.parse(data.asked_at) === Date.parse(row.asked_at) &&
    data.address === row.address && data.sender === row.sender && data.report_url === row.report_url &&
    data.person === row.person && data.company === row.company
}
const checkedOn = (stamp: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Warsaw',
  }).format(new Date(stamp))
function safeName(name: string): string {
  return name.replace(/[\r\n]/g, ' ').replace(/[\\\[\]_*<>]/g, '').slice(0, 100)
}
function describe(r: ScanCase, receipt: Receipt): string {
  const title = safeName(r.person)
  const trace = '[Open conversation](https://ivanmanfre.github.io/ivan-inbox/#exp/d/dms?thread=' +
    encodeURIComponent(r.prospect_id) + ')'
  const dest = r.address_count === 1 ? r.address : 'multiple addresses'
  const sentences: string[] = []
  if (r.disposition) sentences.push('The thread is marked ' + safeName(r.disposition) + '.')
  if (receipt.state === 'exact_report_email') {
    const when = receipt.at ? ' on ' + checkedOn(receipt.at) : ''
    const event = receipt.event
    if (event && ['delivered', 'opened', 'clicked'].includes(event)) {
      sentences.push('Resend confirms delivery to ' + dest + ' of the matching scan sent' + when + '.')
    } else if (event === 'bounced' || event === 'failed') {
      sentences.push('Resend marked the matching scan email to ' + dest + ' as ' + event + '.')
    } else {
      sentences.push(
        'Resend records the matching scan email to ' + dest + when + '. Its latest event is ' +
          safeName(event ?? 'unknown') + '.',
      )
    }
  } else {
    if (r.address_count !== 1) sentences.push('The request includes multiple addresses. Review the intended recipient.')
    else if (r.request_signal === 'asks_to_email_team') {
      sentences.push('Asked Mattan to email the team at ' + dest + '. The request leaves the material open.')
    } else if (r.request_signal === 'asks_to_email_details') {
      sentences.push('Asked Mattan to email details to ' + dest + ' after the scan offer.')
    } else if (r.request_signal === 'address_after_acceptance_phrase') {
      sentences.push('Accepted the offer and supplied ' + dest + '.')
    } else sentences.push('Supplied ' + dest + ' after a scan offer. Check what was requested.')
    if (r.linkedin_report_at) {
      sentences.push('The correct report was shared on LinkedIn on ' + checkedOn(r.linkedin_report_at) + '.')
    }
    if (r.email_report_at) {
      sentences.push('RISE logged the correct scan by email on ' + checkedOn(r.email_report_at) + '.')
    } else if (r.email_at) sentences.push('RISE logged an email on ' + checkedOn(r.email_at) + '.')
    if (receipt.state === 'no_matching_email_in_connected_sender') {
      sentences.push('No email to this address was found from the connected RISE sender after the request.')
    } else if (receipt.state === 'email_found_without_exact_report') {
      sentences.push('The email found in Resend contained a different link or no scan link.')
    } else if (receipt.state === 'email_found_report_identity_unknown') {
      sentences.push('Resend shows email to the address. I couldn’t match an approved report to its contents.')
    } else {
      sentences.push(
        'Provider delivery is unverified' +
          (receipt.state === 'provider_check_incomplete' ? ' because the receipt check was incomplete.' : '.'),
      )
    }
  }
  return '**' + title + '**. ' + sentences.join(' ') + ' ' + trace
}

export async function answerScanEmail(
  prompt: string,
  reader: Reader,
  request = fetch,
  previousScanQuestion?: string,
  watchedInbound?: string,
): Promise<string> {
  const scope = 'RISE requests from the past 28 days that included an email address after a scan offer.'
  try {
    const { data, error } = await reader.cases()
    if (error || !Array.isArray(data)) throw new Error('candidate lookup unavailable')
    const cohort = data.slice(0, 50)
    const draft = draftRequest.test(prompt.trim())
    const named = watchedInbound
      ? cohort.filter((r) => r.inbound_id === watchedInbound)
      : draft ? draftCases(previousScanQuestion ?? prompt, cohort) : namedCases(prompt, cohort)
    if (watchedInbound && named.length !== 1) return staleScanAlert
    if (draft && named.length !== 1) {
      return 'Which RISE prospect should the scan email be for? Include their full name or company and “scan email” so I can check the recipient and report.'
    }
    const group =
      /\b(who|anyone|anybody|any|which (?:prospects|customers|brands|leads|scans)|everyone|people|list|show (?:me )?(?:all|missing|outstanding)|outstanding scans|missing scans|pending scans)\b/i
        .test(prompt)
    if (!named.length && !group) {
      return 'I couldn’t match the person in that question among ' + scope + ' Delivery is unknown.'
    }
    const selected = (named.length ? named : cohort).sort((a, b) =>
      Number(!!a.email_report_at) - Number(!!b.email_report_at)
    )
    if (draft && !await draftStillCurrent(reader, selected[0])) return staleScanAlert
    const receiptMap = await readReceipts(
      selected,
      selected.length ? await reader.providerKey().catch(() => undefined) : undefined,
      request,
    )
    const cases = selected.map((r) => ({
      r,
      p: receiptMap.get(r.inbound_id) ?? { state: 'provider_unavailable' } as Receipt,
    }))
    const delivered = ({ p }: { p: Receipt }) =>
      p.state === 'exact_report_email' && ['delivered', 'opened', 'clicked'].includes(p.event ?? '')
    if (draft) {
      const { r, p } = cases[0]
      if (
        r.disposition || r.address_count !== 1 || !r.sender || !r.report_url || r.email_report_at ||
        p.state !== 'no_matching_email_in_connected_sender'
      ) {
        return describe(r, p) +
          ' I need a clear recipient, ready report and verified missing email before preparing another copy.'
      }
      // The owned publication URL is read without credentials. A withdrawn or
      // broken page should never be handed back as a ready-to-use draft.
      if (!/^https:\/\/resources[.]risedtc[.]com\/scan\/[a-zA-Z0-9_-]+$/.test(r.report_url)) {
        return 'I couldn’t verify the published RISE report URL. The draft needs a working report first.'
      }
      const live = await request(r.report_url + '/', {
        method: 'HEAD',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)
      if (!live?.ok || !live.headers.get('content-type')?.includes('text/html')) {
        return 'I couldn’t verify the public RISE scan page. The draft needs a working report first.'
      }
      if (!await draftStillCurrent(reader, r)) return staleScanAlert
      const first = safeName(r.person).split(/\s+/)[0]
      const brand = safeName(r.company ?? 'your store')
      return 'Private email draft for review.\n\nFrom: ' + mailbox(r.sender) + '\nTo: ' + r.address +
        '\nSubject: Your ' + brand + ' growth scan\n\nHey ' + first + ',\n\nHere’s the growth scan we discussed for ' +
        brand + ':\n' + r.report_url + '/\n\nHappy to go through it with you if you have questions.\n\nMattan' +
        '\n\n[Open RISE conversation](https://ivanmanfre.github.io/ivan-inbox/#exp/d/dms?thread=' +
        encodeURIComponent(r.prospect_id) + ')'
    }
    const due = cases.filter((c) => {
      if (c.r.disposition || delivered(c)) return false
      if (
        ['no_matching_email_in_connected_sender', 'email_found_without_exact_report', 'exact_report_email'].includes(
          c.p.state,
        )
      ) {
        return true
      }
      return !c.r.email_report_at &&
        (c.r.request_signal !== 'address_after_scan_offer' || !!c.r.linkedin_report_at || !c.r.email_at)
    }).sort((a, b) =>
      Number(b.p.state === 'no_matching_email_in_connected_sender') -
      Number(a.p.state === 'no_matching_email_in_connected_sender')
    )
    const visible = named.length ? cases : due
    const lines: string[] = []
    if (!named.length) {
      lines.push(
        visible.length
          ? 'These RISE requests need review.'
          : 'I found no clear missing scan email in the records I could check.',
      )
    }
    lines.push(...visible.slice(0, 10).map(({ r, p }) => describe(r, p)))
    if (visible.length > 10) lines.push('Showing 10 of ' + visible.length + ' matches.')
    if (!named.length) {
      const logged = cases.filter((c) => !delivered(c) && !c.r.disposition && !due.includes(c)).length
      const settled = cases.filter(delivered).length
      lines.push(
        'Checked ' + cohort.length + ' candidate requests. Confirmed by the provider: ' + settled +
          '. Other emails with unverified scan delivery: ' + logged + '.',
      )
    }
    lines.push('Scope: ' + scope + (data.length > 50 ? ' Only the newest 50 candidate records were checked.' : ''))
    return lines.join('\n\n')
  } catch {
    return 'I couldn’t read the RISE prospect and scan records. Email delivery is unknown.'
  }
}
