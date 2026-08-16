import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
const b = await chromium.launch()
const pg = await (await b.newContext({viewport:{width:1440,height:900}})).newPage()
pg.on('request', r => { if (r.url().includes('inbox-claude')) console.log('REQ', r.method(), 'bodyChars:', (r.postData()||'').length) })
pg.on('response', async r => {
  if (r.url().includes('inbox-claude')) {
    console.log('RES', r.status(), JSON.stringify(Object.fromEntries(Object.entries(await r.allHeaders()).filter(([k])=>k.startsWith('x-broker')||k==='content-type'))))
  }
})
await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
await pg.evaluate(s => { localStorage.clear(); localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, sess)
await pg.goto('http://localhost:5431/#exp/v2/today', {waitUntil:'domcontentloaded'})
await pg.reload({waitUntil:'domcontentloaded'})
await pg.waitForTimeout(6000)
await pg.locator('.cfield').fill('Reply with exactly: NET OK')
await pg.locator('.cfield').press('Enter')
for (let i=0;i<40;i++){
  await pg.waitForTimeout(1000)
  const busy = await pg.locator('.wb-stop').count()
  if (i % 5 === 0) {
    const turns = await pg.evaluate(() => document.querySelectorAll('.cb, [class*=turn], .wb-turn').length)
    console.log(`t=${i}s busy=${busy}`)
  }
  if (!busy) { console.log('idle at', i, 's'); break }
}
const body = await pg.innerText('body')
console.log('NET OK present:', body.includes('NET OK'))
// dump the last assistant bubble text if any
const bubbles = await pg.evaluate(() => [...document.querySelectorAll('[class*=msg],[class*=bubble],[class*=cb]')].slice(-3).map(e=>e.className+': '+e.textContent.slice(0,80)))
console.log(JSON.stringify(bubbles, null, 1))
await b.close()
