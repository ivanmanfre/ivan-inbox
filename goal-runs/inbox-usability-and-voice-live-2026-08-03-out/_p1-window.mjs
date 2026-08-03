import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-usability-and-voice-live-2026-08-03-out/phase1-shots'
const BASE = 'https://ivanmanfre.github.io/ivan-inbox/'
const browser = await chromium.launch()
const rep = {}
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
  await page.goto(`${BASE}#exp/v2/content`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(3000)
  await page.evaluate(() => { const c = document.querySelector('.ct-card'); if (c) c.click() })
  await page.waitForTimeout(2500)
  const win = await page.evaluate(() => {
    const t = document.querySelector('.wb-tk')
    if (!t) return null
    const col = t.querySelector('.wb-tk-col')
    const x = t.querySelector('.wb-tk-x')
    const xr = x ? x.getBoundingClientRect() : null
    const txt = t.innerText || ''
    return {
      tkW: Math.round(t.getBoundingClientRect().width),
      colW: col ? Math.round(col.getBoundingClientRect().width) : null,
      closeSize: xr ? [Math.round(xr.width), Math.round(xr.height)] : null,
      hasAsk: !!t.querySelector('.wb-ask'),
      editBtn: /\bEdit\b/.test(txt), deleteBtn: /\bDelete\b/.test(txt), skipBtn: /\bSkIP\b/i.test(txt),
      hasIframe: !!t.querySelector('iframe'),
      imgCount: t.querySelectorAll('img').length,
      firstBlocks: txt.slice(0, 200),
    }
  })
  await page.screenshot({ path: `${OUT}/p1-window-${w}.png` })
  // Esc closes?
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  const escClosed = await page.evaluate(() => !document.querySelector('.wb-tk'))
  // magnets window
  await page.goto(`${BASE}#exp/v2/magnets`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(2500)
  const lmClicked = await page.evaluate(() => { const c = document.querySelector('.res-row, .ct-card, .res-card'); if (c) { c.click(); return c.className } return null })
  await page.waitForTimeout(2000)
  const lmWin = await page.evaluate(() => {
    const t = document.querySelector('.wb-tk'); if (!t) return null
    return { hasIframe: !!t.querySelector('iframe'), head: (t.querySelector('.wb-pane-n')?.textContent) }
  })
  await page.screenshot({ path: `${OUT}/p1-lmwindow-${w}.png` })
  rep[w] = { errors, win, escClosed, lmClicked, lmWin }
  await page.close()
}
await browser.close()
console.log(JSON.stringify(rep, null, 1))
