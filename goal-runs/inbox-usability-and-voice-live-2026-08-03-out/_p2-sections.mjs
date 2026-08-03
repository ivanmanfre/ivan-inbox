// Per-section capture: for each route/width, find the live scroller and step
// through the full scroll height in viewport-sized steps, shooting each step.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const OUT = process.argv[2]
const BASE = process.argv[3] || 'http://localhost:4173/'
mkdirSync(OUT, { recursive: true })
const routes = ['today','inbox','drafts','content','magnets','sends','ops','settings']
const browser = await chromium.launch()
const errs = {}
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
  await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)
  for (const r of routes) {
    await page.goto(`${BASE}#exp/v2/${r}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(2300)
    // find the tallest scrollable element
    const info = await page.evaluate(() => {
      let best = null
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el)
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 40) {
          if (!best || el.scrollHeight > best.sh) best = { sh: el.scrollHeight, ch: el.clientHeight, el }
        }
      }
      if (!best) return { steps: 1 }
      best.el.setAttribute('data-cap-scroller', '1')
      return { steps: Math.min(8, Math.ceil(best.sh / best.ch)), sh: best.sh, ch: best.ch }
    })
    for (let i = 0; i < info.steps; i++) {
      if (i > 0) {
        await page.evaluate(([i]) => {
          const el = document.querySelector('[data-cap-scroller]')
          if (el) el.scrollTop = i * el.clientHeight * 0.92
        }, [i])
        await page.waitForTimeout(450)
      }
      await page.screenshot({ path: `${OUT}/${r}-${w}-s${i}.png`, animations: 'disabled', timeout: 15000 }).catch(async () => { await page.screenshot({ path: `${OUT}/${r}-${w}-s${i}.png`, animations: 'disabled', timeout: 15000, caret: 'initial' }).catch(e => console.log('SHOT-FAIL', r, w, i, String(e).slice(0,80))) })
    }
    await page.evaluate(() => document.querySelector('[data-cap-scroller]')?.removeAttribute('data-cap-scroller'))
  }
  errs[w] = errors
  await page.close()
}
await browser.close()
console.log(JSON.stringify({ errs: Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, v.length])) }))
