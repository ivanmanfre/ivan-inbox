import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const OUT = process.argv[2]
const BASE = 'https://ivanmanfre.github.io/ivan-inbox/'
const routes = ['today','inbox','drafts','content','magnets','sends','ops','settings']
const browser = await chromium.launch()
for (const [w,h] of [[1440,900],[390,844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
  await page.goto(BASE, { waitUntil: 'networkidle' }).catch(()=>{})
  await page.waitForTimeout(2500)
  for (const r of routes) {
    await page.goto(`${BASE}#exp/v2/${r}`, { waitUntil: 'domcontentloaded' }).catch(()=>{})
    await page.waitForTimeout(2200)
    await page.screenshot({ path: `${OUT}/cur-${r}-${w}.png` })
    // scrolled mid + bottom for long routes
    const long = ['content','magnets','today','sends'].includes(r)
    if (long) {
      await page.evaluate(() => { const el = document.querySelector('.wb-work'); if (el) el.scrollTop = el.scrollHeight / 2 })
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/cur-${r}-mid-${w}.png` })
      await page.evaluate(() => { const el = document.querySelector('.wb-work'); if (el) el.scrollTop = 1e9 })
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/cur-${r}-bottom-${w}.png` })
    }
  }
  // draft window
  await page.goto(`${BASE}#exp/v2/content`, { waitUntil: 'domcontentloaded' }).catch(()=>{})
  await page.waitForTimeout(2500)
  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.ct-card'))
    const t = cards.find(c => c.textContent.includes('invisible to LLMs')) || cards[0]
    if (t) t.click()
  })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/cur-window-${w}.png` })
  // chat pane focused
  await page.keyboard.press('Escape')
  await page.goto(`${BASE}#exp/v2/inbox/chat`, { waitUntil: 'domcontentloaded' }).catch(()=>{})
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${OUT}/cur-chat-${w}.png` })
  await page.close()
}
await browser.close()
console.log('done')
