// Ask-1 verification, re-running the phase-6 scout's own method.
//
// Method, verbatim from phase6-reflow-and-slash.md CHECK 1: session injected via
// localStorage, viewports 1440x900 and 1680x1000, route #exp/v2/content. On a
// non-mobile canvas the peer is docked by default, so "open" is the fresh-load
// state and "closed" is after clicking .wb-pane-x. The caveat that cost the
// scout a re-run is honoured: a hash-only goto is a same-document navigation in
// Chromium and does not remount the SPA, so every state gets its own reload().
//
// Bar: every MAIN object grows >= 80% of the column's growth, or is centered.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5431'
const out = process.argv[3] ?? '/tmp/phase6-reflow.json'
const session = JSON.parse(readFileSync(new URL('../.session.json', import.meta.url), 'utf8'))

// The objects Ivan named: chart card, alert strip, filter row, stage groups.
// Measured by class so a section that did not render simply reports absent
// rather than silently passing.
const MAIN = ['.wb-chartcard', '.ct-alert', '.ct-filters', '.ct-subtle', '#wb-s-review', '#wb-s-lm']

const MEASURE = (sels) => {
  const col = document.querySelector('.wb-work')
  const rows = document.querySelector('.ct-rows')
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), maxW: s.maxWidth }
  }
  const o = { col: box(col), rows: box(rows), items: {} }
  for (const sel of sels) o.items[sel] = box(document.querySelector(sel))
  return o
}

const settle = async (page) => {
  await page.waitForLoadState('domcontentloaded')
  // spine capture discipline: never networkidle (an open realtime socket can
  // never satisfy it). Poll for skeletons gone + no literal "Loading" + text settled.
  for (let i = 0; i < 60; i++) {
    const s = await page.evaluate(() => ({
      sk: document.querySelectorAll('.sk').length,
      loading: /Loading/.test(document.body.innerText),
      len: document.body.innerText.length,
    }))
    if (s.sk === 0 && !s.loading && s.len > 800) {
      const a = s.len
      await page.waitForTimeout(400)
      const b = await page.evaluate(() => document.body.innerText.length)
      if (a === b) return true
    }
    await page.waitForTimeout(300)
  }
  return false
}

const browser = await chromium.launch()
const results = {}
for (const vp of [{ w: 1440, h: 900 }, { w: 1680, h: 1000 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.goto(base)
  await page.evaluate((s) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', JSON.stringify(s))
  }, session)

  const read = async (close) => {
    await page.goto(`${base}/#exp/v2/content`)
    await page.reload()
    await settle(page)
    if (close) {
      const x = await page.$('.wb-pane-x')
      if (x) { await x.click(); await page.waitForTimeout(600) }
    }
    return page.evaluate(MEASURE, MAIN)
  }
  const open = await read(false)
  const closed = await read(true)
  results[`${vp.w}x${vp.h}`] = { open, closed }
  await ctx.close()
}
await browser.close()

const lines = []
for (const [vp, r] of Object.entries(results)) {
  const colGrow = r.closed.col.w - r.open.col.w
  lines.push(`\n== ${vp} :: work column ${r.open.col.w} -> ${r.closed.col.w} (+${colGrow}) ==`)
  for (const sel of MAIN) {
    const a = r.open.items[sel], b = r.closed.items[sel]
    if (!a || !b) { lines.push(`  ${sel.padEnd(16)} ABSENT`); continue }
    const grow = b.w - a.w
    const pct = colGrow ? Math.round((grow / colGrow) * 100) : 0
    const gapL = b.left - r.closed.col.left
    const gapR = r.closed.col.right - b.right
    const centered = Math.abs(gapL - gapR) <= 2
    lines.push(`  ${sel.padEnd(16)} ${String(a.w).padStart(5)} -> ${String(b.w).padStart(5)}  ${String(pct).padStart(4)}% of column growth  gapL=${gapL} gapR=${gapR}${centered ? ' CENTERED' : ''}  maxW=${b.maxW}  ${pct >= 80 || centered ? 'PASS' : 'FAIL'}`)
  }
}
writeFileSync(out, JSON.stringify(results, null, 2))
console.log(lines.join('\n'))
console.log(`\nraw -> ${out}`)
