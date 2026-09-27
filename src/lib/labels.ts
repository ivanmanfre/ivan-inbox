// The one shared label map. A raw database value (an enum, a status code, a
// pipeline slug) should never reach JSX untouched. This file is the single
// place that turns one into words a human reads, so a new caller fixes the
// CLASS of leak rather than adding an eighth hand-rolled instance.
//
// Two entry points:
//   label(value)       - the whole field IS the value ('dm_sent', 'QA_BLOCKED').
//   inlineLabel(text)   - the value is EMBEDDED inside a free-text sentence a
//                         human or a scorer already wrote (icp_reasoning), so
//                         only the known raw tokens inside it are swapped;
//                         the surrounding prose is never touched.
//
// Pure and dependency-free on purpose: nothing here reaches Supabase, reads
// the DOM, or knows about React, so it stays trivial to unit test and safe to
// import from anywhere (a .tsx call site, a .ts formatter, another lib file).

// Reserved for a future caller that needs the same raw value to read
// differently in two places at once (a 'kind' meaning one thing in the DM
// register and another in the content register). No such collision exists in
// the eight values known today, so it is accepted and otherwise unused.
export type LabelKind = 'status' | 'kind' | 'reason' | 'stage'

// The known values, lower-cased. Lookup is case-insensitive so 'dm_sent' and
// 'Dm_sent' (the same column, two casings live in production) hit one entry.
const KNOWN: Record<string, string> = {
  dm_sent: 'DM sent',
  thread_already_answered: 'Already answered',
  lead_magnet: 'Lead magnet',
  youtube_watch: 'YouTube watch',
  qa_blocked: 'Blocked by QA',
  lint_fail: 'Failed the language check',
  gold_icp_v2_seatless: 'Gold ICP (v2)',
  // The QA gate's own verdict word. sentenceCase() alone would read "Needs
  // regenerate", grammatically off in a way the other five verdicts are not.
  needs_regenerate: 'Needs regeneration',
  // scheduled_posts' own status vocabulary (content.ts QUEUE_STATUSES). The
  // '_v2' is a migration artefact, not a fact worth printing at a reader.
  queued_v2: 'Queued',
  // agent_log.source: the automation platform's own name, not a word an
  // operator reading a log entry needs. It only ever distinguishes a live
  // pipeline step from a clickup_backfill reconstruction (isBackfillEntry).
  n8n: 'Automated',
  linkedin: 'LinkedIn',
}

// A value already written for a human: it carries a space and no underscore
// ('Not accepted yet', 'Sent'). Passed through untouched: running it through
// the fallback below would just lower-case and re-capitalise words that are
// already correct.
function isAlreadyHuman(value: string): boolean {
  return value.includes(' ') && !value.includes('_')
}

// The degrade path for a value this map has never seen. A raw token must
// never reach the screen bare: split on underscores AND colons (a race-hold
// reason arrives as 'post_approval_race:some_id'), sentence-case the words,
// keep the rest. 'some_new_enum_v3' -> 'Some new enum v3'.
function sentenceCase(value: string): string {
  const words = value.trim().split(/[_:\s]+/).filter(Boolean)
  if (words.length === 0) return value
  const joined = words.join(' ').toLowerCase()
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}

export function label(value: string | null | undefined, _kind?: LabelKind): string {
  if (value === null || value === undefined) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (isAlreadyHuman(trimmed)) return trimmed
  const known = KNOWN[trimmed.toLowerCase()]
  if (known) return known
  return sentenceCase(trimmed)
}

// The post-format vocabulary, kept DELIBERATELY out of KNOWN above. Two
// reasons. It is a closed set with its own established words (a single_image
// post is an "Image" everywhere in this app, not a "Single image"), and KNOWN
// feeds the inline replacer below, where a 'text' entry would rewrite the word
// "text" inside any sentence that happens to contain it.
//
// It lives here rather than in v2c/fmt.ts so the facet builder in src/lib can
// read it without a layer inversion; fmt.ts re-exports it, so every existing
// call site keeps working and there is exactly one map.
const TYPE_LABEL: Record<string, string> = { text: 'Text', single_image: 'Image', carousel: 'Carousel' }

export function typeLabel(t: string | null | undefined): string {
  if (!t) return 'Text'
  return TYPE_LABEL[t] ?? label(t)
}

// A regex alternation of the known raw tokens, longest first so
// 'gold_icp_v2_seatless' never partially matches a shorter neighbour that
// does not exist yet. Built once, module scope.
const KNOWN_KEYS = Object.keys(KNOWN).sort((a, b) => b.length - a.length)
const INLINE_RE = new RegExp(`\\b(${KNOWN_KEYS.join('|')})\\b`, 'gi')

// Swaps ONLY the known raw tokens found inside a larger, already-human
// sentence (icp_reasoning: "RISE warm engager (gold_icp_v2_seatless 66/78):
// ..."). Everything else in the string is the scorer's own prose and stays
// exactly as written: running the whole sentence through label()'s fallback
// would lower-case and re-join words that were never a database value.
export function inlineLabel(text: string | null | undefined): string {
  if (text === null || text === undefined) return ''
  if (!text) return text
  return text.replace(INLINE_RE, m => KNOWN[m.toLowerCase()] ?? m)
}

// ---------------------------------------------------------------------------
// THE ARMING VOCABULARY, and it is here rather than beside its state machine
// because it is the exact class of leak this file exists to stop.
//
// A blind design panel judged the month calendar against its own predecessor
// and named this as the screen's strongest tell that it is an internal tool:
//
//   "`Armed` is the operator's word for a state machine he wrote. No product
//    ships a top-line metric its user would have to be told the meaning of."
//
// `armed` is not a database value, which is why it never came through label()
// and never got caught: it is a word the app INVENTED for a derived state
// (armingOf() in calendarItems.ts, from a draft's status plus its source). A
// coined word is a raw value with extra steps, and it belongs to the same map.
//
// The plain words, and what each one is actually claiming:
//
//   armed    a publisher holds it. The draft is at Scheduled, or the chip IS a
//            publish-queue row. It goes out. -> "Scheduled", which is the word
//            the app's own Schedule button and its status already use, so the
//            reader is not asked to learn a second one.
//   planned  it carries a date and NOTHING publishes it. The distinction is
//            real and worth keeping (a review row with a date reads as coverage
//            it is not), so the plain form states the absence rather than
//            inventing a noun for it. -> "Not scheduled".
//   out      it went out. -> "Posted", which was already plain.
//
// Two forms, because the bar and the chip are different registers: the chip
// face carries a standalone word (sentence case), the bar carries a word after
// a numeral (lower case, and it may be a phrase).
const ARMING: Record<string, string> = {
  armed: 'Scheduled',
  planned: 'Not scheduled',
  out: 'Posted',
}

const ARMING_COUNT: Record<string, string> = {
  armed: 'scheduled',
  posted: 'posted',
  out: 'posted',
  // Said as the discrepancy it is, because that is the only reason this figure
  // is worth a slot in a bar above a grid already carrying 35 day numerals.
  planned: 'dated but not scheduled',
}

/** The standalone word for a derived arming state. Falls back to sentenceCase. */
export function armingLabel(value: string | null | undefined): string {
  if (!value) return ''
  return ARMING[value.toLowerCase()] ?? label(value)
}

/** The word that follows a numeral in a count. Lower case, may be a phrase. */
export function armingCountWord(value: string | null | undefined): string {
  if (!value) return ''
  return ARMING_COUNT[value.toLowerCase()] ?? label(value).toLowerCase()
}

/**
 * The seat badge on a conversation row, upper case. ONE definition, because the
 * two-seat version of this (`client_id === 'risedtc' ? 'RISE' : 'IVAN'`, written
 * when Ivan and Rise were the only lanes) survived in the DM history rows and
 * labelled every ARCH conversation as Ivan's — Davorin's own cold DMs read as
 * Ivan's on the seat Ivan opens first every morning (2026-09-01).
 *
 * Falls through to the id upper-cased, so a fourth seat is right on arrival
 * rather than silently inheriting whichever lane the ternary happened to name.
 */
export function clientBadge(id: string): string {
  // ELEVATION (2026-09-20): the same names in the app's sentence case; the
  // DMs filter chips above these pills already spell them this way.
  if (id === 'risedtc') return 'Rise'
  return id.charAt(0).toUpperCase() + id.slice(1).toLowerCase()
}

// The known campaign-lane values (outreach_prospects.enrichment_data->>'lane', read into
// inbox_messages_v by db/212), read live off the DB on 2026-09-24 across all three seats — NOT
// the same axis as clientBadge above, which names the SEAT (Ivan/Rise/Arch) rather than which
// campaign lane sent a given conversation. Plain words, kept short enough to sit in a Chip
// beside the seat pill without wrapping the row. A value not in this map still renders (via
// label()'s sentenceCase fallback) rather than vanishing, so a lane added later is never blank.
const LANE: Record<string, string> = {
  company_expansion: 'Company expansion',
  engager_warm: 'Engager',
  hiring_signal: 'Hiring signal',
  funding_signal: 'Funding',
  new_in_role: 'New in role',
  profile_view: 'Profile view',
  inbound: 'Inbound',
  israel_trip: 'Israel',
  cold_games: 'Cold (games)',
  cold_apps: 'Cold (apps)',
  warm_games: 'Warm (games)',
  warm_apps: 'Warm (apps)',
  sponsor_team: 'Sponsor team',
  sponsor_mined: 'Sponsor',
  soft_launch: 'Soft launch',
  orbit_pilot_fintech: 'Orbit pilot (fintech)',
  orbit_pilot_csaas: 'Orbit pilot (SaaS)',
  test_geo_ads: 'Geo ads test',
  hand_raise: 'Hand raise',
  skool_owner: 'Skool owner',
  adlib_twin_engager: 'Ad library engager',
  own_post_engager: 'Own post engager',
  podcast_guest: 'Podcast guest',
  ad_library_engager: 'Ad library engager',
  ad_velocity: 'Ad velocity',
}

/** The plain-word tag for a campaign lane. `''` for null/undefined, so a caller can gate the
    chip on truthiness without a separate null check. */
export function campaignLaneLabel(value: string | null | undefined): string {
  if (!value) return ''
  return LANE[value.toLowerCase()] ?? label(value)
}

// The coarse campaign lanes of lane_of() (db/056), same words as the Lanes screen (kpis.ts).
const CAMPAIGN_LANE: Record<string, string> = {
  cold: 'Cold', warm: 'Warm / Orbit', engager: 'Engager', harvest: 'Harvested', partner: 'Partners',
  signal: 'Quiet on LinkedIn',
}

/** Every lane word a DM row can show, for the `lane is …` filter token. */
export function laneLabelValues(): string[] {
  return [...new Set([...Object.values(CAMPAIGN_LANE), ...Object.values(LANE)])].sort()
}

/** The lane chip on a DM row: the person's own lane where the engine stored one (db/212, nearly every
    ARCH row), else the lane of their campaign (db/215). `''` when neither is known. */
export function threadLaneLabel(lane: string | null | undefined, campaignLane: string | null | undefined): string {
  if (lane) return campaignLaneLabel(lane)
  if (!campaignLane) return ''
  return CAMPAIGN_LANE[campaignLane] ?? label(campaignLane)
}

// The COPY ROUTE an ARCH conversation is on (inbox_messages_v.copy_route, db/213), next to the lane tag
// above. Ivan, 2026-09-24: "also the path they take in regarding to copy lane, like there are some going
// for apps, something games... but others also use the market narrowing or something or other strategies".
// The column reads '<sent|next>:<route>[:<invite note arm>]': `sent` is what the senders actually used
// (template key / ai_model / the ratified body's text), `next` is what the live selector will pick
// because nothing route-bearing has gone out yet. The chip says which, in words, so a prediction never
// reads as a fact. 'markets_question' is labelled but no sender emits it yet (no template exists).
const COPY_ROUTE: Record<string, string> = {
  eu_expansion: 'EU expansion',
  audit_offer: 'Audit offer',
  sponsor_door: 'Sponsor door',
  markets_question: 'Markets question',
  apps: 'Apps copy',
  games: 'Games copy',
  pc: 'PC copy',
  d2c: 'D2C copy',
  generic: 'Generic copy',
  custom: 'Custom',
  hold: 'Copy held',
}
const NOTE_ARM: Record<string, string> = {
  engager: 'engager note', games: 'games note', apps: 'apps note',
  sponsor: 'sponsor note', blank: 'blank', custom: 'custom note',
}

export type CopyRouteTag = { label: string; sent: boolean; title: string }

/** Every copy-route word, for the `route is …` filter token. Matches used AND next (the chip's
    "Next: " prefix is dropped), so one token finds everyone on a route. */
export function copyRouteValues(): string[] {
  return [...new Set(Object.values(COPY_ROUTE))].sort()
}
export function copyRouteName(value: string | null | undefined): string | null {
  const tag = copyRouteTag(value)
  return tag ? tag.label.replace(/^Next: /, '') : null
}

/** The chip for a thread's copy route, or null when the thread has none (every non-ARCH thread). */
export function copyRouteTag(value: string | null | undefined): CopyRouteTag | null {
  if (!value) return null
  const [state, route = '', note] = value.split(':')
  if (state !== 'sent' && state !== 'next') return null
  const name = COPY_ROUTE[route] ?? label(route)
  if (!name) return null
  const sent = state === 'sent'
  const invite = note ? ` Invite: ${NOTE_ARM[note] ?? label(note)}.` : ''
  if (route === 'hold') {
    return { label: name, sent, title: `No ratified copy for this person's vertical: the sender holds them.${invite}` }
  }
  return sent
    ? { label: name, sent, title: `Copy route used: ${name}.${invite}` }
    : { label: `Next: ${name}`, sent, title: `Nothing on a copy route has gone out yet. The sender's next pick: ${name}.${invite}` }
}
