import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase4-shots'
async function settle(pg){
  let prev=''
  for (let i=0;i<40;i++){
    await pg.waitForTimeout(500)
    const t = await pg.innerText('body').catch(()=> '')
    if (t && !t.includes('Loading') && t.length>400 && t===prev) return
    prev=t
  }
}
const b = await chromium.launch()
const pg = await (await b.newContext({viewport:{width:1440,height:900}})).newPage()
const errs = []
pg.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,150)) })
const failed = []
pg.on('requestfailed', r => failed.push(`${r.method()} ${r.url().slice(0,90)}`))
await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
await pg.evaluate(s => { localStorage.clear(); localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, sess)
await pg.goto('http://localhost:5431/#exp/v2/today', {waitUntil:'domcontentloaded'})
await pg.reload({waitUntil:'domcontentloaded'})
await settle(pg)
// the Claude peer should be docked on desktop; find the composer
const fieldN = await pg.locator('.cfield').count()
console.log('composer present:', fieldN)
await pg.screenshot({path:`${OUT}/turn-1-pane.png`})
// type and send a REAL prompt
await pg.locator('.cfield').fill('Reply with exactly: PANE OK')
await pg.screenshot({path:`${OUT}/turn-2-typed.png`})
await pg.locator('.cfield').press('Enter')
// wait for streaming to finish: watch for the reply text or error
let done = false
for (let i=0;i<120;i++){
  await pg.waitForTimeout(1000)
  const t = await pg.innerText('body')
  if (i===4) await pg.screenshot({path:`${OUT}/turn-3-inflight.png`})
  if (t.includes('PANE OK') && !(await pg.locator('.wb-stop').count())) { done = true; break }
}
console.log('turn completed:', done)
await pg.screenshot({path:`${OUT}/turn-4-done.png`})
// /clear via palette
await pg.locator('.cfield').fill('/clear')
await pg.waitForTimeout(300)
await pg.screenshot({path:`${OUT}/turn-5-palette-clear.png`})
await pg.locator('.cfield').press('Enter')
await pg.waitForTimeout(500)
const bodyAfter = await pg.innerText('body')
console.log('transcript cleared:', !bodyAfter.includes('PANE OK'))
await pg.screenshot({path:`${OUT}/turn-6-cleared.png`})
// /model palette still filters
await pg.locator('.cfield').fill('/model haiku')
await pg.waitForTimeout(300)
const opts = await pg.locator('.wb-pal-n').allInnerTexts().catch(()=>[])
console.log('palette options for "/model haiku":', JSON.stringify(opts))
await pg.locator('.cfield').fill('')
console.log('console errors during whole flow:', errs.length, JSON.stringify(errs.slice(0,4)))
console.log('failed requests:', failed.length, JSON.stringify(failed.slice(0,4)))
await b.close()
