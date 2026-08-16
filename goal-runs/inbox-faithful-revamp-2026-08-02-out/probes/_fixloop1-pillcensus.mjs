import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('.session.json', 'utf8')

async function run(viewport) {
  const b = await chromium.launch()
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  await p.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
  await p.addInitScript(() => localStorage.setItem('inbox-theme', 'dark'))
  await p.goto('http://localhost:5444/#exp/v2/content', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(4000)
  const out = await p.evaluate(() => {
    const all = document.querySelectorAll('*')
    const hits = []
    for (const el of all) {
      const s = getComputedStyle(el)
      const br = s.borderRadius
      // borderRadius can be a shorthand of 4 values; take max token seen (px)
      const nums = (br.match(/[\d.]+px/g) || []).map(x => parseFloat(x))
      const isCircle = s.borderRadius === '50%'
      const maxR = nums.length ? Math.max(...nums) : 0
      if (isCircle || maxR >= 100) {
        hits.push({ tag: el.tagName, cls: el.className.toString().slice(0, 80), radius: br })
      }
    }
    // tally by class
    const byClass = {}
    for (const h of hits) {
      const key = h.cls || h.tag
      byClass[key] = (byClass[key] || 0) + 1
    }
    // specific check: any .ct-f element and its radius
    const ctf = document.querySelectorAll('.ct-f')
    const ctfSample = ctf.length ? getComputedStyle(ctf[0]).borderRadius : null
    return { totalPillHits: hits.length, byClass, ctfCount: ctf.length, ctfRadius: ctfSample }
  })
  await b.close()
  return out
}

const r1440 = await run({ width: 1440, height: 900 })
const r390 = await run({ width: 390, height: 844 })
console.log('=== 1440x900 ===')
console.log(JSON.stringify(r1440, null, 2))
console.log('=== 390x844 ===')
console.log(JSON.stringify(r390, null, 2))
