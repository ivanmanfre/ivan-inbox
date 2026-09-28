/* What each lane actually is, in plain words (Ivan 09-28: "add explainatories of
   all lanes on hover so i know in detail"). Shown as the hover title on desktop
   and one tap away on the phone, on the lanes bars and the rate charts.
   Arch keys are the per-person lane (enrichment_data.lane); Ivan and Rise run
   one campaign per lane, so those are keyed by campaign name (shortName form,
   lower-cased). Sources: arch-targeting-playbook.md, outreach_campaigns
   descriptions, read 2026-09-28. A key with no entry gets no explanation. */
import type { Seat } from '../seats'
import { shortName } from '../../lib/campaignPerf'

const ARCH: Record<string, string> = {
  engager_warm: 'People who liked or commented on posts by creators and competitors in the games and apps influencer space, scored for fit. Score 5+ goes straight to the queue without Davorin\'s review. Invite note: "I saw you around {creator}\'s posts." The lane that replies best.',
  company_expansion: 'Colleagues of a lead who already qualified (ICP 7+, judged eligible), whatever lane found that first lead. We pull their teammates in buying roles (UA, growth, performance marketing) and each one goes through the research judge again. Invite note by vertical: games note, apps note, D2C blank (A/B test).',
  hiring_signal: 'Companies with open job posts for UA, growth or influencer marketing roles; we invite people on those teams. The weekly harvest was switched off 09-01, what still goes out are rows already scored. DM1 uses the hiring variant.',
  cold_games: 'Blind LinkedIn title search: UA, growth and marketing people at game studios, with no sign they are buying right now. The weakest lane, capped at 34% of daily invites.',
  cold_apps: 'Blind LinkedIn title search: UA, growth and marketing people at consumer apps, with no sign they are buying right now. Capped with cold games at 34% of daily invites.',
  new_in_role: 'People who started a UA, growth or marketing role at a fitting company in the last 3 months. Congrats-style DM, modelled on Davorin\'s own ("congrats on the new position... room for a collab?").',
  soft_launch: 'Studios soft-launching a game in test markets, found by the Tuesday hiring harvest. Plain DM1.',
  israel_trip: 'One-off list of Israeli games and apps people for Davorin\'s October Tel Aviv trip, with a meet-for-coffee line.',
  sponsor_team: 'Brands from Davorin\'s own list of companies that already pay creators for sponsorships. Copy splits on whether an EU push makes sense for the brand (EU-scale pitch) or not (US booking pitch).',
  sponsor_mined: 'Brands we found sponsoring YouTube creators, mined from the videos themselves. Same EU vs US copy split as Sponsor team.',
  orbit_pilot_fintech: 'Pilot that mined fintech companies around ARCH\'s clients. Killed on pass rate; the few sends here are leftovers.',
  orbit_pilot_csaas: 'Pilot that mined consumer SaaS companies around ARCH\'s clients. Killed on pass rate; the few sends here are leftovers.',
  funding_signal: 'Companies that just raised money, found in consumer trade press. Killed as a weekly lane (too few fits per dollar), now run by hand only.',
  hand_raise: 'People who posted asking for influencer agency or creator recommendations. Killed as a lane, kept as a cheap watch: about 1-2 fits a month.',
  profile_view: 'People who viewed Davorin\'s LinkedIn profile and fit the ICP.',
  profile_view_warm: 'People who viewed Davorin\'s LinkedIn profile and fit the ICP.',
  inbound: 'People who reached Davorin first (connection request or DM). ICP-judged; buyers get a qualifier DM drafted for approval.',
  none: 'No lane was stamped on these people, usually older or hand-added rows.',
}

const IVAN: Record<string, string> = {
  'warm - engagement harvest': 'People who liked or commented on posts by creators in your space (Kenny Damian, Nadia Privalikhina, Luke Shalom and others), scored against your ICP. Invite note: "saw you around {creator}\'s content."',
  'warm - kyle engagers': 'People who engage with Kyle Hunt\'s posts, scored against your ICP.',
  "warm - creators' lead-magnet commenters": 'People who commented on another creator\'s lead-magnet giveaway ("comment X and I\'ll DM you the template") where that creator\'s audience is your ICP, e.g. Paolo Trivellato. Competitors are filtered out.',
  'agency owners & ops leaders': 'Cold list: fractional COOs and CFOs, agency coaches and consultants who serve agencies. Referral-partner angle.',
  'agency-focused consultants & fractionals': 'Cold list: solo and small (1-10 people) consultants serving agencies: fractional execs, agency coaches, OBMs, ops consultants.',
  'cold v2 — marketing service firms 7-60 (owner-led)': 'Cold list: owners of firms selling marketing or growth services (creator, Shopify/Klaviyo, paid social, branding, fractional GTM, outbound), 7-60 staff, US/UK/CA/AU.',
  'cold v2b — boutique consultancies 10-100 (founder-led)': 'Cold list: founders of boutique consultancies and strategy or ops advisory firms, 10-100 staff, US/UK/CA/AU/IE/NZ.',
  'poland — agencies (cold)': 'Cold list: Polish marketing agency owners who posted recently, found with a Polish-language search.',
  'quiet on linkedin — active on x': 'People who post weekly on X but have not posted on LinkedIn in 90+ days.',
  'quiet on linkedin — podcast guests': 'People who were a podcast guest in the last 90 days but have been silent on LinkedIn for 90+ days.',
  'quiet on linkedin — stopped posting': 'People who posted 10+ times on LinkedIn before and have been silent for 4-12 months.',
  'profile view — ivan': 'People who viewed your LinkedIn profile and fit the ICP.',
  'inbound request — ivan': 'People who sent you a connection request. ICP-judged, auto-accepted (capped), qualifier DM drafted for approval.',
  'cold — influencer agencies (arch model)': 'Cold list: founders of high-ticket influencer marketing agencies, the ARCH model.',
}

const RISE: Record<string, string> = {
  'competitor engagers': 'People who liked or commented on posts by 11 DTC creators and competitors whose audiences are at least 15% founders, then scored as DTC decision-makers.',
  'fractional cmo partners': 'Independent fractional CMOs working inside small and mid DTC brands, who choose the brand\'s outside vendors. Partner angle, found by LinkedIn profile search.',
  'company expansion': 'Other execs at brands we invited since 09-09 that never replied. Note: "sent {colleague} a note a while ago, figured I\'d say hi to you too." One week between people at the same brand; any reply or booking at the brand stops the rest.',
  "client orbit (clients' networks)": 'DTC founders from the networks and post engagers of Mattan\'s active clients, pitched with "we run growth for {client}".',
  'profile view': 'People who viewed Mattan\'s LinkedIn profile and fit the ICP.',
  'inbound request': 'People who sent Mattan a connection request. ICP-judged, auto-accepted (capped), qualifier DM drafted for approval.',
  'warm (his engagers)': 'People who like or comment on Mattan\'s own posts.',
}

// The send monitor's coarse source lanes (rates.ts SOURCE), any seat.
const SOURCE: Record<string, string> = {
  cold: 'Cold lists: people found by title or company search, no sign they are buying right now.',
  warm_engager: 'People who engaged with posts by creators in the space, scored for fit.',
  competitor_engager: 'People who engaged with competitors\' posts, scored for fit.',
  client_orbit: 'People from the networks of the seat\'s own clients.',
  partner: 'Partner lane: people who pick vendors for brands (fractional CMOs).',
  profile_view: 'People who viewed the seat\'s LinkedIn profile and fit the ICP.',
  inbound: 'People who reached the seat first (connection request or DM).',
  unclassified: 'Sends with no lane recorded.',
}

const BY_SEAT: Record<Seat, Record<string, string>> = { arch: ARCH, ivan: IVAN, risedtc: RISE }

const norm = (s: string) => shortName(s).toLowerCase()

/** The plain explanation for a lane key or campaign name on a seat, or null when we have none. */
export function laneInfo(seat: Seat, key: string | null | undefined): string | null {
  if (!key) return null
  const own = BY_SEAT[seat]
  return own[key] ?? own[norm(key)] ?? SOURCE[key] ?? null
}

/** Campaign display names that say what the lane is. Rise's company expansion reads like its Arch twin. */
export function campaignDisplay(name: string): string {
  const s = shortName(name)
  return s.toLowerCase() === 'company expansion' ? 'Colleagues of our leads' : s
}
