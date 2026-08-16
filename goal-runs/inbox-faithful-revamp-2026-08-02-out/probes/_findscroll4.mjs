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
  const html = document.documentElement, body = document.body
  const all = document.querySelectorAll('.ct-card')
  const wbWork = document.querySelector('.wb-work')
  const wbEl = document.querySelector('.wb')
  return {
    htmlScrollH: html.scrollHeight, htmlClientH: html.clientHeight,
    allCtCards: all.length,
    wbWorkExists: !!wbWork,
    wbWorkScrollH: wbWork ? wbWork.scrollHeight : null, wbWorkClientH: wbWork? wbWork.clientHeight: null,
    wbExists: !!wbEl,
    wbScrollH: wbEl? wbEl.scrollHeight: null, wbClientH: wbEl? wbEl.clientHeight: null,
    bodyText: document.body.innerText.slice(0,200),
  }
})
console.log(JSON.stringify(out, null, 2))
await b.close()
