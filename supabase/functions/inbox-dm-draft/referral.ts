export type ReferralSource = { url: string; title: string }
export type ReferralDraft = {
  status: 'verified' | 'unresolved' | 'none'
  input_message_id: string
  name: string | null
  company: string | null
  role: string | null
  linkedin_url: string | null
  summary: string | null
  draft: string | null
  reason: string | null
  sources: ReferralSource[]
}

/** A cheap trigger only. The researcher must confirm a named human handoff. */
export function referralCandidate(text: string): boolean {
  // The object must be someone other than the two people in the thread: "happy to check out",
  // "happy to connect" and "talk to you soon" are acceptances, never handoffs.
  if (/\b(?:(?:speak|talk|reach out|connect|check)\s+(?:to|with)|contact)\s+(?!(?:me|us|you|him|her|them)\b)\S+/i.test(text)) return true
  const named = text.match(/\b([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){0,3})\s+(?:handles?|does|manages?|runs?|looks after|is responsible for|is in charge of)\b/iu)
  return Boolean(named && !/\b(?:i|we|you|he|she|they|it)\b/i.test(named[1]))
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const profileKey = (s: string): string | null => {
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' || !/^(?:[a-z]{2,3}\.)?linkedin\.com$/.test(u.hostname) && u.hostname !== 'www.linkedin.com') return null
    return /^\/in\/[^/]+\/?$/.test(u.pathname) ? u.pathname.replace(/\/$/, '').toLowerCase() : null
  } catch { return null }
}

/** Only a cited person profile at the referred company can carry a DM draft. */
export function verifyReferral(raw: unknown, cited: ReferralSource[], input: { id: string; text: string; company: string | null }): ReferralDraft {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const base: ReferralDraft = { status: r.status === 'none' ? 'none' : 'unresolved', input_message_id: input.id,
    name: null, company: input.company, role: null, linkedin_url: null, summary: null, draft: null,
    reason: typeof r.reason === 'string' ? r.reason.slice(0, 500) : 'The referred person could not be matched confidently to this company.', sources: [] }
  if (r.status !== 'verified') return base
  if (typeof r.name !== 'string' || typeof r.company !== 'string' || typeof r.linkedin_url !== 'string'
    || typeof r.draft !== 'string' || !r.draft.trim() || r.draft.length > 3000 || typeof r.summary !== 'string') return base
  if (/[—–!]|\bcurious if\b|\b(?:performance.only|no retainers?|only (?:get )?paid (?:on|when))\b/i.test(r.draft)) return { ...base, reason: 'The DM draft did not pass the copy rules. Retry research to draft again.' }
  const name = norm(r.name), text = norm(input.text), key = profileKey(r.linkedin_url)
  if (!name || !text.includes(name) || !input.company || norm(r.company) !== norm(input.company) || !key) return base
  const sources = cited.filter(s => { try { return new URL(s.url).protocol === 'https:' } catch { return false } })
  const company = norm(input.company)
  // Search metadata must connect the selected person profile to this company.
  // A separate company page plus a namesake's unrelated profile is insufficient.
  if (!sources.some(s => profileKey(s.url) === key && norm(s.title).includes(name) && norm(s.title).includes(company))) return base
  return { ...base, status: 'verified', name: r.name, company: r.company, role: typeof r.role === 'string' ? r.role : null,
    linkedin_url: r.linkedin_url, summary: r.summary, draft: r.draft.trim(), reason: null, sources: sources.slice(0, 6) }
}
