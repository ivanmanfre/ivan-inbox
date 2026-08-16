import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const OUT = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/729ad97b-bb5e-488b-93ec-d60ed7e488e4/scratchpad'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const browser = await chromium.launch()
for (const [w,h,tag] of [[1440,900,'1440'],[2560,1440,'2560']]) {
  const page = await browser.newPage({ viewport:{width:w,height:h} })
  await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
  await page.goto('https://ivanmanfre.github.io/ivan-inbox/#exp/v2/content',{waitUntil:'networkidle'}).catch(()=>{})
  await page.waitForTimeout(6000)
  const t = page.locator('#wb-s-review .ct-card').first()
  await t.scrollIntoViewIfNeeded(); await t.click({timeout:8000}).catch(()=>{})
  await page.waitForTimeout(3500)
  // open the register
  await page.locator('.dw-sec-b', { hasText:'Generation register' }).click().catch(()=>{})
  await page.waitForTimeout(1200)
  const m = await page.evaluate(() => {
    const r = e => e ? Math.round(e.getBoundingClientRect().width) : null
    return {
      tkW: r(document.querySelector('.wb-tk')), vw: innerWidth,
      inspW: r(document.querySelector('.dw-insp')), mainW: r(document.querySelector('.dw-main')),
      groups: document.querySelectorAll('.dd-agrp').length,
      entries: document.querySelectorAll('.dd-agrp .dd-logc').length,
      regTail: document.querySelector('.dw-sec-b')?.parentElement?.textContent?.slice(0,0),
      names: [...document.querySelectorAll('.dd-agrp .dd-log-agent')].map(e=>e.textContent.trim()),
      runs: [...document.querySelectorAll('.dd-agrp-s .ct-chip')].map(e=>e.textContent.trim()).slice(0,10),
    }
  })
  console.log(tag, JSON.stringify(m))
  await page.screenshot({ path:`${OUT}/v-${tag}.png` })
  if (tag==='2560') {
    await page.locator('.dd-agrp').first().click().catch(()=>{})
    await page.waitForTimeout(600)
    await page.screenshot({ path:`${OUT}/v-2560-open.png` })
  }
  await page.close()
}
await browser.close()
