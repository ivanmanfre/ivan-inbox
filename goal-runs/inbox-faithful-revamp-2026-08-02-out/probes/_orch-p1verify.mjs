import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
async function settle(pg){
  let prev=''
  for (let i=0;i<50;i++){
    await pg.waitForTimeout(500)
    const t = await pg.innerText('body').catch(()=> '')
    if (t && !t.includes('Loading') && t.length>500 && t===prev) return true
    prev=t
  }
  return false
}
const b = await chromium.launch()

// --- 1440 desktop ---
{
  const pg = await (await b.newContext({viewport:{width:1440,height:900}})).newPage()
  const errs=[]
  pg.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,120)) })
  await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
  await pg.evaluate(s => { localStorage.clear(); localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, sess)
  await pg.goto('http://localhost:5431/#exp/v2/content', {waitUntil:'domcontentloaded'})
  await pg.reload({waitUntil:'domcontentloaded'})
  console.log('settled:', await settle(pg))
  const m = await pg.evaluate(() => {
    const r = {}
    const fr = document.querySelectorAll('.ct-fr')
    r.filterRows = [...fr].map(e => ({h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width)}))
    const card = document.querySelector('.ct-card')
    r.firstCardY = card ? Math.round(card.getBoundingClientRect().top + (document.querySelector('.rows.ct-rows')?.scrollTop ?? 0)) : null
    r.oldWallChips = document.querySelectorAll('.ct-f').length
    r.pills = document.querySelectorAll('.ct-fpill').length
    // visible cards in first viewport
    r.cardsInViewport = [...document.querySelectorAll('.ct-card')].filter(c => { const b=c.getBoundingClientRect(); return b.top>=0 && b.bottom<=900 }).length
    return r
  })
  console.log('1440:', JSON.stringify(m))
  // function: open first pill, click an option, count rows before/after
  const before = await pg.locator('.ct-card').count()
  await pg.locator('.ct-fpill').first().click()
  await pg.waitForTimeout(300)
  const optCount = await pg.locator('.ct-fn').count()
  const optTexts = await pg.locator('.ct-fn').allInnerTexts()
  console.log('panel options:', optCount, JSON.stringify(optTexts.slice(0,6)))
  // pick an option that isn't "all" — take index 1
  await pg.locator('.ct-fn').nth(1).click()
  await pg.waitForTimeout(600)
  const after = await pg.locator('.ct-card').count()
  const pillText = await pg.locator('.ct-fpill').first().innerText()
  console.log(`filter applied: cards ${before} -> ${after}, pill now "${pillText.replace(/\n/g,' ')}"`)
  // persistence: reload
  await pg.reload({waitUntil:'domcontentloaded'})
  await settle(pg)
  const afterReload = await pg.locator('.ct-card').count()
  const pillText2 = await pg.locator('.ct-fpill').first().innerText().catch(()=> 'GONE')
  const lsKeys = await pg.evaluate(() => Object.keys(localStorage).filter(k=>k.includes('content')))
  const lsVal = await pg.evaluate(() => { const k = Object.keys(localStorage).find(k=>k.includes('content.posts')); return k ? localStorage.getItem(k) : null })
  console.log(`after reload: cards ${afterReload}, pill "${pillText2.replace(/\n/g,' ')}", ls keys ${JSON.stringify(lsKeys)}, val ${lsVal}`)
  // clear all
  const clearBtn = pg.locator('.ct-fclear-all')
  if (await clearBtn.count()) { await clearBtn.click(); await pg.waitForTimeout(400) }
  const cleared = await pg.evaluate(() => { const k = Object.keys(localStorage).find(k=>k.includes('content.posts')); return k ? localStorage.getItem(k) : null })
  console.log('after clear-all, ls val:', cleared)
  console.log('console errors 1440:', errs.length, errs.slice(0,3))
  await pg.close()
}

// --- 390 mobile ---
{
  const ctx = await b.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true})
  const pg = await ctx.newPage()
  const errs=[]
  pg.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,120)) })
  await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
  await pg.evaluate(s => { localStorage.clear(); localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, sess)
  await pg.goto('http://localhost:5431/#exp/v2/content', {waitUntil:'domcontentloaded'})
  await pg.reload({waitUntil:'domcontentloaded'})
  await settle(pg)
  const m = await pg.evaluate(() => {
    const r = {}
    const fr = document.querySelector('.ct-fr')
    r.chromeH = fr ? Math.round(fr.getBoundingClientRect().height) : null
    r.overflowX = document.documentElement.scrollWidth > 390 || document.body.scrollWidth > 390
    const pills = document.querySelector('.ct-fpills')
    r.pillsScrollable = pills ? pills.scrollWidth > pills.clientWidth : null
    return r
  })
  console.log('390:', JSON.stringify(m))
  // open sheet
  await pg.locator('.ct-fpill').first().tap()
  await pg.waitForTimeout(400)
  const sheet = await pg.evaluate(() => {
    const pop = document.querySelector('.ct-fpop, .ct-fmenu')
    if (!pop) return null
    const b = pop.getBoundingClientRect()
    const rows = [...pop.querySelectorAll('button, .ct-fn')].map(e => Math.round(e.getBoundingClientRect().height))
    return {h: Math.round(b.height), bottom: Math.round(b.bottom), minRow: Math.min(...rows), isSheet: b.bottom > 800}
  })
  console.log('sheet:', JSON.stringify(sheet))
  console.log('console errors 390:', errs.length)
  await pg.close()
}
await b.close()
