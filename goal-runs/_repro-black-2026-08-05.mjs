import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const OUT = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/729ad97b-bb5e-488b-93ec-d60ed7e488e4/scratchpad'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const browser = await chromium.launch()
for (const [w, h, tag] of [[1440,900,'1440'], [1920,1080,'1920'], [2560,1440,'2560']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
  await page.goto('https://ivanmanfre.github.io/ivan-inbox/#exp/v2/content', { waitUntil: 'networkidle' }).catch(()=>{})
  await page.waitForTimeout(6000)
  const t = page.locator('#wb-s-review .ct-card').first()
  await t.scrollIntoViewIfNeeded(); await t.click({ timeout: 8000 }).catch(e => console.log(tag, 'click fail', String(e).slice(0,80)))
  await page.waitForTimeout(3500)
  const m = await page.evaluate(() => {
    const tk = document.querySelector('.wb-tk'), cols = document.querySelector('.dw-cols')
    const r = e => e ? { w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) } : null
    const main = document.querySelector('.dw-main')
    return { tk: r(tk), cols: r(cols), main: r(main), insp: r(document.querySelector('.dw-insp')),
             tkOpen: !!tk, gridCols: cols ? getComputedStyle(cols).gridTemplateColumns : null,
             bodyOverflow: document.querySelector('.wb-tk-body') ? getComputedStyle(document.querySelector('.wb-tk-body')).overflow : null }
  })
  console.log(tag, JSON.stringify(m))
  await page.screenshot({ path: `${OUT}/black-${tag}.png` })
  await page.close()
}
await browser.close()
