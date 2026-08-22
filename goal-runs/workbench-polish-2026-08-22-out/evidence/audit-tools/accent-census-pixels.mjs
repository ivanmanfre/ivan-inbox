// THE ACCENT CENSUS, COUNTED OFF RENDERED PIXELS.
//
// Why not a token census: a prior candidate in this run reported "1 accent
// element" on a screen that was showing fifteen saturated marks, because the
// census DEFINITION moved rather than the colour leaving the screen. So this
// instrument never asks the DOM what colour something is. It screenshots the
// surface, decodes the pixels, and counts vivid regions.
//
// Definitions, fixed here so they cannot drift:
//   SATURATED PIXEL  HSV saturation >= 0.45 and value >= 0.35. That admits the
//                    accent (#B8FF66, S 0.60 V 1.00), severity amber and red,
//                    and the pistachio ground (#C5E1A5, S 0.27) is deliberately
//                    BELOW it, because the plate reveal is the page ground and
//                    not a mark on a screen. A 14% lime tint over --e3 lands at
//                    S 0.30, also below, which is the point of the fix.
//   ACCENT PIXEL     within 18/255 per channel of #B8FF66.
//   ELEMENT          a 4-connected region of saturated pixels of at least 16px
//                    area, so antialiasing on a letterform is not a mark.
//
// Read-only. Write interceptor installed before every navigation.
//
// Usage: node accent-census-pixels.mjs [baseUrl]

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:4187/'
const REPO = '/Users/ivanmanfredi/Desktop/ivan-inbox'
const session = readFileSync(`${REPO}/.session.json`, 'utf8')

// The paint this run REMOVED, re-applied at runtime so the before number comes
// off the same build, the same data and the same pixels as the after number.
// These four rules are verbatim what faithful.css carried before 2026-08-22.
const BEFORE_CSS = `
.wb.wb.wb .av.g1, .wb.wb.wb .av.g5{ background:var(--cat-1); background-image:none; color:var(--ink); box-shadow:none }
.wb.wb.wb .av.g2, .wb.wb.wb .av.g6{ background:var(--cat-2); background-image:none; color:var(--ink); box-shadow:none }
.wb.wb.wb .av.g3{ background:var(--cat-3); background-image:none; color:var(--ink); box-shadow:none }
.wb.wb.wb .av.g4{ background:var(--cat-4); background-image:none; color:#FFFFFF; box-shadow:none }
`

const JOBS = ['today', 'dms', 'content', 'magnets', 'styles', 'strategy', 'sends', 'ops', 'settings']

const ANALYSE = `(dataUrl) => new Promise(resolve => {
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const { data, width: W, height: H } = g.getImageData(0, 0, c.width, c.height)
    const N = W * H
    const sat = new Uint8Array(N)
    const acc = new Uint8Array(N)
    let satPx = 0, accentPx = 0
    for (let i = 0; i < N; i++) {
      const r = data[i * 4], gg = data[i * 4 + 1], b = data[i * 4 + 2]
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b)
      const v = mx / 255
      const s = mx === 0 ? 0 : (mx - mn) / mx
      if (s >= 0.45 && v >= 0.35) { sat[i] = 1; satPx++ }
      const isAcc = Math.abs(r - 184) <= 18 && Math.abs(gg - 255) <= 18 && Math.abs(b - 102) <= 18
      if (isAcc) { acc[i] = 1; accentPx++ }
    }
    // 4-connected components over the saturated mask.
    const seen = new Uint8Array(N)
    const regions = []
    const stack = new Int32Array(N)
    for (let i = 0; i < N; i++) {
      if (!sat[i] || seen[i]) continue
      let sp = 0, area = 0, accArea = 0
      let minX = W, maxX = 0, minY = H, maxY = 0
      stack[sp++] = i; seen[i] = 1
      while (sp > 0) {
        const p = stack[--sp]
        area++
        if (acc[p]) accArea++
        const x = p % W, y = (p - x) / W
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
        if (x > 0 && sat[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1 }
        if (x < W - 1 && sat[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1 }
        if (y > 0 && sat[p - W] && !seen[p - W]) { seen[p - W] = 1; stack[sp++] = p - W }
        if (y < H - 1 && sat[p + W] && !seen[p + W]) { seen[p + W] = 1; stack[sp++] = p + W }
      }
      if (area >= 16) regions.push({ area, accArea, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 })
    }
    regions.sort((a, b) => b.area - a.area)
    // An ACCENT element is a saturated region that is mostly the accent itself.
    const accentElements = regions.filter(r => r.accArea / r.area >= 0.5).length
    resolve({ W, H, satPx, accentPx, elements: regions.length, accentElements, top: regions.slice(0, 12) })
  }
  img.src = dataUrl
})`

const browser = await chromium.launch()
let writes = 0, rpc = 0

async function makePage(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(([s, t]) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
    if (t === 'light') localStorage.setItem('inbox-theme', 'light')
    else localStorage.removeItem('inbox-theme')
  }, [session, theme])
  const page = await ctx.newPage()
  const route = async r => {
    const q = r.request(), m = q.method()
    if (m === 'POST' && q.url().includes('/rpc/')) { rpc++; return r.continue() }
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || m === 'POST') {
      writes++
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  }
  await page.route('**/rest/v1/**', route)
  await page.route('**/rest/v1/rpc/**', route)
  return { ctx, page }
}

let seq = 0
async function census(page, job, { before = false } = {}) {
  await page.goto(`${BASE}?ac=${++seq}#exp/v2/${job}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)
  if (before) await page.addStyleTag({ content: BEFORE_CSS })
  await page.waitForTimeout(400)
  const buf = await page.screenshot({ type: 'png' })
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64')
  const analyser = await browser.newContext()
  const ap = await analyser.newPage()
  await ap.goto('about:blank')
  const r = await ap.evaluate(new Function('return ' + ANALYSE)(), dataUrl)
  await analyser.close()
  const avs = await page.evaluate(() => document.querySelectorAll('.av').length)
  return { ...r, avatars: avs }
}

const out = []
for (const theme of ['dark', 'light']) {
  const { ctx, page } = await makePage(theme)
  // DMs gets the before/after pair, because it is the surface the leak was on.
  const b = await census(page, 'dms', { before: true })
  out.push({ theme, job: 'dms', state: 'before', ...b })
  for (const job of JOBS) {
    const a = await census(page, job)
    out.push({ theme, job, state: 'after', ...a })
  }
  await ctx.close()
}
await browser.close()

const pad = (s, n) => String(s).padEnd(n)
console.log(pad('theme', 7), pad('surface', 11), pad('state', 8), pad('satEls', 7), pad('accEls', 7), pad('satPx', 9), pad('accentPx', 9), 'avatars')
for (const r of out) {
  console.log(pad(r.theme, 7), pad(r.job, 11), pad(r.state, 8), pad(r.elements, 7), pad(r.accentElements, 7), pad(r.satPx, 9), pad(r.accentPx, 9), r.avatars)
}
console.log('')
for (const r of out.filter(x => x.job === 'dms')) {
  console.log(`${r.theme} dms ${r.state}: top regions`, JSON.stringify(r.top.slice(0, 8)))
}
console.log('')
console.log(`attempted writes: ${writes} · rpc reads by POST: ${rpc}`)
