// TWO NUMBERS, NOT ONE.
//
// dw-tournament.md's sharpest finding: both candidates reported "13 accent
// elements down to 1" from the same census and both were literally true, while
// one of them had fifteen saturated elements on screen at rest. The number moved
// because the DEFINITION of accent moved; the colour never left the screen.
//
// So this reports both, and where they disagree the second one is the truth.
//
//   A · accent-token elements - DOM elements painting --accent as a fill, as
//       their own text colour, or as a border/outline/shadow colour. Same
//       definition census B3 uses, scoped to `.dw`.
//   B · saturated elements visible at rest - counted from the RENDERED PIXELS.
//       The viewport screenshot is decoded in a canvas and every pixel with
//       HSL saturation above .35 and lightness between .15 and .90 is labelled,
//       then connected components under 60px are dropped as antialiasing. No
//       DOM, no tokens, no definitions this run controls.
//
// SAFETY: the write interceptor is installed on **/rest/v1/** AND
// **/rest/v1/rpc/** before any navigation. Attempted writes are printed and
// must be 0.
//
// Usage: node dw-final-accent.mjs [baseUrl]

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:4173/'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')

let attemptedWrites = 0
async function guard(page) {
  const handler = async r => {
    const q = r.request(), m = q.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
      attemptedWrites++
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  }
  await page.route('**/rest/v1/**', handler)
  await page.route('**/rest/v1/rpc/**', handler)
}

const browser = await chromium.launch()
const results = []

for (const [w, h] of [[1440, 900], [2560, 1440], [390, 844]]) {
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
    if (theme === 'light') await ctx.addInitScript(() => localStorage.setItem('inbox-theme', 'light'))
    const page = await ctx.newPage()
    await guard(page)
    await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1400)
    await page.locator('.ct-card').first().click().catch(() => {})
    await page.waitForTimeout(1600)

    // ---- A · the accent-token census, scoped to .dw ------------------------
    const tokenCount = await page.evaluate(() => {
      const root = document.querySelector('.dw')
      if (!root) return { n: 0, list: [] }
      // 🔴 READ THE TOKEN OFF `.dw`, NOT OFF :root. src/styles.css:4 sets
      // --accent:#10A37F at :root and faithful.css:58 REDEFINES it to #B8FF66
      // inside .wb. Reading the root value compares the window against a colour
      // it never paints, and #10A37F happens to be --sev-clear, so every QA bar
      // scores as an accent hit. That is the instrument lying, not the screen.
      const accent = getComputedStyle(root).getPropertyValue('--accent').trim()
      const norm = s => (s || '').trim().toLowerCase()
      // The token resolves to a hex; compare against its computed rgb form by
      // painting it once and reading it back, so #B8FF66 and rgb(184,255,102)
      // are the same fact.
      const probe = document.createElement('span')
      probe.style.color = accent
      document.body.appendChild(probe)
      const accentRgb = norm(getComputedStyle(probe).color)
      probe.remove()
      const hits = []
      for (const el of root.querySelectorAll('*')) {
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) continue
        const props = [cs.backgroundColor, cs.color, cs.borderTopColor, cs.borderLeftColor,
          cs.outlineColor, cs.boxShadow, cs.fill, cs.stroke]
        if (props.some(p => norm(p).includes(accentRgb))) {
          hits.push(el.className && typeof el.className === 'string'
            ? `${el.tagName.toLowerCase()}.${el.className.split(/\s+/).join('.')}`
            : el.tagName.toLowerCase())
        }
      }
      return { n: hits.length, list: hits }
    })

    // ---- B · saturated blobs, from the rendered pixels ---------------------
    // The LinkedIn preview is CONTENT, not chrome: its avatar, its own reaction
    // glyphs and any image in the post are saturated pixels this run does not
    // spend and must not claim credit for. Blobs are attributed to the artifact
    // rect or to the chrome, and both totals are reported.
    const art = await page.evaluate(() => {
      const e = document.querySelector('.li-card')
      if (!e) return null
      const b = e.getBoundingClientRect()
      return { x: b.x, y: b.y, w: b.width, h: b.height }
    })
    const shot = await page.screenshot({ type: 'png' })
    const b64 = shot.toString('base64')
    const blank = await ctx.newPage()
    await blank.goto('about:blank')
    const pixels = await blank.evaluate(async src => {
      const img = new Image()
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src })
      const c = document.createElement('canvas')
      c.width = img.width; c.height = img.height
      const g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(img, 0, 0)
      const { data, width, height } = g.getImageData(0, 0, c.width, c.height)
      const sat = new Uint8Array(width * height)
      let satPixels = 0
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const r = data[i] / 255, gr = data[i + 1] / 255, b = data[i + 2] / 255
        const mx = Math.max(r, gr, b), mn = Math.min(r, gr, b)
        const l = (mx + mn) / 2
        if (mx === mn) continue
        const s = l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn)
        if (s > 0.35 && l > 0.15 && l < 0.90) { sat[p] = 1; satPixels++ }
      }
      // Connected components, 4-neighbour, iterative so a large blob cannot
      // blow the stack.
      const seen = new Uint8Array(width * height)
      const blobs = []
      const stack = new Int32Array(width * height)
      for (let p = 0; p < sat.length; p++) {
        if (!sat[p] || seen[p]) continue
        let top = 0, area = 0
        let minx = width, maxx = 0, miny = height, maxy = 0
        stack[top++] = p; seen[p] = 1
        while (top > 0) {
          const q = stack[--top]
          area++
          const x = q % width, y = (q / width) | 0
          if (x < minx) minx = x; if (x > maxx) maxx = x
          if (y < miny) miny = y; if (y > maxy) maxy = y
          if (x > 0 && sat[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack[top++] = q - 1 }
          if (x < width - 1 && sat[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack[top++] = q + 1 }
          if (y > 0 && sat[q - width] && !seen[q - width]) { seen[q - width] = 1; stack[top++] = q - width }
          if (y < height - 1 && sat[q + width] && !seen[q + width]) { seen[q + width] = 1; stack[top++] = q + width }
        }
        if (area >= 60) blobs.push({ area, x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 })
      }
      blobs.sort((a, b) => b.area - a.area)
      return { width, height, satPixels, blobs: blobs.length, all: blobs }
    }, `data:image/png;base64,${b64}`)
    const inArt = b => art && b.x >= art.x - 2 && b.y >= art.y - 2 &&
      b.x + b.w <= art.x + art.w + 2 && b.y + b.h <= art.y + art.h + 2
    await blank.close()

    const artBlobs = pixels.all.filter(inArt)
    const chrome = pixels.all.filter(b => !inArt(b))
    results.push({ viewport: `${w}x${h}`, theme, accentTokenElements: tokenCount.n, accentList: tokenCount.list,
      saturatedAtRestTotal: pixels.blobs, saturatedInArtifact: artBlobs.length, saturatedInChrome: chrome.length,
      chromeBlobs: chrome.slice(0, 12) })
    console.log(`${w}x${h} ${theme}  accent-token=${tokenCount.n}  saturated-at-rest=${chrome.length} chrome + ${artBlobs.length} inside the artifact = ${pixels.blobs}`)
    await ctx.close()
  }
}
await browser.close()
console.log(JSON.stringify(results, null, 2))
console.log('attemptedWrites =', attemptedWrites)
