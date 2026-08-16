import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
const b = await chromium.launch()
const pg = await (await b.newContext({viewport:{width:1440,height:900}})).newPage()
await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
await pg.evaluate(s => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), sess)
await pg.goto('http://localhost:5431/#exp/v2/today', {waitUntil:'domcontentloaded'})
await pg.reload({waitUntil:'domcontentloaded'})
let prev=''
for (let i=0;i<40;i++){
  await pg.waitForTimeout(500)
  const t = await pg.innerText('body')
  if (!t.includes('Loading') && t.length>500 && t===prev) break
  prev=t
}
const zone = await pg.locator('#td-z2').innerText()
console.log(zone.split('\n').filter(l=>l.includes('waiting')||l.includes('owed')||l.includes('target')).join('\n'))
await b.close()
