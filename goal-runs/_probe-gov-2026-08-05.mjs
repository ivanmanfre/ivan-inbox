import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json','utf8')
const b = await chromium.launch()
const page = await b.newPage({ viewport:{width:390,height:844} })
await page.addInitScript(([s])=>{localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token',s)},[session])
await page.goto('https://ivanmanfre.github.io/ivan-inbox/#exp/v2/sends',{waitUntil:'networkidle'}).catch(()=>{})
await page.waitForTimeout(5500)
console.log(JSON.stringify(await page.evaluate(() => {
  const out = { at9: [], at11: [] }
  const els = [...document.querySelectorAll('.ov-tile-lbl')]
  for (const e of els) out.at9.push({ t:e.textContent.trim(), cw:Math.round(e.clientWidth), sw:e.scrollWidth, h:Math.round(e.getBoundingClientRect().height) })
  for (const e of els) { e.style.fontSize = '11px'; e.style.letterSpacing = '0' }
  for (const e of els) out.at11.push({ t:e.textContent.trim(), cw:Math.round(e.clientWidth), sw:e.scrollWidth, h:Math.round(e.getBoundingClientRect().height) })
  return out
}),null,1))
await b.close()
