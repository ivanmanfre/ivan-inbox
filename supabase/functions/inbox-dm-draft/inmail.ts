type Db = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

// Read env through globalThis so the app's tsc (which reaches this file via tests) type-checks it too.
const env = (k: string) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k)

/** The seat's Unipile account id, the one the sender must send the InMail from. */
export async function seatAccount(sb: Db, client: string): Promise<string | null> {
  try {
    const { data } = await sb.from('integration_config').select('value').eq('key', `${client}_unipile_account_id`).maybeSingle()
    return typeof data?.value === 'string' && data.value.trim() ? data.value.trim() : null
  } catch { return null }
}

/** Sales Navigator InMail credits left on the seat: one read of the account balance (no profile read, nothing sent).
 * Null when it cannot be read, which never counts as credits. */
export async function inmailCredits(sb: Db, client: string): Promise<number | null> {
  try {
    const account = await seatAccount(sb, client)
    const { data: cfg } = await sb.from('integration_config').select('value').eq('key', 'unipile_api_key').maybeSingle()
    const key = cfg?.value || env('UNIPILE_KEY')
    if (!account || !key) return null
    const base = `https://${env('UNIPILE_DSN') || 'api38.unipile.com:16836'}/api/v1`
    const r = await fetch(`${base}/linkedin/inmail_balance?account_id=${encodeURIComponent(account)}`, {
      method: 'GET', headers: { 'X-API-KEY': key, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
    if (!r.ok) return null
    const body = await r.json()
    return typeof body?.sales_navigator === 'number' && Number.isFinite(body.sales_navigator) ? body.sales_navigator : null
  } catch { return null }
}
