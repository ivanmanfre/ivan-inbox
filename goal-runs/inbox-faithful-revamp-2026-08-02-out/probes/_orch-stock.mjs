import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
const b = await chromium.launch()
for (const vp of [{w:1440,h:900,tag:'desktop'},{w:390,h:844,tag:'mobile',mobile:true}]) {
  const ctx = await b.newContext({viewport:{width:vp.w,height:vp.h}, isMobile:!!vp.mobile, hasTouch:!!vp.mobile})
  const pg = await ctx.newPage()
  const errs=[]
  pg.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,100)) })
  await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
  await pg.evaluate(s => { localStorage.clear(); localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, sess)
  for (const h of ['#today','#inbox','#drafts','#sends','#ops','#settings']) {
    await pg.goto('http://localhost:5431/'+h, {waitUntil:'domcontentloaded'})
    await pg.reload({waitUntil:'domcontentloaded'})
    await pg.waitForTimeout(3500)
    const t = await pg.innerText('body').catch(()=> '')
    const ovf = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    console.log(vp.tag, h, 'chars:', t.length, 'ovf:', ovf, 'errs:', errs.length)
  }
  await pg.screenshot({path:`/tmp/stock-${vp.tag}.png`})
  await pg.close()
}
await b.close()
