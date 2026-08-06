import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))
await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
await page.goto('https://ivanmanfre.github.io/ivan-inbox/#exp/v2/inbox/chat', { waitUntil: 'networkidle' }).catch(()=>{})
await page.waitForTimeout(3000)
const has = await page.evaluate(() => ({
  mic: !!document.querySelector('.cmic, [class*="mic"]'),
  live: !!document.querySelector('.clive'),
  composer: !!document.querySelector('.wb-composer, textarea, input[placeholder*="Claude"]'),
}))
// ⌘D listener: press and see state class change
await page.keyboard.press('Meta+d')
await page.waitForTimeout(800)
const micActive = await page.evaluate(() => !!document.querySelector('[class*="rec"], [class*="listening"], .cmic.on'))
await page.keyboard.press('Meta+d')
console.log(JSON.stringify({ has, micActiveAfterCmdD: micActive, errors: errors.slice(0,5) }))
await browser.close()
