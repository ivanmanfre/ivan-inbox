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
  const html = document.documentElement, body = document.body
  const cards = document.querySelectorAll('.ct-card:not(.ct-idea)')
  const last = cards[cards.length-1]
  const rect = last ? last.getBoundingClientRect() : null
  return {
    htmlScrollH: html.scrollHeight, htmlClientH: html.clientHeight,
    bodyScrollH: body.scrollHeight, bodyClientH: body.clientHeight,
    cardCount: cards.length,
    lastCardTop: rect ? rect.top : null, lastCardBottom: rect? rect.bottom: null,
    windowInnerHeight: window.innerHeight,
  }
})
console.log(JSON.stringify(out, null, 2))
await b.close()
