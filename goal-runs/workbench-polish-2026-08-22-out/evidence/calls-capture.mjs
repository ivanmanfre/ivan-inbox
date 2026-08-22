// Port #2 capture: the Calls area on Today, and the call reader open.
//
// Same instrument as evidence/capture.mjs: same auth injection (the live
// Supabase session from .session.json into localStorage key
// sb-bjbvqvzbzczjbatgmccb-auth-token), and the SAME write interceptor
// installed on **/rest/v1/** AND **/rest/v1/rpc/** BEFORE every navigation.
// It fulfils PATCH / PUT / DELETE and non-/rpc/ POST locally with 200 [] so no
// row can be mutated, counts every one, and prints the total. The reader is a
// read-only surface, so the expected count is 0 and a non-zero total is a bug
// report about this branch rather than a capture artefact.
//
// Served on port 4319 on purpose: 4173 belongs to three sibling agents.
//
// Usage: node calls-capture.mjs [baseUrl] [outDir]

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = process.argv[2] || 'http://localhost:4319/'
const OUT = process.argv[3] ? join(__dirname, process.argv[3]) : join(__dirname, '..', 'after')
mkdirSync(OUT, { recursive: true })

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')

let writes = 0
const writeLog = []
let rpcCount = 0

async function installInterceptor(page) {
  // Both patterns, explicitly, even though the first is a superset: the brief
  // names them separately and a route that is written down is a route that can
  // be checked.
  const handler = async r => {
    const q = r.request(), m = q.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
      writes++
      writeLog.push(`${m} ${q.url()}`)
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    if (m === 'POST') rpcCount++
    return r.continue()
  }
  await page.route('**/rest/v1/**', handler)
  await page.route('**/rest/v1/rpc/**', handler)
}

async function newPage(browser, w, h, theme) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  if (theme === 'light') await ctx.addInitScript(() => localStorage.setItem('inbox-theme', 'light'))
  const page = await ctx.newPage()
  await installInterceptor(page)
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push(String(e)))
  page.on('response', r => { if (r.status() === 401) errs.push(`401 ${r.url()}`) })
  return { ctx, page, errs }
}

const VIEWPORTS = [{ w: 1440, h: 900 }, { w: 390, h: 844 }]
const THEMES = ['dark', 'light']

// Every shot's act(), so a failure to reach a state is visible in the manifest
// rather than silently producing a screenshot of the wrong screen. Each act
// returns a short string describing what it actually reached; the manifest
// records it and a `MISSED` value is a failed capture, not a pass.
const SHOTS = [
  {
    id: 'calls-today',
    label: 'Today, the Calls area (next call plus the archive)',
    async act(page) {
      const zone = page.locator('#td-z-calls')
      if (await zone.count() === 0) return 'MISSED: no calls section'
      await zone.scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)
      const rows = await page.locator('#td-z-calls .td-qrow').count()
      return `reached, ${rows} rows`
    },
  },
  {
    id: 'calls-empty',
    label: 'Today, the next-call empty state above the archive',
    async act(page) {
      const card = page.locator('#td-z-call .td-card-t')
      if (await card.count() === 0) return 'MISSED: next-call card is populated, not empty'
      await page.locator('#td-z-call').scrollIntoViewIfNeeded()
      await page.waitForTimeout(400)
      return `reached: ${(await card.first().innerText()).trim()}`
    },
  },
  {
    id: 'calls-reader-actions',
    label: 'The reader open on a call carrying action items',
    async act(page) {
      const zone = page.locator('#td-z-calls')
      if (await zone.count() === 0) return 'MISSED: no calls section'
      await zone.scrollIntoViewIfNeeded()
      // The default segment is the one holding the open business, so the first
      // row of the default view IS a call with action items. Assert that
      // rather than assume it.
      const chip = page.locator('#td-z-calls .td-qrow').first().locator('.td-qage')
      if (await chip.count() === 0) return 'MISSED: first row carries no open-business chip'
      const chipText = (await chip.first().innerText()).trim()
      await page.locator('#td-z-calls .td-qrow').first().click()
      await page.waitForTimeout(900)
      if (await page.locator('.cw .cw-ai').count() === 0) return 'MISSED: reader opened with no promises'
      const promises = await page.locator('.cw .cw-ai').count()
      return `reached, chip "${chipText}", ${promises} promises rendered`
    },
  },
  {
    id: 'calls-reader-body',
    label: 'The reader with the raw transcript unfolded',
    async act(page) {
      const zone = page.locator('#td-z-calls')
      if (await zone.count() === 0) return 'MISSED: no calls section'
      await zone.scrollIntoViewIfNeeded()
      await page.locator('#td-z-calls .td-qrow').first().click()
      await page.waitForTimeout(800)
      const fold = page.locator('.cw-fold .dw-sec-b')
      if (await fold.count() === 0) return 'MISSED: no fold'
      await fold.first().click()
      await page.waitForTimeout(1800)
      const pre = page.locator('.cw-pre')
      if (await pre.count() === 0) return 'MISSED: body did not render'
      const chars = (await pre.first().innerText()).length
      return `reached, ${chars} characters of dialogue`
    },
  },
  {
    id: 'calls-reader-all',
    label: 'The reader opened from the All segment, a call with nothing extracted',
    async act(page) {
      const zone = page.locator('#td-z-calls')
      if (await zone.count() === 0) return 'MISSED: no calls section'
      await zone.scrollIntoViewIfNeeded()
      const all = page.getByRole('button', { name: /^All calls/ })
      if (await all.count() === 0) return 'MISSED: no segment control'
      await all.first().click()
      await page.waitForTimeout(400)
      // Expand past the first page, then take the LAST row of the ranked list:
      // that is the far side of the ranking, the quiet end where nothing was
      // extracted. It is the state the reader's honest-empty path exists for,
      // and it is 84 of the 96 rows.
      const more = page.locator('#td-z-calls .td-more')
      if (await more.count() > 0) { await more.first().click(); await page.waitForTimeout(400) }
      const rows = page.locator('#td-z-calls .td-qrow')
      const n = await rows.count()
      if (n === 0) return 'MISSED: no rows'
      await rows.nth(n - 1).scrollIntoViewIfNeeded()
      await rows.nth(n - 1).click()
      await page.waitForTimeout(900)
      const empty = await page.locator('.cw-empty').count()
      return `reached, honest-empty block present: ${empty > 0}`
    },
  },
]

const manifest = []

const browser = await chromium.launch()
for (const shot of SHOTS) {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      const { ctx, page, errs } = await newPage(browser, vp.w, vp.h, theme)
      await page.goto(`${BASE}#exp/v2/today`, { waitUntil: "domcontentloaded" })
      await page.waitForTimeout(3000)
      // Wait for the archive read to land, not for a fixed delay: racing it
      // produced a MISSED that was the harness losing a race rather than the
      // surface failing.
      await page.locator("#td-z-calls .td-qrow").first()
        .waitFor({ state: "visible", timeout: 20000 }).catch(() => {})
      let reached = 'ERROR'
      try { reached = await shot.act(page) } catch (e) { reached = `THREW: ${e.message}` }
      const file = `${shot.id}-${vp.w}x${vp.h}-${theme}.jpg`
      await page.screenshot({ path: join(OUT, file), type: 'jpeg', quality: 82 })
      manifest.push({ file, label: shot.label, viewport: `${vp.w}x${vp.h}`, theme, reached, consoleErrors: errs })
      console.log(`${file}  ${reached}${errs.length ? `  [${errs.length} console errors]` : ''}`)
      await ctx.close()
    }
  }
}
await browser.close()

writeFileSync(join(OUT, 'calls-capture.json'), JSON.stringify({
  base: BASE,
  takenAt: new Date().toISOString(),
  attemptedWrites: writes,
  attemptedWriteLog: writeLog,
  rpcPostsAllowedThrough: rpcCount,
  shots: manifest,
}, null, 2))

console.log(`\nDONE. ${manifest.length} shots. Attempted writes: ${writes}.`)
if (writes > 0) console.log(writeLog.join('\n'))
