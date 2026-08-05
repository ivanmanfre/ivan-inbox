import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const OUT = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/729ad97b-bb5e-488b-93ec-d60ed7e488e4/scratchpad'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(String(e)))
await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
await page.goto('https://ivanmanfre.github.io/ivan-inbox/#exp/v2/content', { waitUntil: 'networkidle' }).catch(()=>{})
await page.waitForTimeout(5000)
// Mattan lane
await page.getByRole('button', { name: 'Mattan Danino' }).click().catch(()=>{})
await page.waitForTimeout(4000)
const sections = await page.evaluate(() => [...document.querySelectorAll('.wb-sech-t, .wb-sech, h3')].map(e=>e.textContent.trim()).filter(Boolean).slice(0,14))
await page.screenshot({ path: `${OUT}/shot-mattan.png` })
// Ops
await page.goto('https://ivanmanfre.github.io/ivan-inbox/#exp/v2/ops', { waitUntil: 'networkidle' }).catch(()=>{})
await page.waitForTimeout(4500)
const ops = await page.evaluate(() => ({
  summaries: document.body.innerText.includes('Daily summaries'),
  text: [...document.querySelectorAll('.wb-sech-t, .wb-sech')].map(e=>e.textContent.trim()).slice(0,8),
}))
await page.evaluate(() => { const el=[...document.querySelectorAll('*')].find(e=>e.textContent.trim().startsWith('Daily summaries')); el?.scrollIntoView({block:'center'}) })
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/shot-ops.png` })
console.log(JSON.stringify({ mattanSections: sections, ops, errors: errors.slice(0,3) }, null, 1))
await browser.close()
