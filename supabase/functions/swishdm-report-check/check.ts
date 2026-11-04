// check.ts: the pure parts of the SwishDM report request brand check (no network, no Deno).
// index.ts gathers the evidence and calls these; the tests drive them directly.
//
// What the check is for (Ivan 2026-11-05): people with no money book the free AI search report.
// Every request gets the facts we can see for free (does the store open, StoreLeads size, platform,
// country, product count, does the email match the store) and one reasoned read from Claude on
// whether this is worth a report. It only helps Ivan decide. Nothing is sent to the requester.

export const BANDS: Record<string, string> = {
  under_500k: 'Under $500k', '500k_1m': '$500k to $1M', '1m_5m': '$1M to $5M', '5m_plus': '$5M+',
}
export const URGENCY: Record<string, string> = {
  this_month: 'This month', next_3_months: 'In the next 3 months', just_curious: 'Just curious',
}
export type Fit = 'yes' | 'maybe' | 'no'

export interface RequestRow {
  id: string; name: string; email: string; brand: string; product_url: string; page_url: string | null
  sales_band: string | null; urgency: string | null; qualifies: boolean | null; created_at?: string
}
export interface SiteFacts {
  resolves: boolean; status: number | null; final_url: string | null; final_domain: string | null
  error: string | null; title: string | null; description: string | null
  platform_hint: string | null; password_page: boolean; shopify_products: number | null
}
export interface StoreLeadsFacts {
  domain: string; merchant_name: string | null; platform: string | null; plan: string | null
  country_code: string | null; est_sales_yearly_usd: number | null; product_count: number | null
  employee_count: number | null; categories: unknown
}
export interface Evidence {
  store_domain: string | null; site: SiteFacts; storeleads: StoreLeadsFacts | null
  email_domain: string | null
  email_match: 'matches_store' | 'same_name_other_domain' | 'different_domain' | 'personal_email' | 'unknown'
}
export interface Verdict { fit: Fit; why: string }

/** Same shape as the outbound lanes' normDomain (claude-code-railway runner/lanes/swishdm-harvest/lib.mjs). */
export function normDomain(d: unknown): string | null {
  let s = String(d ?? '').trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0].replace(/^www\d?\./, '')
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null
}

// Webmail hosts: a fact about the address (it is not a company inbox), never a verdict on its own.
const PERSONAL_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk',
  'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'gmx.de', 'web.de', 'yandex.com', 'mail.com', 'zoho.com', 'fastmail.com', 'hey.com'])

/** The part of a domain a brand owns: "shop.brand.co.uk" -> "brand". */
function stem(domain: string): string {
  const parts = domain.split('.')
  const two = parts.slice(-2).join('.')
  const sld = /^(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(two) && parts.length >= 3
  return sld ? parts[parts.length - 3] : parts[parts.length - 2] ?? domain
}

export function emailMatch(email: string, storeDomains: (string | null)[]): Evidence['email_match'] {
  const ed = normDomain(String(email).split('@')[1] ?? '')
  if (!ed) return 'unknown'
  if (PERSONAL_MAIL.has(ed)) return 'personal_email'
  const doms = storeDomains.filter((d): d is string => !!d)
  if (!doms.length) return 'unknown'
  // Same domain or a subdomain of it is a match. The same name on another ending (brand.net vs brand.com) can be
  // a different owner, so it is reported as its own weaker fact (Sol r1 #9).
  if (doms.some(d => d === ed || d.endsWith('.' + ed) || ed.endsWith('.' + d))) return 'matches_store'
  return doms.some(d => stem(d) === stem(ed) && stem(d).length >= 4) ? 'same_name_other_domain' : 'different_domain'
}

/** A host we may fetch: a public-looking DNS name, never an IP literal or a private/special name (Sol r1 #3). */
export function publicHost(host: string | null | undefined): boolean {
  const h = String(host ?? '').toLowerCase().replace(/\.$/, '')
  if (!h || h.includes(':') || /^[0-9.]+$/.test(h)) return false
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return false
  const tld = h.split('.').pop() ?? ''
  if (!/^[a-z]{2,}$/.test(tld) && !/^xn--[a-z0-9-]+$/.test(tld)) return false
  return !/(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|example|invalid|onion|arpa)$/.test(h)
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const clip = (s: string | null | undefined, n: number) => !s ? null : s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s

/** Facts read straight off the homepage HTML. Detection only; nothing here decides fit. */
export function htmlFacts(html: string): Pick<SiteFacts, 'title' | 'description' | 'platform_hint'> {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]*>/i)?.[0].match(/content=["']([^"']*)["']/i)?.[1]
    ?? html.match(/<meta[^>]+property=["']og:description["'][^>]*>/i)?.[0].match(/content=["']([^"']*)["']/i)?.[1]
  const h = html.slice(0, 400_000)
  const platform_hint = /cdn\.shopify\.com|Shopify\.shop\s*=|shopify-section/i.test(h) ? 'shopify'
    : /woocommerce/i.test(h) ? 'woocommerce'
    : /bigcommerce/i.test(h) ? 'bigcommerce'
    : /static\.wixstatic\.com|wix\.com/i.test(h) ? 'wix'
    : /squarespace/i.test(h) ? 'squarespace'
    : /Magento|mage\/cookies/i.test(h) ? 'magento'
    : /salesforce-commerce|demandware/i.test(h) ? 'salesforce commerce' : null
  return { title: clip(title ? decode(title) : null, 160), description: clip(desc ? decode(desc) : null, 300), platform_hint }
}

const usd = (n: number | null | undefined) => n == null ? null
  : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`

/** The rubric and the evidence, all in the user turn (the Railway proxy refuses a `system` field). */
export function buildPrompt(r: RequestRow, ev: Evidence): string {
  const sl = ev.storeleads
  const site = ev.site
  const lines = [
    `Stated yearly online sales: ${BANDS[r.sales_band ?? ''] ?? 'not given'}`,
    `When they want it sorted: ${URGENCY[r.urgency ?? ''] ?? 'not given'}`,
    `Store they gave: ${r.product_url}`,
    `Store homepage: ${site.resolves ? `opens (HTTP ${site.status}${site.final_domain && site.final_domain !== ev.store_domain ? `, redirects to ${site.final_domain}` : ''}${site.password_page ? ', shows a password page, so the store is not open to shoppers' : ''})` : `does not open (${site.error ?? `HTTP ${site.status ?? '?'}`})`}`,
    `Homepage title: ${site.title ?? 'none read'}`,
    `Homepage description: ${site.description ?? 'none read'}`,
    `Platform seen on the homepage: ${site.platform_hint ?? 'unknown'}`,
    site.shopify_products != null ? `Products listed on the store: ${site.shopify_products >= 250 ? '250 or more' : site.shopify_products}` : null,
    sl ? `StoreLeads record: ${sl.merchant_name ?? sl.domain}, ${sl.platform ?? 'platform unknown'}${sl.plan ? ` (${sl.plan})` : ''}, country ${sl.country_code ?? 'unknown'}, estimated online sales ${usd(sl.est_sales_yearly_usd) ?? 'unknown'} a year, ${sl.product_count ?? '?'} products, ${sl.employee_count ?? '?'} staff`
      : 'StoreLeads record: none for this domain (StoreLeads does not list every store)',
    `Email: ${ev.email_domain ?? '?'} (${ev.email_match.replace(/_/g, ' ')})`,
    r.page_url ? `Product page they care about: ${r.page_url}` : null,
  ].filter(Boolean)
  return `You are helping Ivan decide whether a free report request is worth his time.

SwishDM shows consumer brands how AI assistants (ChatGPT, Gemini) answer shopper questions about their products, and fixes their product pages so the brand gets named. The free AI search report is built by hand for brands doing $1M or more a year online, because those are the brands that can pay for the work after. People with no real business keep requesting it. Your job is to read the evidence below and say whether this request looks like a real brand with the money to act.

How to read the evidence:
- The stated sales band is what they told us. Treat it as a claim, check it against everything else.
- StoreLeads only sees the brand's own online store. It misses Amazon, retail and wholesale sales, and its estimate can be far off. A low StoreLeads number alone is never a reason to say no when the rest fits. A missing StoreLeads record is normal for many real stores.
- A store that does not open, a password page, a page that is not a store at all, or a store that sells something other than consumer products are strong signs against.
- A company email that matches the store supports the request. A personal email or a different domain is a weak sign on its own, since many founders use personal email.
- "Just curious" means low urgency. It lowers priority, it is not a reason to say no alone.
- Judge the whole picture by meaning. If the evidence is thin or mixed, say maybe.

Answer yes when it looks like a real consumer brand that plausibly has $1M+ a year in sales and a reason to act. Answer no when the evidence points to no real store, no real sales, or not a consumer brand. Answer maybe when you cannot tell.

The request:
${lines.join('\n')}

Reply with only a JSON object, no other text: {"fit":"yes"|"maybe"|"no","why":"one plain sentence, under 30 words, naming the evidence that decided it"}`
}

/**
 * The model's answer, or null when it is not a usable verdict (null = unchecked, never a guess).
 * The WHOLE answer must be the JSON object, optionally inside one complete code fence: a refusal or a limit
 * notice that quotes an example verdict is prose around JSON and is rejected (Sol r1 #2).
 */
export function parseVerdict(text: string | null | undefined): Verdict | null {
  if (!text || !text.trim()) return null
  const t = text.trim()
  const raw = t.match(/^```(?:json)?\s*(\{[\s\S]*\})\s*```$/i)?.[1] ?? (/^\{[\s\S]*\}$/.test(t) ? t : null)
  if (!raw) return null
  let o: unknown
  try { o = JSON.parse(raw) } catch { return null }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const { fit, why } = o as Record<string, unknown>
  if (fit !== 'yes' && fit !== 'maybe' && fit !== 'no') return null
  if (typeof why !== 'string' || !why.trim()) return null
  const w = why.replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim()
  return { fit, why: w.length > 300 ? w.slice(0, 299).trimEnd() + '…' : w }
}

const FIT_LINE: Record<Fit, string> = { yes: 'Fit: yes', maybe: 'Fit: maybe', no: 'Fit: no' }

/** The card after the check. The first line is what the feed tile shows, so it carries the verdict. */
export function cardBody(r: RequestRow, ev: Evidence | null, v: Verdict | null, state: 'checked' | 'unchecked', note?: string): string {
  const sl = ev?.storeleads ?? null
  const site = ev?.site ?? null
  const head = v ? `${FIT_LINE[v.fit]}. ${v.why}` : `Brand check: unchecked${note ? ` (${note})` : ''}. Read the facts below.`
  const store = !site ? 'not checked'
    : site.resolves
      ? `${ev?.store_domain ?? r.product_url} opens${site.final_domain && site.final_domain !== ev?.store_domain ? ` (goes to ${site.final_domain})` : ''}${site.password_page ? ', password page (not open to shoppers)' : ''}`
      : `${ev?.store_domain ?? r.product_url} does not open (${site.error ?? `HTTP ${site.status ?? '?'}`})`
  const platform = sl?.platform ?? site?.platform_hint ?? null
  const products = sl?.product_count ?? site?.shopify_products ?? null
  const facts = [platform && `platform ${platform}${sl?.plan && sl.plan.toLowerCase() !== platform ? ` (${sl.plan})` : ''}`,
    sl?.country_code && `country ${sl.country_code}`,
    products != null && `${products >= 250 && sl?.product_count == null ? '250+' : products} products`].filter(Boolean).join(', ')
  const emailNote: Record<Evidence['email_match'], string> = {
    matches_store: 'matches the store', same_name_other_domain: 'same name as the store on another domain ending',
    different_domain: 'different domain from the store',
    personal_email: 'personal email', unknown: 'not checked',
  }
  const lines = [
    head,
    `Urgency: ${URGENCY[r.urgency ?? ''] ?? 'not given'}`,
    `Yearly online sales (they said): ${BANDS[r.sales_band ?? ''] ?? r.sales_band ?? '?'}`,
    `StoreLeads estimate: ${sl ? `${usd(sl.est_sales_yearly_usd) ?? 'unknown'} a year online` : 'no record'} (sees only their own store, misses Amazon, retail and wholesale)`,
    `Store: ${store}${facts ? `; ${facts}` : ''}`,
    `Email: ${r.email} (${ev ? emailNote[ev.email_match] : 'not checked'})`,
    `Name: ${r.name}`,
    `Product page: ${r.page_url ?? 'not given'}`,
    '',
    state === 'checked' ? 'Nothing was sent to them. You decide.' : 'Nothing was sent to them. The check retries on its own.',
    `Request: select * from swishdm_lm_requests where id = '${r.id}'`,
  ]
  return lines.join('\n').slice(0, 3900)
}

export function cardTitle(r: RequestRow, v: Verdict | null, state: 'checked' | 'unchecked'): string {
  const urg = URGENCY[r.urgency ?? '']
  const tail = v ? `fit ${v.fit}` : state === 'unchecked' ? 'unchecked' : 'checking'
  const t = `SwishDM report request: ${r.name}, ${r.brand} (${BANDS[r.sales_band ?? ''] ?? '?'}${urg ? `, ${urg.toLowerCase()}` : ''}), ${tail}`
  return t.length > 200 ? t.slice(0, 199) + '…' : t
}
