import { describe, expect, it } from 'vitest'
import { buildPrompt, cardBody, cardTitle, emailMatch, htmlFacts, normDomain, parseVerdict, publicHost, type Evidence, type RequestRow } from './check'

const row: RequestRow = { id: '00000000-0000-4000-8000-000000000001', name: 'Ana', email: 'ana@brand.com', brand: 'brand.com',
  product_url: 'https://www.brand.com', page_url: null, sales_band: '1m_5m', urgency: 'this_month', qualifies: true }
const site = { resolves: true, status: 200, final_url: 'https://brand.com/', final_domain: 'brand.com', error: null, title: 'Brand',
  description: 'Socks', platform_hint: 'shopify', password_page: false, shopify_products: 40 }
const ev: Evidence = { store_domain: 'brand.com', site, email_domain: 'brand.com', email_match: 'matches_store',
  storeleads: { domain: 'brand.com', merchant_name: 'Brand', platform: 'shopify', plan: 'Shopify Plus', country_code: 'US',
    est_sales_yearly_usd: 2_400_000, product_count: 41, employee_count: 12, categories: null } }

describe('normDomain', () => {
  it('matches the outbound lanes', () => {
    expect(normDomain('https://www.Brand.com/products/x?y=1')).toBe('brand.com')
    expect(normDomain('not a url')).toBeNull()
  })
})

describe('emailMatch', () => {
  it('reads company, sibling-TLD, personal and different domains', () => {
    expect(emailMatch('a@brand.com', ['brand.com'])).toBe('matches_store')
    expect(emailMatch('a@team.brand.com', ['brand.com'])).toBe('matches_store')
    expect(emailMatch('a@brand.net', ['brand.com'])).toBe('same_name_other_domain')
    expect(emailMatch('a@brand.co.uk', ['shop.brand.com'])).toBe('same_name_other_domain')
    expect(emailMatch('a@gmail.com', ['brand.com'])).toBe('personal_email')
    expect(emailMatch('a@agency.io', ['brand.com'])).toBe('different_domain')
    expect(emailMatch('a@brand.com', [])).toBe('unknown')
  })
})

describe('htmlFacts', () => {
  it('reads title, description and the platform', () => {
    const f = htmlFacts('<html><title>Brand &amp; Co</title><meta name="description" content="Warm socks"><script src="//cdn.shopify.com/x.js"></script>')
    expect(f).toEqual({ title: 'Brand & Co', description: 'Warm socks', platform_hint: 'shopify' })
  })
})

describe('parseVerdict', () => {
  it('takes only a valid fit and a sentence', () => {
    expect(parseVerdict('```json\n{"fit":"yes","why":"Real store, matching email."}\n```')).toEqual({ fit: 'yes', why: 'Real store, matching email.' })
    expect(parseVerdict('{"fit":"no","why":"Store is dead — nothing sells."}')?.why).toBe('Store is dead, nothing sells.')
  })
  it('a refusal, empty or odd answer is unchecked, never a verdict', () => {
    expect(parseVerdict('I cannot help with that.')).toBeNull()
    expect(parseVerdict('')).toBeNull()
    expect(parseVerdict(null)).toBeNull()
    expect(parseVerdict('{"fit":"probably","why":"x"}')).toBeNull()
    expect(parseVerdict('{"fit":"yes","why":""}')).toBeNull()
    // Sol r1 #2: prose around a quoted example verdict is a refusal, never a verdict
    expect(parseVerdict('I cannot assess this request. An example response would be {"fit":"yes","why":"Real store."}')).toBeNull()
    expect(parseVerdict('Usage limit reached. {"fit":"no","why":"x"}')).toBeNull()
    expect(parseVerdict('Here you go:\n```json\n{"fit":"yes","why":"x"}\n```')).toBeNull()
  })
})

describe('prompt', () => {
  it('carries the rubric, the StoreLeads caveat and the evidence in one user turn', () => {
    const p = buildPrompt(row, ev)
    expect(p).toContain('misses Amazon, retail and wholesale')
    expect(p).toContain('Stated yearly online sales: $1M to $5M')
    expect(p).toContain('When they want it sorted: This month')
    expect(p).toContain('estimated online sales $2.4M a year')
    expect(p).toContain('"fit":"yes"|"maybe"|"no"')
  })
})

describe('card', () => {
  it('leads with the verdict and carries urgency and the facts', () => {
    const b = cardBody(row, ev, { fit: 'yes', why: 'Real Shopify Plus store, matching email.' }, 'checked')
    expect(b.split('\n')[0]).toBe('Fit: yes. Real Shopify Plus store, matching email.')
    expect(b).toContain('Urgency: This month')
    expect(b).toContain('StoreLeads estimate: $2.4M a year online')
    expect(b).toContain('brand.com opens; platform shopify (Shopify Plus), country US, 41 products')
    expect(b).toContain('Email: ana@brand.com (matches the store)')
    expect(b).not.toMatch(/[—–]/)
    expect(cardTitle(row, { fit: 'yes', why: 'x' }, 'checked')).toBe('SwishDM report request: Ana, brand.com ($1M to $5M, this month), fit yes')
  })
  it('an unchecked card says so and shows a dead store plainly', () => {
    const dead: Evidence = { ...ev, storeleads: null, site: { ...site, resolves: false, status: null, final_domain: null, error: 'the address does not exist', platform_hint: null, shopify_products: null } }
    const b = cardBody(row, dead, null, 'unchecked', 'model call timed out')
    expect(b.split('\n')[0]).toBe('Brand check: unchecked (model call timed out). Read the facts below.')
    expect(b).toContain('brand.com does not open (the address does not exist)')
    expect(b).toContain('StoreLeads estimate: no record')
  })
})

describe('publicHost', () => {
  it('fetches public names only', () => {
    expect(publicHost('mackweldon.com')).toBe(true)
    expect(publicHost('shop.brand.co.uk')).toBe(true)
    for (const h of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '[::1]', 'localhost', 'db.internal', 'x.local', 'a.test', 'nas.lan', ''])
      expect(publicHost(h)).toBe(false)
  })
})
