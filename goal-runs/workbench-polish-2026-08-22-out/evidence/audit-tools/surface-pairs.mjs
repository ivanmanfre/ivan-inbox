// CENSUS A (live half): every pair of NESTED elements in the real workbench
// whose computed background-color is IDENTICAL, where a visual relationship is
// intended. Also counts the "child paints nothing" class, and dumps a full
// surface histogram per screen.
//
// Read-only: a write interceptor (verbatim from
// goal-runs/workbench-2026-plan-2026-08-21/tools/chip-probe.mjs:13-19) fulfils
// every PATCH/PUT/DELETE and non-rpc POST with 200 [] so nothing reaches the DB.
//
//   node surface-pairs.mjs [baseUrl]
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync } from 'node:fs'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = process.argv[2] || 'http://localhost:4173/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
await page.route('**/rest/v1/**', async r => {
  const q = r.request(), m = q.method()
  if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  }
  return r.continue()
})

// --------------------------------------------------------------------------
const WALKER = () => {
  const sel = el => {
    if (!el || el === document.documentElement) return 'html'
    const t = el.tagName.toLowerCase()
    const cls = (el.className && typeof el.className === 'string' ? el.className : '')
      .split(/\s+/).filter(Boolean)
      // .wb / .wb-shell are the plate; keep them, they are real selectors
      .slice(0, 4).join('.')
    return cls ? `${t}.${cls}` : t
  }
  const opaque = c => c && c !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)$/.test(c)
  // relative luminance, WCAG
  const lum = c => {
    const m = c.match(/[\d.]+/g)
    if (!m) return null
    const [r, g, b] = m.slice(0, 3).map(Number).map(v => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    })
    return +(0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(4)
  }
  // does this element read as a thing that should sit ON something?
  const INTENT = /\b(chip|card|tile|cell|row|panel|pane|box|item|btn|button|input|textarea|badge|pill|bubble|sec|insp|well|field|tk|dw-|ct-|ov-|sa-|ops-|cal-|wb-|td-|log-|reg-)/
  const rows = []
  const all = [...document.querySelectorAll('.wb *')]
  const paint = new Map()
  for (const el of all) {
    const cs = getComputedStyle(el)
    if (opaque(cs.backgroundColor)) paint.set(el, cs.backgroundColor)
  }
  const nearestPainted = el => {
    let p = el.parentElement
    while (p) { if (paint.has(p)) return p; p = p.parentElement }
    return null
  }
  let sameCount = 0, transparentIntent = 0
  const seen = new Set()
  for (const el of all) {
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 6) continue          // not visible geometry
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const own = cs.backgroundColor
    const cls = typeof el.className === 'string' ? el.className : ''
    const intent = INTENT.test(cls)
    if (!intent) continue
    const anc = nearestPainted(el)
    if (!anc) continue
    const ancC = paint.get(anc)
    if (opaque(own)) {
      if (own === ancC) {
        sameCount++
        const key = sel(el) + '||' + sel(anc)
        if (seen.has(key)) continue
        seen.add(key)
        const border = cs.borderTopWidth !== '0px' || cs.borderBottomWidth !== '0px' ||
          cs.borderLeftWidth !== '0px' || cs.borderRightWidth !== '0px'
        rows.push({
          kind: 'SAME',
          child: sel(el), parent: sel(anc), color: own, lum: lum(own),
          border: border ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : 'NONE',
          shadow: cs.boxShadow === 'none' ? 'none' : cs.boxShadow.slice(0, 60),
          radius: cs.borderRadius, w: Math.round(r.width), h: Math.round(r.height),
        })
      }
    } else {
      transparentIntent++
      const key = 'T:' + sel(el) + '||' + sel(anc)
      if (seen.has(key)) continue
      seen.add(key)
      const border = cs.borderTopWidth !== '0px' || cs.borderBottomWidth !== '0px' ||
        cs.borderLeftWidth !== '0px' || cs.borderRightWidth !== '0px'
      rows.push({
        kind: 'NOPAINT',
        child: sel(el), parent: sel(anc), color: 'transparent (inherits ' + ancC + ')',
        lum: lum(ancC),
        border: border ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : 'NONE',
        shadow: cs.boxShadow === 'none' ? 'none' : cs.boxShadow.slice(0, 60),
        radius: cs.borderRadius, w: Math.round(r.width), h: Math.round(r.height),
      })
    }
  }
  // histogram of every painted colour actually on screen
  const hist = {}
  for (const [el, c] of paint) {
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 6) continue
    hist[c] = (hist[c] || 0) + 1
  }
  return { rows, sameCount, transparentIntent, hist, lumOf: Object.fromEntries(Object.keys(hist).map(c => [c, lum(c)])) }
}

// --------------------------------------------------------------------------
const go = async (hash, after) => {
  await page.goto(BASE + hash, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  if (after) { try { await after() } catch (e) { console.error('  step failed:', e.message) } }
  await page.waitForTimeout(1200)
}
const click = (txt, exact = true) => async () => {
  await page.getByText(txt, { exact }).first().click({ timeout: 5000 })
  await page.waitForTimeout(1800)
}

const SCREENS = [
  ['content-list', '#exp/v2/content', null],
  ['content-calendar', '#exp/v2/content', click('Calendar')],
  ['dms-list', '#exp/v2/dms', null],
  ['ops', '#exp/v2/ops', null],
  ['today', '#exp/v2/today', null],
  ['settings', '#exp/v2/settings', null],
]

const out = {}
for (const [name, hash, after] of SCREENS) {
  await go(hash, after)
  out[name] = await page.evaluate(WALKER)
  console.error(`${name}: ${out[name].rows.length} distinct pairs (${out[name].sameCount} SAME instances, ${out[name].transparentIntent} NOPAINT instances)`)
}

// opened draft window: click the first content row
await go('#exp/v2/content', null)
try {
  await page.locator('.ct-row, .r, [class*=ct-row]').first().click({ timeout: 6000 })
  await page.waitForTimeout(2500)
  out['draft-open'] = await page.evaluate(WALKER)
  console.error(`draft-open: ${out['draft-open'].rows.length} distinct pairs`)
} catch (e) { console.error('draft-open failed:', e.message) }

// opened DM thread
await go('#exp/v2/dms', null)
try {
  await page.locator('.r, [class*=dm-row], [class*=wb-row]').first().click({ timeout: 6000 })
  await page.waitForTimeout(2500)
  out['thread-open'] = await page.evaluate(WALKER)
  console.error(`thread-open: ${out['thread-open'].rows.length} distinct pairs`)
} catch (e) { console.error('thread-open failed:', e.message) }

writeFileSync(new URL('./out-surface-pairs.json', import.meta.url), JSON.stringify(out, null, 1))
await browser.close()

// summary to stdout
let totalSame = 0, totalNo = 0, distinct = new Set()
for (const [k, v] of Object.entries(out)) {
  totalSame += v.sameCount; totalNo += v.transparentIntent
  v.rows.forEach(r => distinct.add(r.kind + ':' + r.child + '||' + r.parent))
}
console.log('SAME instances (all screens):', totalSame)
console.log('NOPAINT instances (all screens):', totalNo)
console.log('distinct child||parent pairs:', distinct.size)
