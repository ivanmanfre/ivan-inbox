// #exp/stock, compared properly.
//
// A byte compare of two screenshots taken four seconds apart said "identical"
// once and "different" the next run, because the stock shell paints live data
// and a relative clock. A stale or drifting baseline reads as a diff, so this
// establishes the NOISE FLOOR first: the same build is captured twice, and only
// then is the other build compared against it. A real CSS regression is a
// difference the noise floor does not already contain.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync } from 'node:fs'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const DIR = '/Users/ivanmanfredi/Desktop/ivan-inbox-pw-a/goal-runs/workbench-polish-2026-08-22-out/after/'
const attempted = []

const browser = await chromium.launch()

async function shot(base, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  const page = await ctx.newPage()
  await page.route('**/rest/v1/**', async r => {
    const q = r.request(), m = q.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
      attempted.push({ kind: 'rest', method: m, url: q.url(), body: q.postData() })
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  })
  await page.route('**/rest/v1/rpc/**', async r => {
    attempted.push({ kind: 'rpc', method: r.request().method(), url: r.request().url(), body: r.request().postData() })
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'blocked_by_probe' }) })
  })
  await page.goto(base + '#exp/stock', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3500)
  const buf = await page.screenshot({ type: 'png' })
  writeFileSync(`${DIR}p4a-stock-${tag}.png`, buf)
  await page.close(); await ctx.close()
  return buf.toString('base64')
}

const AFTER = 'http://localhost:4181/'
const BEFORE = 'http://localhost:4182/'

// Interleaved, so clock drift falls on both sides equally.
const a1 = await shot(AFTER, 'after')
const b1 = await shot(BEFORE, 'before')
const a2 = await shot(AFTER, 'after2')

// Pixel diff in the browser, no new dependency.
const ctx = await browser.newContext()
const page = await ctx.newPage()
await page.goto('about:blank')
const diff = (x, y) => page.evaluate(async ([p, q]) => {
  const load = s => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + s })
  const [ia, ib] = await Promise.all([load(p), load(q)])
  if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: true }
  const c = n => { const cv = document.createElement('canvas'); cv.width = ia.width; cv.height = ia.height
    cv.getContext('2d').drawImage(n, 0, 0); return cv.getContext('2d').getImageData(0, 0, ia.width, ia.height).data }
  const da = c(ia), db = c(ib)
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
  for (let i = 0; i < da.length; i += 4) {
    if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) {
      n++
      const px = (i / 4) % ia.width, py = Math.floor((i / 4) / ia.width)
      if (px < x0) x0 = px; if (px > x1) x1 = px
      if (py < y0) y0 = py; if (py > y1) y1 = py
    }
  }
  return { w: ia.width, h: ia.height, diffPixels: n, pct: +(100 * n / (ia.width * ia.height)).toFixed(4),
    box: n ? { x0, y0, x1, y1 } : null }
}, [x, y])

const noise = await diff(a1, a2)        // same build, two moments
const across = await diff(a2, b1)       // this build vs the commit before the branch
console.log('NOISE FLOOR  after vs after :', JSON.stringify(noise))
console.log('ACROSS       after vs before:', JSON.stringify(across))
console.log('WRITES THAT REACHED THE DATABASE: 0, attempts intercepted:', attempted.length)
writeFileSync(`${DIR}p4a-stock-diff.json`, JSON.stringify({ noise, across, attempted }, null, 2))
await browser.close()