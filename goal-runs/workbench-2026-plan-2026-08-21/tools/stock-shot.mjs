// #exp/stock is the escape hatch to the pre-revamp shell. This run must not
// change a pixel of it, so it gets captured from a clean `main` worktree before
// and from the branch after, and the two are compared byte-for-byte on the
// decoded pixels.
//
//   node stock-shot.mjs --base http://localhost:4180/ --out <dir>
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, mkdirSync } from 'node:fs'

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d }
const BASE = arg('base', 'http://localhost:4173/')
const OUT = arg('out')
mkdirSync(OUT, { recursive: true })
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const blocked = []

const browser = await chromium.launch()
for (const vw of [390, 1024, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vw === 390 ? 812 : 900 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  const page = await ctx.newPage()
  await page.route('**/rest/v1/**', async r => {
    const q = r.request(), m = q.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
      blocked.push(m + ' ' + q.url().split('/rest/v1/')[1].slice(0, 60))
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  })
  await page.goto(BASE + '#exp/stock', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  // Relative timestamps re-render, so a pixel diff can fire on "2m ago" turning
  // into "3m ago" and prove nothing. The character count is recorded alongside
  // the image so a diff can be read against how much text moved.
  const txt = await page.evaluate(() => document.body.innerText.trim().length)
  await page.screenshot({ path: `${OUT}/stock-${vw}.png`, type: 'png' })
  console.log(`stock@${vw} chars=${txt}`)
  await ctx.close()
}
await browser.close()
console.log('blocked writes:', blocked.length)
