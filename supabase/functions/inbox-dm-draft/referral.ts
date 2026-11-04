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
  acknowledgement?: string | null
  /** verified_at of the appended offer line; the cached draft expires with it (72 h). */
  offer_verified_at?: string | null
  revision?: number
  candidate?: { name: string; linkedin_url: string; summary: string | null; draft: string; sources: ReferralSource[] }
  lead_prospect_id?: string
}

/** A cheap trigger only. The researcher must confirm a named human handoff. */
export function referralCandidate(text: string): boolean {
  // The object must be someone other than the two people in the thread: "happy to check out",
  // "happy to connect" and "talk to you soon" are acceptances, never handoffs.
  const handoffs = text.matchAll(/\b(?:(?:speak(?:ing)?|talk(?:ing)?|reach(?:ing)? out|connect(?:ing)?|check(?:ing)?)\s+(?:to|with)|contact(?:ing)?)\s+((?!(?:me|us|you|him|her|them)\b)\S+)/gi)
  for (const handoff of handoffs) {
    // An email address is handled by the reply's email leg and supplies no named person to research.
    if (!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(handoff[1])) return true
  }
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

/** Lay out a referral first touch like a sent first DM: greeting alone, then one short thought per
 * paragraph with a blank line between them. An approved offer line is appended verbatim by code,
 * never paraphrased by the model. Returns null when nothing usable came back. */
export function formatReferralDm(raw: unknown, offer: string | null = null): string | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const parts: string[] = Array.isArray(r.paragraphs) ? r.paragraphs.filter((p): p is string => typeof p === 'string')
    : typeof r.draft === 'string' ? r.draft.split(/\n\s*\n/) : []
  const paras = parts.map(p => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)
  if (!paras.length) return null
  // "Hi Olena. Vadym said..." -> "Hi Olena" on its own line, the rest as the next paragraph.
  // The name must end at punctuation, a line break or the end, so "Hey O’Connor" or a combining
  // accent never splits mid-name; an unpunctuated run ("Hey Olena Vadym said") is left as written.
  const greet = paras[0].match(/^((?:hey|hi|hello)(?: there)?(?: [\p{L}\p{M}'’-]+)?)(?:\s*[,.:]\s*|\s*\n\s*|\s*$)([\s\S]*)$/iu)
  if (greet) paras.splice(0, 1, greet[1], ...(greet[2].trim() ? [greet[2].trim()] : []))
  // The offer appears exactly once, last: strip any copy the model wrote inside a paragraph.
  const body = offer ? paras.map(p => p.split(offer.trim()).join(' ').replace(/[ \t]+/g, ' ').trim()).filter(Boolean) : paras
  return [...body, ...(offer ? [offer.trim()] : [])].join('\n\n')
}

/** Prospect-facing copy rules every referral DM draft must pass. */
export const draftBreaksRules = (draft: string) => /[—–!]|\bcurious if\b|\b(?:performance.only|no retainers?|only (?:get )?paid (?:on|when))\b/i.test(draft)

export type MentionProfile = {
  provider_id: string
  name: string
  headline: string | null
  public_identifier: string
  experience: { company: string; position: string | null; current: boolean }[]
}
/** A LinkedIn @mention carries the tagged member's id, so it names one exact profile, not a search guess. */
export type Mention = { label: string; profile: MentionProfile }

const sameCompany = (a: string, b: string) => {
  const x = norm(a), y = norm(b)
  return Boolean(x && y && (x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `)))
}

/** Pick the mention the referral names. The label must appear in the message, match the extracted name,
 * and match the resolved profile's name. */
export function matchMention(mentions: Mention[], name: string, text: string): Mention | null {
  const want = norm(name)
  const hits = mentions.filter(m => {
    const label = norm(m.label)
    return Boolean(label && want && norm(text).includes(label) && (label === want || label.includes(want) || want.includes(label))
      && norm(m.profile.name) === label)
  })
  return hits.length === 1 ? hits[0] : null
}

/** Identity from a LinkedIn profile read. A current role at the referred company makes it verified;
 * otherwise it stays a candidate for the operator to check before contact. */
export function profileIdentity(p: MentionProfile, input: { id: string; company: string | null }, via: string): { identity: ReferralDraft; atCompany: boolean } {
  const url = `https://www.linkedin.com/in/${p.public_identifier}`
  const role = input.company ? p.experience.find(e => e.current && sameCompany(e.company, input.company!)) : undefined
  const current = p.experience.filter(e => e.current).map(e => `${e.position ?? 'Role'} at ${e.company}`).slice(0, 2).join('; ')
  const summary = role ? `${p.name} is ${role.position ? `${role.position} at` : 'at'} ${role.company} (current role on their LinkedIn profile).`
    : `${p.name}'s LinkedIn profile lists no current ${input.company ?? 'company'} role${current ? ` (current: ${current})` : ''}.`
  return { atCompany: Boolean(role), identity: {
    status: 'verified', input_message_id: input.id, name: p.name, company: input.company, role: role?.position ?? p.headline,
    linkedin_url: url, summary, draft: null, reason: null,
    sources: [{ url, title: `${p.name}${p.headline ? ` | ${p.headline}` : ''} | ${via}` }],
  } }
}

/** The tagged profile is the referred person, whatever the search index says. */
export const mentionIdentity = (m: Mention, input: { id: string; company: string | null }) =>
  profileIdentity(m.profile, input, 'LinkedIn profile tagged in the message')

/** Pick the one search result that is the named person with a current role at the company. A single
 * same-first-name profile at the company is only a candidate; namesakes elsewhere never match. */
export function pickSearchMatch(profiles: MentionProfile[], name: string, company: string): { profile: MentionProfile; exact: boolean } | null {
  const at = profiles.filter(p => p.experience.some(e => e.current && sameCompany(e.company, company)))
  const exact = at.filter(p => norm(p.name) === norm(name))
  if (exact.length === 1) return { profile: exact[0], exact: true }
  if (exact.length > 1) return null
  const first = norm(name).split(' ')[0]
  const near = at.filter(p => norm(p.name).split(' ')[0] === first)
  return near.length === 1 ? { profile: near[0], exact: false } : null
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
  if (draftBreaksRules(r.draft)) return { ...base, reason: 'The DM draft did not pass the copy rules. Retry research to draft again.' }
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
