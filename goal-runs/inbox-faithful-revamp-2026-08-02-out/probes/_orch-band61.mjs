import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
const b = await chromium.launch()
const pg = await (await b.newContext({viewport:{width:1440,height:900}})).newPage()
await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
await pg.evaluate(s => { localStorage.clear(); localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, sess)
await pg.goto('http://localhost:5431/#exp/v2/content', {waitUntil:'domcontentloaded'})
await pg.reload({waitUntil:'domcontentloaded'})
await pg.waitForTimeout(8000)
const out = await pg.evaluate(() => {
  const rows = [...document.querySelectorAll('.ct-card')]
  const hist = {}
  const tall = []
  for (const r of rows) {
    const cs = getComputedStyle(r)
    const h = r.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth)
    const hh = Math.round(h)
    hist[hh] = (hist[hh]||0)+1
    if (hh > 60) tall.push({h: hh, cls: r.className, text: r.textContent.slice(0,60), childHs: [...r.children].map(c=>`${c.className.split(' ')[0]}:${Math.round(c.getBoundingClientRect().height)}`)})
  }
  return {hist, tall: tall.slice(0,4)}
})
console.log(JSON.stringify(out, null, 1))
await b.close()
