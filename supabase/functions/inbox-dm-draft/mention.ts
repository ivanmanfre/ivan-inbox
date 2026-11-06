import type { Mention } from './referral.ts'
import { apifyProfiles } from './apify.ts'

type Db = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Read the LinkedIn @mentions on one stored inbound message and resolve each tagged profile.
 * The seat reads only its own chat page (one GET, the same read the inbox sync makes); the tagged
 * profile itself is read through Apify. Any failure returns [] so research falls back to a name search. */
export async function readMentions(sb: Db, messageId: string): Promise<Mention[]> {
  try {
    const { data: msg } = await sb.from('outreach_messages').select('unipile_message_id,unipile_chat_id').eq('id', messageId).maybeSingle()
    if (!msg?.unipile_message_id || !msg?.unipile_chat_id) return []
    const { data: cfg } = await sb.from('integration_config').select('value').eq('key', 'unipile_api_key').maybeSingle()
    const key = cfg?.value || Deno.env.get('UNIPILE_KEY')
    if (!key) return []
    const base = `https://${Deno.env.get('UNIPILE_DSN') || 'api38.unipile.com:16836'}/api/v1`
    const r = await fetch(`${base}/chats/${encodeURIComponent(msg.unipile_chat_id)}/messages?limit=50`, {
      method: 'GET', headers: { 'X-API-KEY': key, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
    if (!r.ok) return []
    const list = await r.json()
    const item = (list?.items ?? []).find((m: { id?: string }) => m.id === msg.unipile_message_id)
    const tagged = Object.entries((item?.mentions ?? {}) as Record<string, unknown>)
      .filter((e): e is [string, string] => typeof e[1] === 'string' && /^[A-Za-z0-9_-]{10,}$/.test(e[1])).slice(0, 3)
    if (!tagged.length) return []
    const profiles = await apifyProfiles(sb, { ids: tagged.map(([, id]) => id) })
    return tagged.flatMap(([label, id]) => {
      const profile = profiles.find(p => p.provider_id === id)
      return profile ? [{ label: label.replace(/^@/, '').trim(), profile }] : []
    })
  } catch { return [] }
}
