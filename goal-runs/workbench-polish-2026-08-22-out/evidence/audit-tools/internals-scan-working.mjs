// The hardened no-internals.mjs hangs with no output. This is a smaller,
// working substitute: walk the main workbench surfaces authed against a real
// build and scan RENDERED innerText (never the bundle) for internals leaking at
// the user. Read-only: write interceptor before every navigation.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = process.argv[2] || 'http://127.0.0.1:4187/'

// Jargon a stranger would have to be taught. Sourced from the blind panel's
// finding ("armed") plus this repo's own state vocabulary.
const JARGON = ['armed', 'arming', 'board_visible', 'skip_state', 'send_blocked', 'preferred_channel', 'icp_score']
const PATTERNS = [
  ['raw urn', /urn:li:[a-z]+:\d+/gi],
  ['bare uuid', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi],
  ['SCREAMING_SNAKE', /\b[A-Z][A-Z0-9]{2,}(_[A-Z0-9]+)+\b/g],
  ['snake_case column', /\b[a-z]+(_[a-z]+){1,}\b/g],
]
const SURFACES = [
  ['today', '#exp/v2/today'], ['dms', '#exp/v2/dms'], ['content', '#exp/v2/content'],
  ['magnets', '#exp/v2/magnets'], ['styles', '#exp/v2/styles'], ['strategy', '#exp/v2/strategy'],
  ['sends', '#exp/v2/sends'], ['ops', '#exp/v2/ops'], ['settings', '#exp/v2/settings'],
]
const browser = await chromium.launch()
let writes = 0
const hits = []
for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(([s, t]) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
    if (t === 'light') localStorage.setItem('inbox-theme', 'light'); else localStorage.removeItem('inbox-theme')
  }, [session, theme])
  const page = await ctx.newPage()
  await page.route('**/rest/v1/**', async r => {
    const q = r.request(), m = q.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
      writes++; return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  })
  for (const [name, hash] of SURFACES) {
    try {
      await page.goto(`${BASE}?nis=${Date.now()}${hash}`, { waitUntil: 'networkidle', timeout: 45000 })
      await page.waitForTimeout(3500)
      const txt = await page.evaluate(() => document.body.innerText || '')
      if (txt.length < 400) { hits.push({ surface: name, theme, kind: 'DID NOT RENDER', sample: `only ${txt.length} chars` }); continue }
      for (const [kind, re] of PATTERNS) {
        for (const m of txt.match(re) || []) hits.push({ surface: name, theme, kind, sample: m })
      }
      for (const j of JARGON) {
        const re = new RegExp(`\\b${j}\\b`, 'gi')
        for (const m of txt.match(re) || []) hits.push({ surface: name, theme, kind: 'operator jargon', sample: m })
      }
      process.stdout.write(`  walked ${name}/${theme} (${txt.length} chars)\n`)
    } catch (e) { hits.push({ surface: name, theme, kind: 'NAV FAIL', sample: String(e).slice(0, 90) }) }
  }
  await ctx.close()
}
await browser.close()
const byKind = {}
for (const h of hits) (byKind[h.kind] ||= []).push(h)
console.log('\n=== RESULT ===')
for (const [k, v] of Object.entries(byKind)) {
  const uniq = [...new Set(v.map(x => x.sample))]
  console.log(`${k}: ${v.length} hits, ${uniq.length} distinct -> ${uniq.slice(0, 12).join(', ')}`)
  console.log(`   surfaces: ${[...new Set(v.map(x => x.surface + '/' + x.theme))].slice(0, 8).join(', ')}`)
}
console.log(`\ntotal hits: ${hits.length} | attempted writes: ${writes}`)
