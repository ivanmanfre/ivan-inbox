import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const OUT = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/729ad97b-bb5e-488b-93ec-d60ed7e488e4/scratchpad'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).slice(0,160)))
await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
await page.goto('https://ivanmanfre.github.io/ivan-inbox/#exp/v2/content', { waitUntil: 'networkidle' }).catch(()=>{})
await page.waitForTimeout(6000)
console.log('before', JSON.stringify(await page.evaluate(() => ({
  hash: location.hash,
  reviewCards: document.querySelectorAll('#wb-s-review .ct-card').length,
  anyCard: document.querySelectorAll('.ct-card').length,
  firstCardCls: document.querySelector('.ct-card')?.className,
}))))
const target = page.locator('#wb-s-review .ct-card').first()
await target.scrollIntoViewIfNeeded()
await target.click({ timeout: 8000 }).catch(e => console.log('clickfail', String(e).slice(0,120)))
await page.waitForTimeout(3500)
console.log('after', JSON.stringify(await page.evaluate(() => ({
  hash: location.hash,
  tk: !!document.querySelector('.wb-tk'),
  scrim: !!document.querySelector('.wb-tkscrim'),
  dialog: !!document.querySelector('[role=dialog]'),
}))), 'errs', JSON.stringify(errs))
await page.screenshot({ path: `${OUT}/diag.png` })
await browser.close()
