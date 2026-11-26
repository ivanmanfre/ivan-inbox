export type ReferralSource = { url: string; title: string }
export type ReferralDraft = {
  status: 'verified' | 'unresolved' | 'none'
  input_message_id: string
  name: string | null
  company: string | null
  role: string | null
  linkedin_url: string | null
  /** The LinkedIn member id of the profile that verified this person when the handoff was researched (a tagged mention,
   * an exact search match or the profile the referrer supplied). Set only there; redrafts keep it and never replace it.
   * Create stages only for this member (Sol r4). */
  member_id?: string | null
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
  /** First email to the referred person when the handoff gives their address (Éléa G. -> Gambit, 2026-11-05).
   * Staged by the operator as an unapproved draft; the normal Send owns approval. */
  email?: ReferralEmail | null
  /** Why no email draft exists although the handoff gave an address. */
  email_reason?: string | null
  /** The Apollo work-email lookup for this profile (stored so the same person never costs a second credit). */
  email_lookup?: { linkedin_url: string; checked_at: string; source: 'apollo'; status: 'found' | 'none' | 'mismatch'; email?: string; reason?: string } | null
  /** The operator chose not to contact this person. The card stays closed and nothing is redrafted. */
  dismissed_at?: string | null
  /** What the referrer wrote after the handoff, read by the model (never a keyword list). */
  later?: ReferralLater | null
  /** Newer handoff-like replies already researched without finding anyone new; the open referral stood. */
  passed_over?: string[]
  /** The conversation the DM was drafted from (later replies and discarded drafts); a change redrafts it. */
  story_key?: string
  lead_message_id?: string
  /** The free calendar day the invite note asks for (Ivan 2026-11-26). */
  slot?: { start: string; label: string; day: string } | null
  /** ARCH: the first touch as an InMail (subject + the fuller intro) when one can go (Ivan 2026-11-26). */
  inmail?: ReferralInmail | null
  /** Whether that InMail can go, read when it was drafted; Create reads it again. */
  inmail_route?: InmailRoute | null
}
export type ReferralInmail = { subject: string; body: string; slot?: { start: string; label: string; day: string } }
/** An InMail goes when the seat has Sales Navigator credits or the person's profile is open (free, no cap). */
export type InmailRoute = { channel: 'inmail' | 'connection_note'; credits: number | null; open_profile: boolean | null; why: string; checked_at: string }
/** The reviewed person's first name still appears on the profile the URL shows now. */
// Sol r8/r9: only these are dropped before the names are compared: a title before the given name, a credential after
// the family name. Generational suffixes (Jr, Sr, II, III) name a different person and stay in the comparison. Short
// surnames such as Ma or Ba are real names, so they are not on the list.
const NAME_TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'prof'])
const NAME_CREDENTIALS = new Set(['mba', 'phd', 'md', 'cpa', 'cfa', 'pmp', 'esq', 'msc'])

/** Sol r7/r8: the profile shows the person the handoff names. A full name must equal LinkedIn's given names followed
 * by its family names, word for word, once titles and suffixes are dropped. So "Tomas Weller" + "Rivera", "Tomas
 * Lopez Rivera" for Tomas Garcia Rivera, and an extra middle name all fail. A first name alone must be the first
 * given name. */
export function profileShowsPerson(named: string | null | undefined, p: { first_name: string; last_name: string }): boolean {
  const tokens = (x: string) => x.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const want = tokens(named ?? ''), given = tokens(p.first_name).filter(t => !NAME_TITLES.has(t)), family = tokens(p.last_name)
  for (const list of [want, family]) while (list.length && NAME_CREDENTIALS.has(list.at(-1)!)) list.pop()
  if (!want.length || !given.length) return false
  if (want.length === 1) return given[0] === want[0]
  // A full name needs a family name on the profile (Sol r9): the whole name in the given-name field proves nothing.
  if (!family.length) return false
  return want.join(' ') === [...given, ...family].join(' ')
}

export function sameFirstName(reviewed: string | null | undefined, shown: string): boolean {
  const tokens = (x: string) => x.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const first = tokens(reviewed ?? '')[0]
  return !first || tokens(shown).includes(first)
}

/** The sender's limits for a referral InMail (Send Messages REFERRAL_INMAIL lanes). */
export const INMAIL_SUBJECT_LIMIT = 60
export const INMAIL_BODY_LIMIT = 1900
/** How the row stores it, the shape the sender parses: "Subject: ...", a blank line, then the body. */
export const inmailText = (subject: string, body: string) => `Subject: ${subject.replace(/\s+/g, ' ').trim()}\n\n${body.trim()}`
/** Why an InMail (as edited) cannot be staged, or null. Same copy rules as the note, and no links. */
export function inmailProblem(subject: string, body: string): string | null {
  const s = subject.replace(/\s+/g, ' ').trim(), b = body.trim()
  if (!s || s.length > INMAIL_SUBJECT_LIMIT) return `The InMail subject must be 1 to ${INMAIL_SUBJECT_LIMIT} characters.`
  if (!b || b.length > INMAIL_BODY_LIMIT) return `The InMail fits ${INMAIL_BODY_LIMIT} characters. This one has ${b.length}.`
  if (draftBreaksRules(`${s}\n${b}`)) return 'The InMail breaks the copy rules (no dashes, no "!", no performance-only claims).'
  if (/https?:\/\/|\bwww\./i.test(`${s}\n${b}`)) return 'The InMail carries no links.'
  return null
}
/** Credits or an open profile let the InMail go; otherwise the invite note goes. Unknown credits are not credits. */
export function inmailRoute(credits: number | null, openProfile: boolean | null, owner: string, now = new Date()): InmailRoute {
  const base = { credits, open_profile: openProfile, checked_at: now.toISOString() }
  if (openProfile === true) return { ...base, channel: 'inmail', why: 'Their profile is open, so the InMail is free.' }
  if (typeof credits === 'number' && credits > 0) return { ...base, channel: 'inmail', why: `${owner}'s seat has ${credits} Sales Navigator InMail credits.` }
  return { ...base, channel: 'connection_note', why: credits === 0 ? `${owner}'s seat has no InMail credits left and their profile is not open.`
    : `${owner}'s InMail credits could not be read and their profile is not known to be open.` }
}
export type ReferralEmail = { to: string; cc: string[]; subject: string; body: string
  /** The handoff gave no address; Apollo found their verified work email (Ivan 2026-11-26: both lanes on a referral). */
  found_by?: 'apollo'
  /** The one free calendar time the email asks about (checked when drafted). */
  slot?: { start: string; label: string; day?: string } }
/** go = thanks, "you too", an emoji or anything that leaves the handoff standing. hold = wait, hold off, do not
 * contact them, they left. redirect = talk to someone else instead. */
export type ReferralLater = { through_message_id: string; verdict: 'go' | 'hold' | 'redirect'; quote: string | null; checked_at: string
  /** Every inbound id after the handoff that the check read (a reply imported late with an earlier time changes it). */
  message_ids?: string[]
  /** The email recipients the check covered (To|Cc), when the referral has an email. */
  envelope?: string | null }

/** One spelling of an email envelope for comparison (same as inbox_referral_envelope() in SQL). */
export const emailEnvelope = (to: string, cc: readonly string[] = []) =>
  `${to.trim().toLowerCase()}|${cc.map(c => c.trim().toLowerCase()).filter(Boolean).sort().join(',')}`

/** LinkedIn's limit for an invitation note. The first touch to a referred person goes out as an invite. */
export const INVITE_NOTE_LIMIT = 300

/** A verified referral the operator has not acted on: no referred lead yet and not dismissed. Later replies
 * (a "You too!", a reaction) never close it (Ivan 2026-11-20: 4 of 6 verified handoffs were hidden that way). */
export function openReferral(cached: unknown): cached is ReferralDraft {
  const r = cached && typeof cached === 'object' ? cached as Partial<ReferralDraft> : null
  return Boolean(r && r.status === 'verified' && typeof r.input_message_id === 'string' && typeof r.linkedin_url === 'string'
    && !r.lead_prospect_id && !r.dismissed_at)
}

export type ReferralMessage = { id: string; direction: string; message_text?: string | null; sent_at?: string | null; created_at: string }
const when = (m: ReferralMessage) => m.sent_at || m.created_at
/** Message time, then import order: the same latest-message rule the app, the handler and the cron use. */
export function byTime<T extends ReferralMessage>(rows: readonly T[]): T[] {
  return rows.map((m, i) => ({ m, i })).sort((a, b) => when(a.m).localeCompare(when(b.m)) || a.m.created_at.localeCompare(b.m.created_at) || a.i - b.i).map(x => x.m)
}

/** Which inbound the referral card is about.
 * 1. The newest inbound when it reads like a handoff (as before).
 * 2. Else the cached verified referral that is still open, whatever came after it.
 * 3. Else the newest handoff-like inbound in the unanswered turn ("Talk to X" followed by "thanks!"). */
export function referralTarget<T extends ReferralMessage>(messages: readonly T[], cached: unknown, dismissedIds: readonly string[] = []): { inbound: T; anchored: boolean } | null {
  const ordered = byTime(messages)
  const inbound = ordered.filter(m => m.direction === 'inbound' && m.message_text?.trim())
  const latest = inbound.at(-1)
  if (!latest) return null
  // An email-only referral (no LinkedIn profile, an address to write to) stays open the same way.
  const c = cached && typeof cached === 'object' ? cached as ReferralDraft : null
  const emailOnly = Boolean(c && c.email && typeof c.email === 'object' && !c.lead_prospect_id && !c.dismissed_at)
  const anchor = (openReferral(cached) || emailOnly) ? inbound.find(m => m.id === c!.input_message_id) : undefined
  const passed = anchor && Array.isArray((cached as ReferralDraft).passed_over) && (cached as ReferralDraft).passed_over!.includes(latest.id)
  // A handoff the operator dismissed stays closed, even while it is still the newest message.
  const dismissed = (m: T) => dismissedIds.includes(m.id) || Boolean(cached && typeof cached === 'object' && (cached as ReferralDraft).dismissed_at && (cached as ReferralDraft).input_message_id === m.id)
  if (referralCandidate(latest.message_text!) && !passed && !dismissed(latest)) return { inbound: latest, anchored: latest.id === anchor?.id }
  if (anchor) return { inbound: anchor, anchored: true }
  const lastSent = ordered.filter(m => m.direction === 'outbound' && m.sent_at).at(-1)
  const turn = inbound.filter(m => !lastSent || when(m) > when(lastSent))
  const hit = [...turn].reverse().find(m => referralCandidate(m.message_text!) && !dismissed(m))
  return hit ? { inbound: hit, anchored: false } : null
}

/** Inbound messages written after the handoff, oldest first. */
export function laterInbound<T extends ReferralMessage>(messages: readonly T[], referralId: string): T[] {
  const ordered = byTime(messages)
  const i = ordered.findIndex(m => m.id === referralId)
  return i < 0 ? [] : ordered.slice(i + 1).filter(m => m.direction === 'inbound' && m.message_text?.trim())
}

/** The stored check read exactly these replies. The handoff itself is read too ("hold off until January, then talk
 * to Tomas"), so a check is needed even when nothing came after it. */
export function laterChecked(r: Pick<ReferralDraft, 'later'>, later: readonly ReferralMessage[], envelope?: string | null): boolean {
  const ids = r.later?.message_ids
  return Array.isArray(ids) && ids.length === later.length && later.every(m => ids.includes(m.id))
    && (envelope === undefined || (r.later?.envelope ?? null) === envelope)
}

/** What the drafter read after the handoff: every reply, every message we sent, and the operator's discarded drafts. */
export function storyKey(after: readonly ReferralMessage[], discarded: readonly { id: string }[]): string {
  return [...after.map(m => `${m.direction === 'inbound' ? 'i' : 'o'}${m.id}:${(m.message_text ?? '').length}`), ...discarded.map(m => `x${m.id}`)].sort().join(',')
}

/** Inbound replies and sent messages after the handoff (the conversation the draft must still fit). */
export function storyAfter<T extends ReferralMessage>(messages: readonly T[], referralId: string): T[] {
  const ordered = byTime(messages)
  const i = ordered.findIndex(m => m.id === referralId)
  return i < 0 ? [] : ordered.slice(i + 1).filter(m => m.message_text?.trim() && (m.direction === 'inbound' || m.sent_at))
}

/** Read the model's answer about the later messages. A hold or redirect must quote words the referrer wrote;
 * an unreadable answer fails toward pausing, never toward contact. */
export function readLaterVerdict(raw: unknown, later: readonly ReferralMessage[], handoff = ''): Pick<ReferralLater, 'verdict' | 'quote'> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const flatten = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const said = [handoff, ...later.map(m => m.message_text ?? '')].map(flatten).join('\n')
  const quote = typeof r.quote === 'string' && r.quote.trim() && said.includes(flatten(r.quote)) ? r.quote.trim().slice(0, 300) : null
  if (r.verdict === 'go') return { verdict: 'go', quote: null }
  const newest = (later.at(-1)?.message_text ?? handoff).trim().slice(0, 300)
  if (r.verdict === 'hold' || r.verdict === 'redirect') return { verdict: r.verdict, quote: quote ?? newest }
  return { verdict: 'hold', quote: newest }
}

/** A cheap trigger only. The researcher must confirm a named human handoff. */
export function referralCandidate(text: string): boolean {
  if (linkedProfiles(text).length) return true
  // The object must be someone other than the two people in the thread: "happy to check out",
  // "happy to connect" and "talk to you soon" are acceptances, never handoffs.
  const handoffs = text.matchAll(/\b(?:(?:speak(?:ing)?|talk(?:ing)?|reach(?:ing)? out|connect(?:ing)?|check(?:ing)?)\s+(?:to|with)|contact(?:ing)?)\s+((?!(?:me|us|you|him|her|them)\b)\S+)/gi)
  for (const handoff of handoffs) {
    // An email address is handled by the reply's email leg and supplies no named person to research.
    if (!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(handoff[1])) return true
  }
  // A name may be followed by a title in apposition before the ownership verb.
  const withoutTitle = text.replace(/,\s*(?:our|my|the|their)\s+[\p{L}][\p{L}\p{M} &’'-]{0,80},/giu, ' ')
  // A question such as "interesting and does it cost anything?" has no named owner.
  // Split at the auxiliary verb so a real handoff in another clause still matches.
  const clauses = withoutTitle.replace(/\b(?:(?:(?:and|but|how much|when|where|why|what|how)\s+does)|does\s+(?:it|this|that)\s+(?:cost|work|include|require|mean|take|cover|apply))\b/gi, '.')
  const owners = clauses.matchAll(/\b([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){0,3})\s+(?:handles?|does|manages?|runs?|looks after|is responsible for|is in charge of)\b/giu)
  return Array.from(owners).some(owner => !/\b(?:i|we|you|he|she|they|it)\b/i.test(owner[1]))
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const profileKey = (s: string): string | null => {
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' || !/^(?:[a-z]{2,3}\.)?linkedin\.com$/.test(u.hostname) && u.hostname !== 'www.linkedin.com') return null
    return /^\/in\/[^/]+\/?$/.test(u.pathname) ? u.pathname.replace(/\/$/, '').toLowerCase() : null
  } catch { return null }
}

const WEB_LINK = /https?:\/\/[^\s<>()[\]"']+/gi

function canonicalLinkedProfile(raw: string): string | null {
  const link = raw.replace(/[.,;:!?]+$/, '')
  if (!/^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\//i.test(link)) return null
  try {
    const path = new URL(link).pathname.match(/^\/in\/([^/]+)\/?$/)
    if (!path) return null
    const slug = decodeURIComponent(path[1])
    if (!/^[\p{L}\p{N}_-]+$/u.test(slug)) return null
    return 'https://www.linkedin.com/in/' + encodeURIComponent(slug)
  } catch { return null }
}

export function linkedProfiles(text: string): string[] {
  return [...new Set((text.match(WEB_LINK) ?? []).map(canonicalLinkedProfile).filter(url => url !== null))]
}

export function linkedReferralProfile(links: string[], supplied: unknown, referrerUrl?: string | null): string | null {
  if (typeof supplied !== 'string') return null
  const link = canonicalLinkedProfile(supplied)
  if (!link || !links.includes(link)) return null
  const sender = referrerUrl ? canonicalLinkedProfile(referrerUrl) : null
  return link.toLowerCase() === sender?.toLowerCase() ? null : link
}

export const withoutLinks = (text: string) => text.replace(WEB_LINK, ' ')

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

export const sameCompany = (a: string, b: string) => {
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
    linkedin_url: url, member_id: p.provider_id, summary, draft: null, reason: null,
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
