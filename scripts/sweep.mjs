// sweep.mjs — capture every route at mobile + desktop widths with the minted
// session injected before load, and report console errors + horizontal overflow.
// Built for goal-run inbox-v2-revamp-2026-08-01: the same instrument produces the
// pre-run baseline and the post-build comparison, so a "looks fine" claim is a diff.
//
// Usage: node scripts/sweep.mjs <outDir> [baseUrl] [routes.csv]
//   node scripts/sweep.mjs goal-runs/.../baseline https://ivanmanfre.github.io/ivan-inbox/
// Routes default to the production tab set. #exp/ hashes are read at load time
// only, so every route gets its own fresh page load — never an in-page hash nav.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const outDir = process.argv[2]
const baseUrl = process.argv[3] ?? 'https://ivanmanfre.github.io/ivan-inbox/'
const routes = (process.argv[4] ?? 'today,inbox,drafts,sends,ops,settings').split(',')
const WIDTHS = [
  { w: 390, h: 852, tag: 'mobile' },
  { w: 1440, h: 900, tag: 'desktop' },
]

mkdirSync(outDir, { recursive: true })
const session = readFileSync(new URL('../.session.json', import.meta.url), 'utf8')
const browser = await chromium.launch()
const report = []

for (const route of routes) {
  for (const { w, h, tag } of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
    // Session must exist on the origin before the app boots, or App.tsx renders
    // LoginScreen and every shot is the same login page.
    await page.addInitScript(([key, val]) => {
      window.localStorage.setItem(key, val)
    }, ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
    const url = `${baseUrl}#${route}`
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => {
      errors.push(`goto: ${String(e).slice(0, 120)}`)
    })
    await page.waitForTimeout(2500)
    // Overflow is measured, never eyeballed: a mobile screen that scrolls
    // sideways is the exact defect the 07-31 "too wide on desktop" fix inverted.
    const metrics = await page.evaluate(() => {
      const d = document.documentElement
      const texts = [...document.querySelectorAll('body *')]
        .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim().length > 1)
      return {
        scrollWidth: d.scrollWidth,
        clientWidth: d.clientWidth,
        overflow: d.scrollWidth > d.clientWidth,
        scrollHeight: d.scrollHeight,
        textNodes: texts.length,
        words: texts.reduce((n, el) => n + (el.textContent ?? '').trim().split(/\s+/).length, 0),
        loginVisible: !!document.body.textContent?.includes('Send me a code'),
      }
    })
    const file = `${outDir}/${route.replace(/\//g, '_')}-${tag}.png`
    await page.screenshot({ path: file, fullPage: true })
    report.push({ route, tag, width: w, file, ...metrics, errors })
    console.log(
      `${route}/${tag} ${metrics.scrollWidth}x${metrics.scrollHeight} overflow=${metrics.overflow}` +
      ` words=${metrics.words} login=${metrics.loginVisible} errors=${errors.length}`,
    )
    await ctx.close()
  }
}

await browser.close()
writeFileSync(`${outDir}/sweep.json`, JSON.stringify(report, null, 2))
const bad = report.filter((r) => r.overflow || r.loginVisible || r.errors.length)
console.log(`\n${report.length} shots → ${outDir}/sweep.json`)
console.log(bad.length ? `PROBLEM ROWS: ${bad.map((r) => `${r.route}/${r.tag}`).join(', ')}` : 'clean: no overflow, no login leaks, no console errors')
