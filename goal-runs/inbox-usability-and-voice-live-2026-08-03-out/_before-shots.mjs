import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const OUT = process.argv[2]
const BASE = 'https://ivanmanfre.github.io/ivan-inbox/'
const routes = ['today','inbox','drafts','content','sends','ops','settings']
const browser = await chromium.launch()
for (const [w,h] of [[1440,900],[390,844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
  await page.goto(BASE, { waitUntil: 'networkidle' }).catch(()=>{})
  await page.waitForTimeout(2500)
  for (const r of routes) {
    await page.goto(`${BASE}#exp/v2/${r}`, { waitUntil: 'domcontentloaded' }).catch(()=>{})
    await page.waitForTimeout(2200)
    await page.screenshot({ path: `${OUT}/before-${r}-${w}.png` })
  }
  // content scrolled to bottom (the LM section Ivan complained about)
  await page.goto(`${BASE}#exp/v2/content`, { waitUntil: 'domcontentloaded' }).catch(()=>{})
  await page.waitForTimeout(2200)
  await page.evaluate(() => { const el = document.querySelector('.wb-work'); if (el) el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/before-content-bottom-${w}.png` })
  console.log(`${w}px done; console errors: ${errors.length}`)
  errors.slice(0,5).forEach(e => console.log('  ERR', e.slice(0,150)))
  await page.close()
}
await browser.close()
