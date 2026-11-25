import { describe, expect, it, vi } from 'vitest'
import { answerScanEmail, asksAboutScanEmail, containsReport, readReceipts, type ScanCase } from './scan-email'

const item: ScanCase = {
  inbound_id: 'req1',
  prospect_id: 'p1',
  person: 'Test Person',
  company: 'Test Shop',
  asked_at: '2026-11-06T10:00:00Z',
  address: 'person@example.test',
  address_count: 1,
  sender: 'Registered Sender <sender@example.test>',
  disposition: null,
  request_signal: 'asks_to_email_details',
  report_url: 'https://resources.risedtc.com/scan/test-shop',
  email_at: null,
  email_report_at: null,
  linkedin_report_at: null,
}
const mail = {
  id: 'm1',
  from: 'sender@example.test',
  to: ['PERSON@example.test'],
  created_at: '2026-11-12T10:00:00Z',
  last_event: 'delivered',
}
function provider(rows = [mail], text = item.report_url!, detail = mail) {
  return vi.fn(async (uri: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method).toBe('GET')
    return String(uri).includes('?')
      ? Response.json({ data: rows, has_more: false })
      : Response.json({ ...detail, text })
  })
}
describe('main assistant RISE scan evidence', () => {
  it('reads on scan-delivery turns and leaves content and other seats alone', () => {
    for (const q of ['Who is still owed a scan by email?', 'Did Marzia get the scan?', 'Show missing RISE scans']) {
      expect(asksAboutScanEmail(q)).toBe(true)
    }
    for (
      const q of [
        'What should I post?',
        'Who have I emailed?',
        'Did SwishDM send the scan?',
        'Draft a post on missed scans',
      ]
    ) expect(asksAboutScanEmail(q)).toBe(false)
  })
  it('pins exact report paths and rejects links embedded inside other URLs', () => {
    for (const body of [item.report_url + '/', '<a href="' + item.report_url + '/?ref=email">scan</a>']) {
      expect(containsReport(body, item.report_url!)).toBe(true)
    }
    for (
      const body of [
        item.report_url + 's',
        item.report_url + '/other',
        'https://example.test/?target=' + item.report_url,
      ]
    ) expect(containsReport(body, item.report_url!)).toBe(false)
  })
  it('requires sender, recipient and date before inspecting any provider message', async () => {
    const read = provider([{ ...mail, from: 'other@example.test' }, { ...mail, to: ['other@example.test'] }, {
      ...mail,
      created_at: '2026-10-01T10:00:00Z',
    }])
    expect((await readReceipts([item], 'fixture', read)).get(item.inbound_id)?.state).toBe(
      'no_matching_email_in_connected_sender',
    )
    expect(read).toHaveBeenCalledTimes(1)
  })
  it('distinguishes exact delivered, exact bounced and a different report', async () => {
    for (const event of ['delivered', 'bounced']) {
      const detail = { ...mail, last_event: event }
      expect((await readReceipts([item], 'fixture', provider([mail], item.report_url!, detail))).get(item.inbound_id))
        .toEqual({
          state: 'exact_report_email',
          email_id: mail.id,
          event,
          at: mail.created_at,
        })
    }
    expect((await readReceipts([item], 'fixture', provider([mail], item.report_url + 's'))).get(item.inbound_id)?.state)
      .toBe('email_found_without_exact_report')
  })
  it('distinguishes an unrelated introduction, ambiguous destination and an unavailable account', async () => {
    const r = await readReceipts(
      [{ ...item, report_url: null }, { ...item, inbound_id: 'multiple', address_count: 2 }],
      'fixture',
      provider(),
    )
    expect(r.get(item.inbound_id)?.state).toBe('email_found_report_identity_unknown')
    expect(r.get('multiple')?.state).toBe('sender_or_destination_unknown')
    const offline = await readReceipts([item], 'fixture', async () => new Response('', { status: 503 }))
    expect(offline.get(item.inbound_id)?.state).toBe('provider_unavailable')
  })
  it('reports partial history and failed body retrieval as incomplete', async () => {
    const page = async () => Response.json({ data: [{ ...mail, to: [] }], has_more: true })
    expect((await readReceipts([item], 'fixture', page)).get(item.inbound_id)?.state).toBe('provider_check_incomplete')
    const broken = async (url: RequestInfo | URL) =>
      String(url).includes('?') ? Response.json({ data: [mail], has_more: false }) : new Response('', { status: 403 })
    expect((await readReceipts([item], 'fixture', broken)).get(item.inbound_id)?.state).toBe(
      'provider_check_incomplete',
    )
  })
  it('fetches only named case details, includes source time and keeps other contact data out of the prompt', async () => {
    const second = {
      ...item,
      person: 'Elsewhere',
      company: 'Another brand',
      inbound_id: 'req2',
      address: 'private@other.test',
    }
    const context = await answerScanEmail('Did Test Shop get its scan?', {
      cases: async () => ({ data: [item, second], error: null }),
      providerKey: async () => 'fixture',
    }, provider())
    expect(context).toContain('12 Nov')
    expect(context).toContain('Resend confirms')
    expect(context).not.toContain(second.address)
    expect(context).not.toContain('fixture')
  })
  it('prepares only a private named draft for an unfulfilled request with a working approved report', async () => {
    const reader = { cases: async () => ({ data: [item], error: null }), providerKey: async () => 'fixture' }
    const read = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        expect(String(url)).toBe(item.report_url + '/')
        expect(init.headers).toBeUndefined()
        return new Response(null, { headers: { 'content-type': 'text/html' } })
      }
      expect(init?.method).toBe('GET')
      return Response.json({ data: [], has_more: false })
    })
    expect(asksAboutScanEmail('Draft the scan email for Test Person')).toBe(true)
    expect(asksAboutScanEmail('Draft and send the scan email for Test Person')).toBe(false)
    const draft = await answerScanEmail('Draft the email', reader, read, 'Did Test Person get the scan?')
    expect(draft).toContain('Private email draft for review')
    expect(draft).toContain('To: ' + item.address)
    expect(draft).toContain(item.report_url)
    expect(await answerScanEmail('Draft a scan email for Test Person', reader, provider())).not.toContain(
      'Private email draft for review',
    )
    expect(await answerScanEmail('Draft the email', reader, read, 'Who is still owed a scan?')).toContain(
      'Which RISE prospect',
    )
  })
  it('binds a reply to the watched inbound and checks the current case before preparing the draft', async () => {
    const other = { ...item, inbound_id: 'another', address: 'other@example.test' }
    const reader = { cases: async () => ({ data: [item, other], error: null }), providerKey: async () => 'fixture' }
    const read = async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response(null, { headers: { 'content-type': 'text/html' } })
        : Response.json({ data: [], has_more: false })
    const result = await answerScanEmail('Draft the email', reader, read, undefined, item.inbound_id)
    expect(result).toContain('Private email draft')
    expect(result).not.toContain(other.address)
    const closed = { ...reader, cases: async () => ({ data: [{ ...item, disposition: 'solved' }], error: null }) }
    expect(await answerScanEmail('Draft the email', closed, read, undefined, item.inbound_id)).not.toContain(
      'Private email draft',
    )
  })
})
