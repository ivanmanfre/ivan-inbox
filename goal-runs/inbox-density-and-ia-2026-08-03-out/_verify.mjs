// Route verifier for the density run. Walks every surviving route at both
// widths on whichever origin it is pointed at, and reports the floors:
// console errors, horizontal overflow, and the measurements each phase needs
// (Content route height, scroll distance to the first actionable row).
//
//   node _verify.mjs <origin> <outdir> [routes,comma,separated]
import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'

const ORIGIN = process.argv[2] ?? 'http://localhost:4173'
const OUT = process.argv[3] ?? 'goal-runs/inbox-density-and-ia-2026-08-03-out/shots'
const ROUTES = (process.argv[4] ?? 'today,dms,content,magnets,sends,ops,settings').split(',')
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const out = { origin: ORIGIN, at: new Date().toISOString(), routes: {} }

for (const w of [1440, 390]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await page.addInitScript(([s]) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
  }, [session])

  for (const r of ROUTES) {
    const before = errors.length
    await page.goto(`${ORIGIN}/#exp/v2/${r}`, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(r === 'content' || r === 'magnets' ? 4500 : 2500)
    const m = await page.evaluate(() => {
      const de = document.documentElement
      const scroller = document.querySelector('.rows, .wb-scroll, .wb-work') || de
      // Every element that pokes past the viewport, named — a bare boolean is
      // not actionable when it fires.
      const over = []
      for (const el of document.querySelectorAll('*')) {
        const b = el.getBoundingClientRect()
        if (b.width > 0 && (b.right > window.innerWidth + 1 || b.left < -1)) {
          over.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}@${Math.round(b.left)},${Math.round(b.right)}`)
        }
      }
      return {
        hScroll: de.scrollWidth > de.clientWidth + 1,
        overflowers: [...new Set(over)].slice(0, 6),
        // The Content measurement: how tall the scrollable surface is and how
        // far down the first row that can be acted on sits.
        scrollH: scroller.scrollHeight,
        clientH: scroller.clientHeight,
        hash: location.hash,
        title: document.querySelector('.nav h2')?.textContent ?? null,
      }
    })
    // Scroll distance to the first actionable row: the top of the first review
    // row (Content) or the first conversation row (DMs), relative to the
    // scroller's own top.
    const firstAction = await page.evaluate(() => {
      const sel = '.ct-card, .r, .qc, .log-r'
      const scroller = document.querySelector('.rows, .wb-scroll, .wb-work')
      const el = document.querySelector(sel)
      if (!el || !scroller) return null
      return Math.round(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop)
    })
    // 44px floor on anything that takes a tap.
    const small = w !== 390 ? [] : await page.evaluate(() => {
      const bad = []
      const sel = '.tb, .chip, .wb-fpill, .ct-fpill, .wb-ihead-i.tap, .wb-ws, .sg, .btn, .wb-tk-x'
      for (const el of document.querySelectorAll(sel)) {
        const b = el.getBoundingClientRect()
        if (b.width === 0) continue
        const a = getComputedStyle(el, '::after')
        const grow = a.content !== 'none' ? Math.abs(parseFloat(a.top || '0') || 0) * 2 : 0
        if (b.height + grow < 43.5) bad.push(`${(el.className || '').toString().split(' ')[0]}=${Math.round(b.height + grow)}`)
      }
      return [...new Set(bad)].slice(0, 8)
    })
    out.routes[`${r}@${w}`] = {
      ...m, firstActionableTop: firstAction, tapUnder44: small,
      consoleErrors: errors.slice(before),
    }
    await page.screenshot({ path: `${OUT}/${r}-${w}.png`, fullPage: false })
  }
  await page.close()
}
await browser.close()
writeFileSync(`${OUT}/verify.json`, JSON.stringify(out, null, 2))
const bad = Object.entries(out.routes).filter(([, v]) =>
  v.hScroll || v.consoleErrors.length || (v.tapUnder44 ?? []).length)
console.log(JSON.stringify(out, null, 1))
console.log(bad.length ? `\nFAILURES: ${bad.map(b => b[0]).join(', ')}` : '\nALL CLEAN')
