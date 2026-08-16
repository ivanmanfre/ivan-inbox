import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
const b = await chromium.launch()
const pg = await (await b.newContext({viewport:{width:1440,height:900}})).newPage()
pg.on('console', m => { const t = m.text(); if (t.startsWith('[uc]')) console.log(t) })
await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
await pg.evaluate(s => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), sess)
await pg.goto('http://localhost:5431/#exp/v2/today', {waitUntil:'domcontentloaded'})
await pg.reload({waitUntil:'domcontentloaded'})
await pg.waitForTimeout(6000)
await pg.locator('.cfield').fill('Reply with exactly: TRACE OK')
await pg.locator('.cfield').press('Enter')
for (let i=0;i<40;i++){
  await pg.waitForTimeout(1000)
  if (!(await pg.locator('.wb-stop').count())) { console.log('IDLE at', i, 's'); break }
}
console.log('still busy:', await pg.locator('.wb-stop').count())
await b.close()
