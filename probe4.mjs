import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = JSON.parse(readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session-gate.json','utf8'))
const b = await chromium.launch()
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', deviceScaleFactor:2 })
await ctx.addInitScript(([k,s])=>{ localStorage.setItem(k, JSON.stringify(s)) }, ['sb-bjbvqvzbzczjbatgmccb-auth-token', sess])
const p = await ctx.newPage()
await p.goto('http://localhost:4556/#exp/brain-b/content?skin=b', { waitUntil:'networkidle' })
await p.waitForTimeout(3000)
console.log(await p.evaluate(() => {
  const seps = [...document.querySelectorAll('.a-sep')]
  if (!seps.length) return 'none'
  const e = seps[0]
  return {
    n: seps.length,
    color: getComputedStyle(e).color,
    inAct: !!e.closest('.a-ct'),
    chain: (()=>{ const out=[]; for(let x=e; x && out.length<6; x=x.parentElement) out.push(x.className && typeof x.className==='string' ? x.className : x.tagName); return out })(),
  }
}))
await b.close()
