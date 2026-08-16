import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase4-shots'
const b = await chromium.launch()
const pg = await (await b.newContext({viewport:{width:1440,height:900}})).newPage()
const errs = []
pg.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,150)) })
await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
await pg.evaluate(s => { localStorage.clear(); localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, sess)
await pg.goto('http://localhost:5431/#exp/v2/today', {waitUntil:'domcontentloaded'})
await pg.reload({waitUntil:'domcontentloaded'})
await pg.waitForTimeout(6000)
await pg.locator('.cfield').fill('Reply with exactly: PANE OK')
await pg.locator('.cfield').press('Enter')
const t0 = Date.now()
let done = false, secs = 0
for (let i=0;i<300;i++){
  await pg.waitForTimeout(1000)
  const busy = await pg.locator('.wb-stop').count()
  const t = await pg.innerText('body')
  if (!busy && t.includes('PANE OK')) { done = true; secs = Math.round((Date.now()-t0)/1000); break }
}
console.log('turn completed:', done, 'in', secs, 's')
await pg.screenshot({path:`${OUT}/turn-4-done.png`})
// now /clear on a COMPLETED turn
await pg.locator('.cfield').fill('/clear')
await pg.waitForTimeout(300)
const clearOpts = await pg.locator('.wb-pal-opt, [class*=pal]').allInnerTexts().catch(()=>[])
console.log('palette for /clear:', JSON.stringify(clearOpts.slice(0,3)))
await pg.locator('.cfield').press('Enter')
await pg.waitForTimeout(600)
const after = await pg.innerText('body')
console.log('cleared:', !after.includes('PANE OK'))
await pg.screenshot({path:`${OUT}/turn-6-cleared.png`})
console.log('console errors:', errs.length, JSON.stringify(errs.slice(0,3)))
await b.close()
