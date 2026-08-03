import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-usability-and-voice-live-2026-08-03-out/phase1-shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))
await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
await page.goto('http://localhost:4173/#exp/v2/content', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(3000)
const found = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.ct-card'))
  const t = cards.find(c => c.textContent.includes('invisible to LLMs answering buyer questions'))
  if (t) { t.click(); return true }
  return cards.length
})
await page.waitForTimeout(3000)
const win = await page.evaluate(() => {
  const t = document.querySelector('.wb-tk')
  if (!t) return null
  const ifr = t.querySelector('iframe')
  const img = t.querySelector('img')
  const body = t.querySelector('.wb-tk-body')
  // order: does the first img appear before the iframe, and both before the POST block?
  const order = []
  t.querySelectorAll('img, iframe, .dd-pre').forEach(el => order.push(el.tagName + (el.className ? '.' + el.className.split(' ')[0] : '')))
  return {
    found: true,
    hasIframe: !!ifr, iframeH: ifr ? Math.round(ifr.getBoundingClientRect().height) : null,
    imgCount: t.querySelectorAll('img').length,
    firstImgW: img ? Math.round(img.getBoundingClientRect().width) : null,
    order: order.slice(0, 6),
    scrollH: body ? body.scrollHeight : null,
  }
})
await page.screenshot({ path: `${OUT}/p1-window-media-top.png` })
await page.evaluate(() => { const b = document.querySelector('.wb-tk-body'); if (b) b.scrollTop = 900 })
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/p1-window-media-mid.png` })
console.log(JSON.stringify({ found, win, errors }, null, 1))
await browser.close()
