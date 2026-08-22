// The internals scan, pointed at the two surfaces this port added, with the
// same three patterns no-internals.mjs uses (raw urn, bare uuid, SCREAMING_
// SNAKE) plus the raw-column tooltip test. It FAILS CLOSED: if a surface does
// not open, or opens with less text than a rendered surface can plausibly
// carry, it exits non-zero and says which one rather than printing a pass.
//
// This exists because transcript rows are the most free-text material in the
// app: names, company names, extractor prose and agent-written JSON. The write
// interceptor is installed before the single navigation, same as the capture.
//
// Usage: node calls-noleak.mjs [baseUrl]

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = process.argv[2] || 'http://localhost:4319/'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')

const RE_URN = /urn:li:[a-z]+:\S+/gi
const RE_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const RE_SNAKE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g
const RE_COL_TOOLTIP = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+\s*[:\s]/

let writes = 0

function scan(text, surface) {
  const hits = []
  for (const m of text.matchAll(RE_URN)) hits.push({ surface, kind: 'raw-urn', match: m[0] })
  for (const m of text.matchAll(RE_UUID)) hits.push({ surface, kind: 'bare-uuid', match: m[0] })
  for (const m of text.matchAll(RE_SNAKE)) hits.push({ surface, kind: 'screaming-snake', match: m[0] })
  return hits
}

const SURFACES = [
  {
    id: 'today-calls-area',
    landmark: '#td-z-calls',
    minText: 300,
    async open(page) {
      const z = page.locator('#td-z-calls')
      if (await z.count() === 0) return false
      await z.scrollIntoViewIfNeeded()
      await page.waitForTimeout(400)
      return true
    },
    read: '#td-z-calls',
  },
  {
    id: 'call-reader-with-actions',
    landmark: '.cw .cw-ai',
    minText: 500,
    async open(page) {
      const zone = page.locator("#td-z-calls")
      if (await zone.count() === 0) return false
      await zone.scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)
      const rows = page.locator("#td-z-calls .td-qrow")
      if (await rows.count() === 0) return false
      await rows.first().scrollIntoViewIfNeeded()
      await rows.first().click()
      await page.waitForTimeout(900)
      return await page.locator('.cw .cw-ai').count() > 0
    },
    read: '.cw',
  },
  {
    id: 'call-reader-body-unfolded',
    landmark: '.cw-pre',
    minText: 800,
    async open(page) {
      const zone = page.locator("#td-z-calls")
      if (await zone.count() === 0) return false
      await zone.scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)
      const rows = page.locator("#td-z-calls .td-qrow")
      if (await rows.count() === 0) return false
      await rows.first().scrollIntoViewIfNeeded()
      await rows.first().click()
      await page.waitForTimeout(800)
      const fold = page.locator('.cw-fold .dw-sec-b')
      if (await fold.count() === 0) return false
      await fold.first().click()
      await page.waitForTimeout(2000)
      return await page.locator('.cw-pre').count() > 0
    },
    read: '.cw',
  },
  {
    id: 'call-reader-nothing-extracted',
    landmark: '.cw',
    minText: 300,
    async open(page) {
      const all = page.getByRole('button', { name: /^All calls/ })
      if (await all.count() === 0) return false
      await all.first().click()
      await page.waitForTimeout(400)
      const more = page.locator('#td-z-calls .td-more')
      if (await more.count() > 0) { await more.first().click(); await page.waitForTimeout(400) }
      const rows = page.locator('#td-z-calls .td-qrow')
      const n = await rows.count()
      if (n === 0) return false
      await rows.nth(n - 1).scrollIntoViewIfNeeded()
      await rows.nth(n - 1).click()
      await page.waitForTimeout(900)
      return await page.locator('.cw').count() > 0
    },
    read: '.cw',
  },
]

const VIEWPORTS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
const THEMES = ['dark', 'light']

const results = []
let failures = 0

const browser = await chromium.launch()
for (const s of SURFACES) {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } })
      await ctx.addInitScript(([x]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', x), [session])
      if (theme === 'light') await ctx.addInitScript(() => localStorage.setItem('inbox-theme', 'light'))
      const page = await ctx.newPage()
      const handler = async r => {
        const q = r.request(), m = q.method()
        if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
          writes++
          return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        }
        return r.continue()
      }
      await page.route('**/rest/v1/**', handler)
      await page.route('**/rest/v1/rpc/**', handler)

      await page.goto(`${BASE}#exp/v2/today`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)
      // Wait for the archive read to land rather than for a fixed number of
      // milliseconds. The section renders a loading line first, and racing it
      // produced a "did not open" that was the harness losing a race, not the
      // surface failing. This is the fail-closed rule applied to the harness
      // itself: it waits for the real landmark and only then decides.
      await page.locator('#td-z-calls .td-qrow').first()
        .waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})

      const key = `${s.id} ${vp.w}x${vp.h} ${theme}`
      let opened = false
      try { opened = await s.open(page) } catch { opened = false }
      if (!opened) {
        results.push({ key, status: 'FAILED_TO_OPEN', hits: [] })
        failures++
        console.log(`FAIL  ${key}  did not open`)
        await ctx.close()
        continue
      }
      const landmark = await page.locator(s.landmark).count()
      const text = await page.locator(s.read).first().innerText().catch(() => '')
      const titles = await page.locator(`${s.read} [title]`).evaluateAll(
        els => els.map(e => e.getAttribute('title')),
      ).catch(() => [])
      if (landmark === 0 || text.length < s.minText) {
        results.push({ key, status: 'EMPTY', landmark, chars: text.length, hits: [] })
        failures++
        console.log(`FAIL  ${key}  landmark=${landmark} chars=${text.length} < ${s.minText}`)
        await ctx.close()
        continue
      }
      const hits = scan(text, key)
      for (const t of titles) {
        if (t && !/^urn:li:/i.test(t) && RE_COL_TOOLTIP.test(t)) {
          hits.push({ surface: key, kind: 'raw-column-tooltip', match: t.slice(0, 80) })
        }
      }
      results.push({ key, status: hits.length ? 'HITS' : 'CLEAN', landmark, chars: text.length, hits })
      if (hits.length) failures++
      console.log(`${hits.length ? 'HITS' : 'OK  '}  ${key}  chars=${text.length}${hits.length ? `  ${hits.map(h => h.match).join(', ')}` : ''}`)
      await ctx.close()
    }
  }
}
await browser.close()

writeFileSync(join(__dirname, 'audit-tools', 'out-calls-noleak.json'), JSON.stringify({
  base: BASE, ranAt: new Date().toISOString(),
  surfacesWalked: results.length, failures, attemptedWrites: writes, results,
}, null, 2))

console.log(`\n${results.length} surface walks, ${failures} failures. Attempted writes: ${writes}.`)
process.exit(failures === 0 ? 0 : 1)
