import type { MentionProfile } from './referral.ts'

type Db = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

// Read env through globalThis so the app's tsc (which reaches this file via tests) type-checks it too.
const env = (k: string) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k)

// Profile reads go through no-cookie Apify actors, never a LinkedIn seat (Ivan 07-26).
const SCRAPER = 'harvestapi~linkedin-profile-scraper'
const SEARCH = 'harvestapi~linkedin-profile-search'

type Item = { id?: string; publicIdentifier?: string; firstName?: string; lastName?: string; headline?: string
  experience?: { companyName?: string; position?: string; endDate?: { text?: string } | string | null }[] }

const toProfile = (p: Item): MentionProfile | null => !p?.id || !p.publicIdentifier || !p.firstName ? null : {
  provider_id: p.id, name: `${p.firstName} ${p.lastName ?? ''}`.trim(), headline: p.headline ?? null, public_identifier: p.publicIdentifier,
  experience: (p.experience ?? []).filter(e => typeof e.companyName === 'string').map(e => ({
    company: e.companyName!.trim(), position: e.position ?? null,
    current: !e.endDate || (typeof e.endDate === 'object' && /present/i.test(e.endDate.text ?? '')),
  })),
}

/** Resolve LinkedIn member ids, or search a name with its company. Capped at a few cents per call. */
export async function apifyProfiles(sb: Db, input: { ids: string[] } | { query: string }): Promise<MentionProfile[]> {
  const { data: cfg } = await sb.from('integration_config').select('value').eq('key', 'apify_api_token').maybeSingle()
  const token = cfg?.value || env('APIFY_TOKEN')
  if (!token) throw new Error('Profile lookup is not configured.')
  const [actor, body] = 'ids' in input
    ? [SCRAPER, { profileScraperMode: 'Profile details no email ($4 per 1k)', profileIds: input.ids.slice(0, 3) }]
    : [SEARCH, { profileScraperMode: 'Full', searchQuery: input.query, maxItems: 5 }]
  const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=90&maxTotalChargeUsd=0.10`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(100_000),
  })
  if (!r.ok) throw new Error(`Profile lookup unavailable (${r.status}).`)
  const items = await r.json()
  return Array.isArray(items) ? items.map(toProfile).filter((p): p is MentionProfile => p !== null) : []
}
