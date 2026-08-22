// Item: SystemAlertStrip auto-expand blast radius (workbench-polish-2026-08-22).
//
// Measures the two numbers that decide this fix on a real production build:
//   1. the strip's rendered height at 1440x900
//   2. the y coordinate of the FIRST work-queue item
// plus the stock-shell Today shot, so route (a) can be proven pixel-identical.
//
// Read-only. The write interceptor is installed before any navigation and
// COUNTS every genuine mutation attempt it blocks, so the report can state a
// number rather than an assurance.
//
//   node alert-strip-measure.mjs <label> <port>
import { writeFileSync, mkdirSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'

const LABEL = process.argv[2] || 'before'
const PORT = process.argv[3] || '4271'
const BASE = `http://localhost:${PORT}/`
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/workbench-polish-2026-08-22-out'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')

mkdirSync(`${OUT}/after`, { recursive: true })
mkdirSync(`${OUT}/evidence/alert-strip-shots`, { recursive: true })

let writeAttempts = []

async function boot(viewport = { width: 1440, height: 900 }, theme = 'dark') {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  const page = await ctx.newPage()
  const block = async r => {
    const q = r.request(), m = q.method()
    const isRpc = q.url().includes('/rpc/')
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !isRpc)) {
      writeAttempts.push(`${m} ${q.url()}`)
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  }
  await page.route('**/rest/v1/**', block)
  await page.route('**/rest/v1/rpc/**', block)
  page.on('response', r => { if (r.status() === 401) console.error('!! 401 ' + r.url()) })
  page._wantLight = theme === 'light'
  return { browser, page }
}

async function goto(page, hash, wait = 3200) {
  await page.goto(BASE + hash, { waitUntil: 'networkidle' })
  // AFTER load, never as an init script: at document-start the attribute is
  // set on a documentElement the app then re-renders under, and the light
  // shots came back byte-identical to the dark ones.
  if (page._wantLight) await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await page.waitForTimeout(wait)
}

// The probe. Everything is read off getBoundingClientRect on the LIVE build,
// never off the source, so the numbers describe what renders.
const PROBE = () => {
  const box = el => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) }
  }
  const strip = document.querySelector('.sa')
  const rows = document.querySelector('.rows.td-rows')
  const z0 = document.querySelector('#td-z0')
  // The first ACTIONABLE queue item, not the zone head: a reply row, or a
  // pile hand-off row, whichever the ranking put first.
  const firstItem = z0 ? z0.querySelector('.td-r, .td-ho, .td-empty') : null
  const saRows = [...document.querySelectorAll('.sa .sa-row')]
  return {
    strip: box(strip),
    stripRowCount: saRows.length,
    stripRowSeverities: saRows.map(r => (r.querySelector('.sa-sev') || {}).textContent || '?'),
    summaryText: (document.querySelector('.sa-sum') || {}).textContent || null,
    chev: (document.querySelector('.sa-chev') || {}).textContent || null,
    workArea: box(rows),
    workAreaScrollH: rows ? rows.scrollHeight : null,
    zoneQueue: box(z0),
    firstQueueItem: box(firstItem),
    firstQueueItemText: firstItem ? (firstItem.textContent || '').trim().slice(0, 70) : null,
    stripShareOfWorkArea: strip && rows
      ? +((strip.getBoundingClientRect().height / rows.getBoundingClientRect().height) * 100).toFixed(1) : null,
  }
}

const out = { label: LABEL, base: BASE, at: new Date().toISOString() }

// ---- 1. the two numbers, workbench Today, 1440x900 dark -------------------
{
  const { browser, page } = await boot()
  await goto(page, '#exp/v2/today', 4000)
  out.v2today = await page.evaluate(PROBE)
  await page.screenshot({ path: `${OUT}/after/today-fixed-1440x900-dark.jpg`, quality: 82, type: 'jpeg' })
  // collapse-click behaviour, measured rather than asserted
  const bar = page.locator('.sa-bar')
  if (await bar.count()) {
    await bar.first().click(); await page.waitForTimeout(500)
    out.afterBarClick = await page.evaluate(PROBE)
    await bar.first().click(); await page.waitForTimeout(500)
    out.afterSecondBarClick = await page.evaluate(PROBE)
  }
  await browser.close()
}

// ---- 2. stock Today, same window, for the pixel-identical gate ------------
{
  const { browser, page } = await boot()
  // #exp/stock lands on the pre-revamp Shell, whose default tab is Inbox and
  // whose variant choice lives in sessionStorage. A plain hash change to
  // #today reaches its Today WITHOUT a reload, so the gate never re-reads the
  // hash and the shell stays stock.
  await goto(page, '#exp/stock', 3000)
  await page.evaluate(() => { location.hash = '#today' })
  await page.waitForTimeout(4500)
  out.stock = await page.evaluate(PROBE)
  await page.screenshot({ path: `${OUT}/evidence/alert-strip-shots/stock-today-${LABEL}.png`, fullPage: false })
  // a SECOND shot off the SAME build, to establish the noise floor: any
  // pixel delta below this is render jitter, not a change.
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(4000)
  await page.screenshot({ path: `${OUT}/evidence/alert-strip-shots/stock-today-${LABEL}-noise.png`, fullPage: false })
  await browser.close()
}

// ---- 3. the four required shots (after-run only) --------------------------
if (LABEL === 'after') {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const theme of ['dark', 'light']) {
      const { browser, page } = await boot({ width: w, height: h }, theme)
      await goto(page, '#exp/v2/today', 4000)
      await page.screenshot({ path: `${OUT}/after/today-fixed-${w}x${h}-${theme}.jpg`, quality: 82, type: 'jpeg' })
      await browser.close()
    }
  }
}

out.writeAttempts = writeAttempts.length
out.writeAttemptDetail = writeAttempts.slice(0, 10)
writeFileSync(`${OUT}/evidence/audit-tools/out-alert-strip-${LABEL}.json`, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
