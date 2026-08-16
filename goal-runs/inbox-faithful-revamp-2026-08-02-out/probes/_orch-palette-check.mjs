import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
const b = await chromium.launch()
const pg = await (await b.newContext({viewport:{width:1440,height:900}})).newPage()
await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
await pg.evaluate(s => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), sess)
await pg.goto('http://localhost:5431/#exp/v2/today', {waitUntil:'domcontentloaded'})
await pg.reload({waitUntil:'domcontentloaded'})
await pg.waitForTimeout(5000)
for (const q of ['/model haiku', '/ret', '/cle', '/']) {
  await pg.locator('.cfield').fill(q)
  await pg.waitForTimeout(250)
  const names = await pg.locator('.wb-pal-n').allInnerTexts().catch(()=>[])
  console.log(JSON.stringify(q), '->', JSON.stringify(names))
}
await b.close()
