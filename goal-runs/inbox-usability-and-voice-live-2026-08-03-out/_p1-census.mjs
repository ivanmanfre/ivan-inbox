import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-usability-and-voice-live-2026-08-03-out/phase1-shots'
const BASE = 'http://localhost:4173/'
const browser = await chromium.launch()
const report = {}
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
  await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)

  // CONTENT route: capsule heights + bottom-of-scroll + overflow
  await page.goto(`${BASE}#exp/v2/content`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(2500)
  const caps = await page.evaluate(() => Array.from(document.querySelectorAll('.wb-cap')).map(c => ({ h: c.getBoundingClientRect().height, t: c.textContent })))
  const hasResourceInContent = await page.evaluate(() => !!document.querySelector('.wb-work .ct-lane-h') && (document.querySelector('.wb-work').textContent.includes('Lead magnets')))
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  await page.screenshot({ path: `${OUT}/p1-content-${w}.png` })
  await page.evaluate(() => { const el = document.querySelector('.wb-work'); if (el) el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(600)
  const bottomText = await page.evaluate(() => { const el = document.querySelector('.wb-work'); return el ? el.innerText.slice(-400) : '' })
  await page.screenshot({ path: `${OUT}/p1-content-bottom-${w}.png` })

  // MAGNETS route
  await page.goto(`${BASE}#exp/v2/magnets`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(2500)
  const magnetsOk = await page.evaluate(() => document.querySelector('.wb-work')?.textContent.includes('Lead magnets') ?? false)
  const lmCaps = await page.evaluate(() => Array.from(document.querySelectorAll('.wb-cap')).map(c => c.getBoundingClientRect().height))
  await page.screenshot({ path: `${OUT}/p1-magnets-${w}.png` })

  // open a draft window from CONTENT (click first draft card)
  await page.goto(`${BASE}#exp/v2/content`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(2500)
  const opened = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.wb-work [class*="ct-"], .wb-work .row')).filter(el => el.tagName === 'BUTTON' || el.onclick || el.getAttribute('role') === 'button')
    return rows.length
  })
  // click the first draft row via known selectors — try common card class names
  const clicked = await page.evaluate(() => {
    const cands = document.querySelectorAll('.wb-work .ct-card, .wb-work .ct-row, .wb-work [data-draft], .wb-work .row')
    for (const c of cands) { if (c.textContent && c.textContent.length > 20) { c.click(); return c.className } }
    return null
  })
  await page.waitForTimeout(2000)
  const win = await page.evaluate(() => {
    const t = document.querySelector('.wb-takeover, [class*="takeover"], .wb-window, [class*="wb-win"]')
    if (!t) return null
    const r = t.getBoundingClientRect()
    const txt = t.textContent || ''
    return {
      w: r.width, h: r.height,
      hasAsk: !!t.querySelector('.wb-ask'),
      hasEdit: /edit/i.test(txt), hasDelete: /delete/i.test(txt),
      hasClose: !!t.querySelector('button[aria-label*="lose"], .wb-take-x, [class*="close"]'),
      hasIframe: !!t.querySelector('iframe'), hasImg: !!t.querySelector('img'),
    }
  })
  await page.screenshot({ path: `${OUT}/p1-draftwindow-${w}.png` })
  report[w] = { errors: errors.slice(0, 8), caps, hasResourceInContent, overflowX, bottomTail: bottomText.slice(-160), magnetsOk, lmCaps, clicked, win, openedCandidates: opened }
  await page.close()
}
await browser.close()
console.log(JSON.stringify(report, null, 1))
