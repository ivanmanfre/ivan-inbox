import { sameCompany } from './referral.ts'

type Db = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

// A personal mailbox is never a work address for a referral.
const PERSONAL = /@(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|yandex|mail|zoho|hey|fastmail|web|qq|163)\./i

export type FoundEmail = { status: 'found'; email: string } | { status: 'none' | 'mismatch'; email?: undefined; reason: string }

const slug = (url: string | null | undefined) => (url ?? '').toLowerCase().match(/linkedin\.com\/in\/([^/?#]+)/)?.[1] ?? ''

/** The referred person's work email from Apollo people/match (1 credit), for the second lane when the handoff gives
 * no address (Ivan 2026-11-26: "it could find [their] email as well and approach on
 * both lanes"). Kept only when Apollo marks it verified, the match is the same LinkedIn profile, and Apollo's current
 * employer is the company the referral is about. Throws when Apollo is unreachable, so nothing is cached. */
export async function findWorkEmail(sb: Db, person: { name: string; company: string; linkedin_url: string }): Promise<FoundEmail> {
  const { data: cfg } = await sb.from('integration_config').select('value').eq('key', 'apollo_api_key').maybeSingle()
  if (!cfg?.value) throw new Error('Email lookup is not configured.')
  const [first, ...rest] = person.name.trim().split(/\s+/)
  const r = await fetch('https://api.apollo.io/api/v1/people/match', {
    method: 'POST', headers: { 'x-api-key': cfg.value, 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkedin_url: person.linkedin_url, first_name: first, last_name: rest.join(' ') || undefined,
      organization_name: person.company, reveal_personal_emails: false }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!r.ok) throw new Error(`Email lookup unavailable (${r.status}).`)
  return readMatch(await r.json(), person)
}

/** Pure check of an Apollo people/match answer (exported for tests). */
export function readMatch(body: unknown, person: { company: string; linkedin_url: string }): FoundEmail {
  const p = (body && typeof body === 'object' ? (body as { person?: unknown }).person : null) as {
    email?: string | null; email_status?: string | null; linkedin_url?: string | null
    organization?: { name?: string | null } | null; employment_history?: { organization_name?: string | null; current?: boolean | null }[] | null } | null
  if (!p) return { status: 'none', reason: 'Apollo has no match for this profile.' }
  if (!slug(p.linkedin_url) || slug(p.linkedin_url) !== slug(person.linkedin_url)) return { status: 'mismatch', reason: 'Apollo matched a different LinkedIn profile.' }
  const employers = [p.organization?.name, ...(p.employment_history ?? []).filter(e => e.current).map(e => e.organization_name)]
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
  if (!employers.some(n => sameCompany(n, person.company))) return { status: 'mismatch', reason: `Apollo lists a different current employer (${employers[0] ?? 'none'}).` }
  const email = (p.email ?? '').trim().toLowerCase()
  if (!email || email.startsWith('email_not_unlocked') || PERSONAL.test(email)) return { status: 'none', reason: 'Apollo has no work email for them.' }
  if (p.email_status !== 'verified') return { status: 'none', reason: `Apollo's email for them is not verified (${p.email_status ?? 'unknown'}).` }
  return { status: 'found', email }
}
