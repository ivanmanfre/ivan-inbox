import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('.session.json','utf8')
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: {width:1440,height:900}, deviceScaleFactor:2 })
const p = await ctx.newPage()
await p.addInitScript(([k,v])=>localStorage.setItem(k,v), ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
await p.addInitScript(()=>localStorage.setItem('inbox-theme','dark'))
await p.goto('http://localhost:5444/#exp/v2/sends', {waitUntil:'domcontentloaded'})
await p.waitForTimeout(4000)
// click to Lanes segment which has the chart marks (per builder sweep, .seg .sg:nth-child(2))
await p.locator('.seg .sg:nth-child(2)').first().click({timeout:6000}).catch(e=>console.log('click lanes failed', e.message))
await p.waitForTimeout(2000)

const measure = async () => p.evaluate(() => {
  const root = document.querySelector('.wb')
  const cs = getComputedStyle(root)
  const get = (n) => cs.getPropertyValue(n).trim()
  const positions = [...document.querySelectorAll('.ov-kpi, .wb-cap, .wb-legend-d, .sc-dot, .sc-bar')]
    .map(el => { const r = el.getBoundingClientRect(); return `${el.className}:${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` })
  return {
    catAttr: document.documentElement.getAttribute('data-cat'),
    cat1: get('--cat-1'), cat2: get('--cat-2'), cat3: get('--cat-3'), cat4: get('--cat-4'),
    positions,
    bodyH: document.body.scrollHeight,
  }
})

const mono = await measure()
console.log('MONO', JSON.stringify(mono, null, 2))

await p.evaluate(() => document.documentElement.setAttribute('data-cat','triad'))
await p.waitForTimeout(500)
const triad = await measure()
console.log('TRIAD', JSON.stringify(triad, null, 2))

const shifted = mono.positions.length === triad.positions.length &&
  mono.positions.every((v,i)=>v===triad.positions[i])
console.log('LAYOUT UNCHANGED (positions identical):', shifted)

await b.close()
