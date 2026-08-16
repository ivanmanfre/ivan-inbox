import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('.session.json','utf8')
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: {width:1440,height:900}, deviceScaleFactor:2 })
const p = await ctx.newPage()
await p.addInitScript(([k,v])=>localStorage.setItem(k,v), ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
await p.addInitScript(()=>localStorage.setItem('inbox-theme','dark'))
await p.goto('http://localhost:5444/#exp/v2/content', {waitUntil:'domcontentloaded'})
await p.waitForTimeout(3500)
const out = await p.evaluate(() => {
  const all = [...document.querySelectorAll('*')]
  const res = []
  for (const el of all) {
    const s = getComputedStyle(el)
    if (el.scrollHeight > el.clientHeight + 5 && el.clientHeight > 100) {
      res.push({ tag: el.tagName, cls: (el.className||'').toString().slice(0,60), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: s.overflowY })
    }
  }
  return res.slice(0,20)
})
console.log(JSON.stringify(out, null, 2))
await b.close()
