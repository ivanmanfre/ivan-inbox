// Retake content + magnets fixshots, waiting for real rows (not the skeleton).
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const OUT = new URL('./phase2-fixshots', import.meta.url).pathname
const BASE = 'http://localhost:4173/'
mkdirSync(OUT, { recursive: true })

const PLAN = {
  1440: { content: [0, 2], magnets: [2] },
  390: { content: [0, 2, 3], magnets: [0, 2] },
}

const browser = await chromium.launch()
const errs = {}
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
  await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2000)
  for (const [r, steps] of Object.entries(PLAN[w])) {
    await page.goto(`${BASE}#exp/v2/${r}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForSelector('.ct-card, .ct-res-row', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(1500)
    await page.evaluate(() => {
      let best = null
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el)
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 40) {
          if (!best || el.scrollHeight > best.scrollHeight) best = el
        }
      }
      if (best) best.setAttribute('data-cap-scroller', '1')
    })
    for (const i of steps) {
      await page.evaluate(([i]) => {
        const el = document.querySelector('[data-cap-scroller]')
        if (el) el.scrollTop = i * el.clientHeight * 0.92
      }, [i])
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/${r}-${w}-s${i}.png`, animations: 'disabled', timeout: 15000 })
        .catch(e => console.log('SHOT-FAIL', r, w, i, String(e).slice(0, 80)))
    }
    await page.evaluate(() => document.querySelector('[data-cap-scroller]')?.removeAttribute('data-cap-scroller'))
  }
  errs[w] = errors
  await page.close()
}
await browser.close()
console.log(JSON.stringify({ consoleErrors: errs }))
