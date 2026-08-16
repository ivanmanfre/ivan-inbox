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
// 1440: function + persistence
{
  const pg = await (await b.newContext({viewport:{width:1440,height:900}})).newPage()
  await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
  await pg.evaluate(s => { localStorage.clear(); localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, sess)
  await pg.goto('http://localhost:5431/#exp/v2/content', {waitUntil:'domcontentloaded'})
  await pg.reload({waitUntil:'domcontentloaded'})
  await settle(pg)
  const before = await pg.locator('.ct-card').count()
  await pg.locator('.ct-fpill').first().click()
  await pg.waitForTimeout(300)
  const opts = await pg.locator('.wb-fopt').allInnerTexts()
  console.log('options:', JSON.stringify(opts.slice(0,8)))
  await pg.locator('.wb-fopt').nth(1).click()
  await pg.waitForTimeout(600)
  const after = await pg.locator('.ct-card').count()
  const pillText = (await pg.locator('.ct-fpill').first().innerText()).replace(/\n/g,' ')
  console.log(`filter: cards ${before} -> ${after}, pill "${pillText}"`)
  await pg.reload({waitUntil:'domcontentloaded'})
  await settle(pg)
  const afterReload = await pg.locator('.ct-card').count()
  const pill2 = (await pg.locator('.ct-fpill').first().innerText()).replace(/\n/g,' ')
  const lsVal = await pg.evaluate(() => { const k = Object.keys(localStorage).find(k=>k.includes('content')); return k ? `${k} = ${localStorage.getItem(k)}` : 'NONE' })
  console.log(`reload: cards ${afterReload}, pill "${pill2}", ls: ${lsVal}`)
  const clearBtn = pg.locator('.ct-fclear-all')
  if (await clearBtn.count()) { await clearBtn.click(); await pg.waitForTimeout(400) }
  const clearVal = await pg.evaluate(() => Object.keys(localStorage).filter(k=>k.includes('content')).map(k=>`${k}=${localStorage.getItem(k)}`).join('|') || 'NONE')
  console.log('after clear:', clearVal)
  await pg.close()
}
// 390 sheet
{
  const pg = await (await b.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true})).newPage()
  await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
  await pg.evaluate(s => { localStorage.clear(); localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, sess)
  await pg.goto('http://localhost:5431/#exp/v2/content', {waitUntil:'domcontentloaded'})
  await pg.reload({waitUntil:'domcontentloaded'})
  await settle(pg)
  const chrome = await pg.evaluate(() => {
    const fr = [...document.querySelectorAll('.ct-fr')]
    return {rows: fr.map(e=>Math.round(e.getBoundingClientRect().height)), overflowX: document.documentElement.scrollWidth > 390}
  })
  console.log('390 chrome:', JSON.stringify(chrome))
  await pg.locator('.ct-fpill').first().tap()
  await pg.waitForTimeout(500)
  const sheet = await pg.evaluate(() => {
    const s = document.querySelector('.ct-fsheet, .ct-fsheet-scrim > *:not(.ct-fsheet-grab)') || document.querySelector('[class*=fsheet]')
    if (!s) return null
    const box = s.getBoundingClientRect()
    const rows = [...s.querySelectorAll('button.wb-fopt')].map(e=>Math.round(e.getBoundingClientRect().height))
    return {cls: s.className, h: Math.round(box.height), bottom: Math.round(box.bottom), minRow: rows.length?Math.min(...rows):null, nRows: rows.length}
  })
  console.log('sheet:', JSON.stringify(sheet))
  // tap-out closes
  await pg.touchscreen.tap(195, 60)
  await pg.waitForTimeout(400)
  console.log('sheet after tap-out:', await pg.locator('[class*=fsheet]').count())
  await pg.close()
}
await b.close()
