import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const OUT = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/729ad97b-bb5e-488b-93ec-d60ed7e488e4/scratchpad'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
await page.goto('https://ivanmanfre.github.io/ivan-inbox/#exp/v2/content', { waitUntil: 'networkidle' }).catch(()=>{})
await page.waitForTimeout(6000)
// open the first review card
await page.locator('.ct-card').first().click()
await page.waitForTimeout(4000)
// open the Generation register section
const secs = await page.evaluate(() => [...document.querySelectorAll('.dw-sec-n')].map(e=>e.textContent.trim()))
const reg = page.locator('.dw-sec-b', { hasText: 'Generation register' })
await reg.click().catch(()=>{})
await page.waitForTimeout(1200)
await reg.scrollIntoViewIfNeeded().catch(()=>{})
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/shot-log-now.png` })
const info = await page.evaluate(() => ({
  entries: document.querySelectorAll('.dd-logc').length,
  agents: [...document.querySelectorAll('.dd-log-agent')].map(e=>e.textContent.trim()),
  previews: [...document.querySelectorAll('.dd-logc-p')].slice(0,6).map(e=>e.textContent.trim().slice(0,110)),
}))
console.log(JSON.stringify({ secs, info }, null, 1))
await browser.close()
