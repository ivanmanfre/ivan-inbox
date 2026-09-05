import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = JSON.parse(readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session-gate.json','utf8'))
const b = await chromium.launch()
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' })
await ctx.addInitScript(([k,s])=>{ localStorage.setItem(k, JSON.stringify(s)) }, ['sb-bjbvqvzbzczjbatgmccb-auth-token', sess])
const p = await ctx.newPage()
await p.goto('http://localhost:4556/#exp/brain-b/content?skin=b', { waitUntil:'networkidle' })
await p.waitForTimeout(3000)
console.log(JSON.stringify(await p.evaluate(() => {
  const l = document.querySelector('.ds-tab-label'); if (!l) return 'none'
  const b = l.getBoundingClientRect()
  const behind = document.elementsFromPoint(b.left + b.width/2, b.top + b.height/2)
    .map(e => ({ t: e.tagName, c: typeof e.className === 'string' ? e.className : '', bg: getComputedStyle(e).backgroundColor }))
  return { color: getComputedStyle(l).color, behind: behind.slice(0, 5) }
}), null, 1))
await b.close()
