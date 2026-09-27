// The lines the coordinator assigned to the DMs thread (COVERAGE, coordinator rows):
//   LANES #4  Arch hiring: "Hiring opener" with the date it went out (old threads got dm1_h_*).
//   LANES #6  Arch sponsor: the ladder stops after DM1, so the thread says so.
//   LANES #3  Arch company expansion: which invite arm the person got (vertical note vs blank).
//   LANES #10 Rise company expansion: the company stops once a colleague replied.
// Pure, from fields the thread already carries; never a guess where a field is missing.
import { eventTime, type Thread } from '../../lib/inbox'
import { seatOf } from '../seats'
import { warsawDm, warsawDow } from '../ui/time'

const day = (iso: string) => `${warsawDow(iso)} ${warsawDm(iso)}`

/** The route line under the chips, or null when nothing needs saying. */
export function routeLine(t: Thread): string | null {
  if (seatOf(t.client_id) !== 'arch') return null
  const hiring = t.messages.find(m => m.direction === 'outbound' && m.sent_at && /dm1_h_/.test(m.ai_model ?? ''))
  if (hiring?.sent_at) return `Hiring opener, sent ${day(hiring.sent_at)}`
  const sponsor = t.lane === 'sponsor_team' || t.lane === 'sponsor_mined'
  const dmSent = t.messages.some(m => m.direction === 'outbound' && m.sent_at
    && m.message_type !== 'connection_note' && m.channel !== 'email')
  if (sponsor && dmSent) return 'No follow-up planned: sponsor lane stops after the first message'
  return null
}

const ARM_WORD: Record<string, string> = { games: 'games', apps: 'apps', engager: 'engager', sponsor: 'sponsor', custom: 'custom' }

/** Arch company expansion: which invite note arm this person got. `vertical` from enrichment_data. */
export function inviteArmLine(t: Pick<Thread, 'client_id' | 'lane' | 'copyRoute'>, vertical: string | null): string | null {
  if (seatOf(t.client_id) !== 'arch' || t.lane !== 'company_expansion') return null
  const arm = (t.copyRoute ?? '').split(':')[2] ?? ''
  const v = vertical?.trim() || 'this vertical'
  if (arm === 'blank') return `Blank invite: no approved note for ${v}`
  if (arm && ARM_WORD[arm]) return `Why this note: company expansion, ${ARM_WORD[arm]} note`
  return null
}

/** Rise company expansion: a colleague at the same company already replied, so the brand stops. */
export function companyStopLine(t: Thread, all: readonly Thread[]): string | null {
  if (seatOf(t.client_id) !== 'risedtc' || t.lane !== 'company_expansion') return null
  const co = (t.prospect_company ?? '').trim().toLowerCase()
  if (!co) return null
  let best: { name: string; at: string } | null = null
  for (const o of all) {
    if (o.prospect_id === t.prospect_id || seatOf(o.client_id) !== 'risedtc') continue
    if ((o.prospect_company ?? '').trim().toLowerCase() !== co) continue
    const reply = o.messages.filter(m => m.direction === 'inbound').at(-1)
    if (!reply) continue
    const at = eventTime(reply)
    if (!best || at > best.at) best = { name: o.prospect_name, at }
  }
  return best ? `Company stopped: ${best.name} replied on ${day(best.at)}` : null
}
