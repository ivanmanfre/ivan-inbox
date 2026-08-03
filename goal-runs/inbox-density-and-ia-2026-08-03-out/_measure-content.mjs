// PHASE 3 MEASUREMENT — the two numbers the gate asks for, on the real
// scrolling element rather than a guessed selector:
//   1. height of the Content route (the scroller's scrollHeight)
//   2. scroll distance to the first ACTIONABLE row
// plus a census of what sits above that row, so the reduction can be attributed.
//
//   node _measure-content.mjs <origin> <label> [route]
import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'

const ORIGIN = process.argv[2] ?? 'http://localhost:4173'
const LABEL = process.argv[3] ?? 'after'
const ROUTE = process.argv[4] ?? 'content'
const DIR = 'goal-runs/inbox-density-and-ia-2026-08-03-out/measure'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
mkdirSync(DIR, { recursive: true })

const browser = await chromium.launch()
const out = { label: LABEL, origin: ORIGIN, route: ROUTE, at: new Date().toISOString(), widths: {} }

for (const w of [1440, 390]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } })
  await page.addInitScript(([s]) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
  }, [session])
  await page.goto(`${ORIGIN}/#exp/v2/${ROUTE}`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(6000)

  const m = await page.evaluate(() => {
    // THE scroller: the deepest element that actually overflows. Guessing a
    // class name produced scrollHeight === clientHeight (i.e. a non-scroller)
    // and would have made any "reduction" unmeasurable.
    let sc = null
    for (const el of document.querySelectorAll('div,section,main')) {
      const over = el.scrollHeight - el.clientHeight
      if (over > 40 && (!sc || el.scrollHeight > sc.scrollHeight)) {
        const st = getComputedStyle(el).overflowY
        if (st === 'auto' || st === 'scroll') sc = el
      }
    }
    const doc = document.documentElement
    const scroller = sc ?? doc
    const sTop = scroller.getBoundingClientRect().top
    const rel = (el) => Math.round(el.getBoundingClientRect().top - sTop + scroller.scrollTop)

    // THE row Ivan can act on: the first card inside the REVIEW section. Not
    // "the first .ct-card on the page" — that resolved to a row inside the ALERT
    // strip, so collapsing the strip would have scored as a win without the
    // review queue moving at all.
    const cards = [...document.querySelectorAll('.ct-card')]
    const reviewAnchor = document.getElementById('wb-s-review')
    let firstCard = null
    if (reviewAnchor) {
      firstCard = reviewAnchor.querySelector('.ct-card')
        ?? (() => {
          // section open state may render rows as siblings after the anchor
          let n = reviewAnchor.nextElementSibling
          while (n && !n.classList?.contains('ct-card')) n = n.nextElementSibling
          return n
        })()
    }
    if (!firstCard) firstCard = cards[0] ?? null

    // Everything ABOVE the first actionable row, itemised, so the reduction can
    // be attributed to a block rather than asserted.
    const above = []
    if (firstCard) {
      const y = rel(firstCard)
      const seen = new Set()
      for (const el of scroller.querySelectorAll(':scope > *, :scope > * > *')) {
        if (!(el instanceof HTMLElement)) continue
        const t = rel(el)
        const h = el.getBoundingClientRect().height
        if (t < y && h > 8 && !seen.has(el)) {
          seen.add(el)
          above.push({ cls: (el.className || '').toString().split(' ').slice(0, 2).join('.'), top: t, h: Math.round(h) })
        }
      }
    }
    return {
      scrollerClass: (scroller.className || '').toString().split(' ')[0] || 'documentElement',
      routeHeight: scroller.scrollHeight,
      viewport: scroller.clientHeight,
      screensOfScroll: +(scroller.scrollHeight / Math.max(1, scroller.clientHeight)).toFixed(2),
      firstActionableTop: firstCard ? rel(firstCard) : null,
      visibleWithoutScrolling: firstCard ? rel(firstCard) < scroller.clientHeight : null,
      cards: cards.length,
      sections: document.querySelectorAll('.wb-sech').length,
      openSections: [...document.querySelectorAll('.wb-sech')]
        .filter(h => h.className.includes('open') || h.getAttribute('aria-expanded') === 'true').length,
      above: above.sort((a, b) => a.top - b.top).slice(0, 14),
    }
  })
  out.widths[w] = m
  await page.screenshot({ path: `${DIR}/${ROUTE}-${LABEL}-${w}.png` })
  // A full-page-ish capture of the scroller for the density read.
  await page.close()
}
await browser.close()
writeFileSync(`${DIR}/${ROUTE}-${LABEL}.json`, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 1))
