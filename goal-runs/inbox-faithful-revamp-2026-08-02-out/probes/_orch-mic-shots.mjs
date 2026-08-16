import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase5-shots'
async function settle(pg){
  let prev=''
  for (let i=0;i<40;i++){
    await pg.waitForTimeout(500)
    const t = await pg.innerText('body').catch(()=> '')
    if (t && !t.includes('Loading') && t.length>400 && t===prev) return
    prev=t
  }
}
const b = await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']})
// 1440
{
  const ctx = await b.newContext({viewport:{width:1440,height:900}, permissions:['microphone']})
  const pg = await ctx.newPage()
  await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
  await pg.evaluate(s => { localStorage.clear(); localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, sess)
  await pg.goto('http://localhost:5431/#exp/v2/today', {waitUntil:'domcontentloaded'})
  await pg.reload({waitUntil:'domcontentloaded'})
  await settle(pg)
  const mic = pg.locator('.cmic')
  console.log('mic present 1440:', await mic.count())
  const comp = pg.locator('.wb-composer')
  await comp.screenshot({path:`${OUT}/mic-rest-1440.png`})
  // recording state
  await mic.click()
  await pg.waitForTimeout(1400)
  const cls = await mic.getAttribute('class')
  console.log('recording class:', cls)
  await comp.screenshot({path:`${OUT}/mic-recording-1440.png`})
  await mic.click() // stop -> transcribing -> idle (fake device = silence -> 422 note)
  await pg.waitForTimeout(4000)
  const ph = await pg.locator('.cfield').getAttribute('placeholder')
  console.log('placeholder after silence:', ph)
  await comp.screenshot({path:`${OUT}/mic-after-silence-1440.png`})
  await pg.close()
}
// 390
{
  const ctx = await b.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true, permissions:['microphone']})
  const pg = await ctx.newPage()
  await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
  await pg.evaluate(s => { localStorage.clear(); localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, sess)
  await pg.goto('http://localhost:5431/#exp/v2/claude', {waitUntil:'domcontentloaded'}).catch(()=>{})
  await pg.reload({waitUntil:'domcontentloaded'})
  await settle(pg)
  let mic = pg.locator('.cmic')
  if (!(await mic.count())) {
    // find the claude tab in the rail
    const tab = pg.locator('text=Claude').first()
    if (await tab.count()) { await tab.tap(); await pg.waitForTimeout(1500) }
    mic = pg.locator('.cmic')
  }
  console.log('mic present 390:', await mic.count())
  if (await mic.count()) {
    const box = await mic.boundingBox()
    console.log('mic hit box:', JSON.stringify(box))
    await pg.screenshot({path:`${OUT}/mic-390.png`})
  } else {
    await pg.screenshot({path:`${OUT}/mic-390-missing.png`})
  }
  await pg.close()
}
await b.close()
