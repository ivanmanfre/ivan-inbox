import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = JSON.parse(readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session-gate.json','utf8'))
const KEY = 'sb-bjbvqvzbzczjbatgmccb-auth-token'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport:{width:1440,height:900} })
await ctx.addInitScript(([k,s])=>{ localStorage.setItem(k, JSON.stringify(s)) }, [KEY, sess])
const p = await ctx.newPage()
await p.goto('http://localhost:4540/#exp/brain-b/magnets?skin=b', { waitUntil:'networkidle' })
await p.waitForTimeout(2500)
const out = await p.evaluate(() => {
  const res = []
  const lane = document.querySelector('#wb-lm-lane')
  if (lane) for (const c of lane.children) {
    const r = c.getBoundingClientRect()
    res.push({ cls: c.className, tag: c.tagName, top: Math.round(r.top), h: Math.round(r.height) })
  }
  return res
})
console.log('MAGNETS lane children:', JSON.stringify(out, null, 1))
await p.goto('http://localhost:4540/#exp/brain-b/strategy?skin=b', { waitUntil:'networkidle' })
await p.waitForTimeout(2500)
const st = await p.evaluate(() => {
  const i = document.querySelector('.a-strat-t .ds-input')
  if (!i) return 'no input'
  const cs = getComputedStyle(i)
  return { value: i.value, color: cs.color, fs: cs.fontSize }
})
console.log('STRATEGY title input:', JSON.stringify(st))
await b.close()
