import { describe, expect, it, vi } from 'vitest'
import { observeScanEmails } from './watch'
import type { ScanCase } from '../inbox-claude/scan-email'

const ethan: ScanCase = {
  inbound_id: 'e',
  prospect_id: 'ep',
  person: 'Ethan',
  company: 'Eco',
  asked_at: '2026-11-13T00:54:47Z',
  address: 'e@example.test',
  address_count: 1,
  sender: 'm@example.test',
  request_signal: 'address_after_acceptance_phrase',
  disposition: null,
  report_url: 'https://resources.risedtc.com/scan/eco',
  email_at: null,
  email_report_at: null,
  linkedin_report_at: '2026-11-13T09:10:20Z',
}
const now = new Date('2026-11-25T10:10:00Z')
describe('daily RISE scan watch', () => {
  it('observes the mismatch and stays quiet for logged email, unclearly requested material, dispositions, grace and incomplete data', async () => {
    const items = [
      ethan,
      { ...ethan, inbound_id: 'm', email_report_at: now.toISOString() },
      { ...ethan, inbound_id: 'c', email_at: now.toISOString(), request_signal: 'asks_to_email_team' },
      { ...ethan, inbound_id: 'u', request_signal: 'address_after_scan_offer' },
      { ...ethan, inbound_id: 'd', disposition: 'solved' },
      { ...ethan, inbound_id: 'h', asked_at: now.toISOString() },
      { ...ethan, inbound_id: 'n', report_url: null },
    ]
    const read = vi.fn(async () => Response.json({ data: [], has_more: false }))
    expect((await observeScanEmails(items, async () => 'fixture', now, read)).map((i) => i.decision))
      .toEqual([
        'missing_email',
        'correct_email_logged',
        'existing_email_review',
        'unclear_promise',
        'operator_disposition',
        'within_first_day',
        'no_verified_linkedin_report',
      ])
    expect(read).toHaveBeenCalledTimes(1)
    expect((await observeScanEmails([ethan], async () => undefined, now, read))[0].decision).toBe(
      'provider_unavailable',
    )
  })
  it('keeps an unrelated or unverified provider email quiet and never calls the provider for an empty cohort', async () => {
    const row = {
      id: 'id',
      from: ethan.sender,
      to: [ethan.address],
      created_at: now.toISOString(),
      last_event: 'delivered',
      text: 'intro only',
    }
    const read = vi.fn(async (url: RequestInfo | URL) =>
      Response.json(String(url).includes('?') ? { data: [row], has_more: false } : row)
    )
    expect((await observeScanEmails([ethan], async () => 'fixture', now, read))[0].decision).toBe(
      'email_found_without_exact_report',
    )
    const noKey = vi.fn()
    expect(await observeScanEmails([], noKey, now, read)).toEqual([])
    expect(noKey).toHaveBeenCalledTimes(0)
  })
})
