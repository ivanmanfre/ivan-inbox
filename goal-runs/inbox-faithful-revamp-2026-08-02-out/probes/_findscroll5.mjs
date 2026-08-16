import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('.session.json','utf8')
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: {width:1440,height:900}, deviceScaleFactor:2 })
const p = await ctx.newPage()
await p.addInitScript(([k,v])=>localStorage.setItem(k,v), ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
await p.addInitScript(()=>localStorage.setItem('inbox-theme','dark'))
await p.goto('http://localhost:5444/#exp/v2/content', {waitUntil:'domcontentloaded'})
await p.waitForTimeout(6000)
const out = await p.evaluate(() => {
  const el = document.querySelector('.rows.ct-rows') || document.querySelector('.ct-rows')
  if (!el) return { found: false, all_rows: [...document.querySelectorAll('.rows')].map(e=>e.className) }
  const s = getComputedStyle(el)
  return {
    found: true, cls: el.className, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
    overflowY: s.overflowY, display: s.display, height: s.height, flex: s.flex,
  }
})
console.log(JSON.stringify(out, null, 2))
await b.close()
