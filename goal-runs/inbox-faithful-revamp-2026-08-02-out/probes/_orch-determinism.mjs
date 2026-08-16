import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
const b = await chromium.launch()
const pg = await (await b.newContext({viewport:{width:1440,height:900}})).newPage()
async function settle(pg){
  let prev=''
  for (let i=0;i<40;i++){
    await pg.waitForTimeout(500)
    const t = await pg.innerText('body').catch(()=> '')
    if (t && !t.includes('Loading') && t.length>500 && t===prev) return
    prev=t
  }
}
await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
await pg.evaluate(s => { localStorage.clear(); localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, sess)
await pg.goto('http://localhost:5431/#exp/v2/content', {waitUntil:'domcontentloaded'})
await pg.reload({waitUntil:'domcontentloaded'})
await settle(pg)
await pg.locator('.ct-fpill').first().click()
await pg.waitForTimeout(300)
await pg.locator('.wb-fopt').nth(1).click()
await pg.waitForTimeout(800)
const before = await pg.locator('.ct-card').count()
await pg.reload({waitUntil:'domcontentloaded'})
await settle(pg)
const after = await pg.locator('.ct-card').count()
console.log(`filtered cards pre-reload ${before}, post-reload ${after}, deterministic: ${before === after}`)
await pg.locator('.ct-fclear-all').click().catch(()=>{})
await b.close()
