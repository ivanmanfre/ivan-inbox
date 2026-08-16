import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
const b = await chromium.launch()
const pg = await (await b.newContext({viewport:{width:1440,height:900}})).newPage()
const errs=[]
pg.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,120)) })
await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
await pg.evaluate(s => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, sess)
await pg.goto('http://localhost:5431/#exp/v2/content', {waitUntil:'domcontentloaded'})
await pg.reload({waitUntil:'domcontentloaded'})
await pg.waitForTimeout(6000)
// visual identity check: chips look right (button reset held)
const chip = await pg.evaluate(() => {
  const c = document.querySelector('.chip')
  const cs = getComputedStyle(c)
  return {tag: c.tagName, padding: cs.padding, borderRadius: cs.borderRadius, bg: cs.backgroundColor, font: cs.fontSize+'/'+cs.fontWeight}
})
console.log('chip:', JSON.stringify(chip))
// hover diff
const chipEl = pg.locator('.chip:not(.on)').first()
const before = await chipEl.evaluate(e => getComputedStyle(e).backgroundColor)
await chipEl.hover(); await pg.waitForTimeout(250)
const after = await chipEl.evaluate(e => getComputedStyle(e).backgroundColor)
console.log('chip hover:', before, '->', after, before !== after ? 'SHIFTS' : 'NO SHIFT')
// keyboard reach: tab until a .chip/.btn gets focus ring
const reach = await pg.evaluate(() => {
  const interesting = ['chip','btn','sg','csend','wb-sech','cmic','ct-fpill']
  const found = []
  const all = [...document.querySelectorAll('button')]
  for (const b of all) {
    const cls = b.className || ''
    if (interesting.some(k => String(cls).includes(k))) found.push(String(cls).split(' ')[0])
  }
  return {buttonCount: all.length, classes: [...new Set(found)].slice(0,12)}
})
console.log('buttons:', JSON.stringify(reach))
// focus ring renders on a chip
await chipEl.focus()
const ring = await chipEl.evaluate(e => getComputedStyle(e).outline)
console.log('focused chip outline (programmatic focus, ring is :focus-visible so may be none):', ring)
// approve buttons are buttons
const ab = await pg.evaluate(() => {
  const btn = document.querySelector('.ct-ac .btn')
  return btn ? btn.tagName : 'NONE-VISIBLE'
})
console.log('review action tag:', ab)
console.log('console errors:', errs.length)
await b.close()
