import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json','utf8')
const b = await chromium.launch()
const page = await b.newPage({ viewport:{width:390,height:844} })
await page.addInitScript(([s])=>{localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token',s)},[session])
await page.goto('https://ivanmanfre.github.io/ivan-inbox/#exp/v2/content',{waitUntil:'networkidle'}).catch(()=>{})
await page.waitForTimeout(5500)
console.log(JSON.stringify(await page.evaluate(() => {
  const pill = [...document.querySelectorAll('.ct-fpop')].find(e => e.getBoundingClientRect().right > innerWidth)
  const chain = []
  let el = pill
  while (el && chain.length < 5) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect()
    chain.push({ cls:(el.className||'').toString().slice(0,40), w:Math.round(r.width), l:Math.round(r.left),
                 rr:Math.round(r.right), ox:cs.overflowX, wrap:cs.flexWrap, disp:cs.display, sw:el.scrollWidth, cw:el.clientWidth })
    el = el.parentElement
  }
  const caps = document.querySelector('.wb-caps')
  return { chain, capsKids: caps ? caps.children.length : null }
}),null,1))
await page.goto('https://ivanmanfre.github.io/ivan-inbox/#exp/v2/magnets',{waitUntil:'networkidle'}).catch(()=>{})
await page.waitForTimeout(5000)
console.log('magnets caps', JSON.stringify(await page.evaluate(() => {
  const c = document.querySelector('.wb-caps')
  return c ? { kids:c.children.length, w:Math.round(c.getBoundingClientRect().width), sw:c.scrollWidth, cw:c.clientWidth } : null
})))
await b.close()
