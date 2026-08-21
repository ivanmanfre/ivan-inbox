// Does the filter sheet's KIND group still print raw column values?
// Opens the sheet at 390 and 1440 and reads the option labels back.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, mkdirSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/workbench-2026-plan-2026-08-21/final'
mkdirSync(OUT, { recursive: true })
const blocked = []
const RAW = /\b(single_image|dm_sent|thread_already_answered|lead_magnet|youtube_watch|qa_blocked|lint_fail|gold_icp_v2_seatless)\b/gi

const browser = await chromium.launch()
for (const vw of [390, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vw === 390 ? 812 : 900 } })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  const page = await ctx.newPage()
  await page.route('**/rest/v1/**', async r => {
    const q = r.request(), m = q.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
      blocked.push(m); return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  })
  await page.goto('http://localhost:4173/#exp/v2/content', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.getByText('Filters', { exact: false }).first().click()
  await page.waitForTimeout(900)
  const out = await page.evaluate(() => {
    const opts = [...document.querySelectorAll('.wb-fopt-l')].map(e => e.textContent.trim())
    return { opts, sheetText: (document.querySelector('.ct-fsheet') || document.body).innerText.slice(0, 900) }
  })
  const hits = [...out.sheetText.matchAll(RAW)].map(m => m[0])
  console.log(`\n=== ${vw} ===`)
  console.log('options:', out.opts.join(' | '))
  console.log('RAW VALUE HITS:', hits.length, hits)
  await page.screenshot({ path: `${OUT}/kind-${vw}.jpg`, quality: 78, type: 'jpeg' })
  await ctx.close()
}
await browser.close()
console.log('\nblocked writes:', blocked.length)
