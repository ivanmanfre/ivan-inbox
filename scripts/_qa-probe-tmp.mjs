import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox-wt-p4b/.session.json', 'utf8')
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
await p.addInitScript(([k,v])=>window.localStorage.setItem(k,v), ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
await p.goto('http://localhost:4183/#exp/v2c/content', { waitUntil: 'networkidle' })
await p.waitForTimeout(2600)
await p.locator('#wb-s-review .ct-card, .ct-card:not(.ct-idea)').first().click()
await p.waitForTimeout(2200)
console.log(await p.evaluate(() => {
  const tb = document.querySelector(".qa-prose")
  const insp = document.querySelector('.dw-insp')
  return `insp ${insp.scrollHeight}/${insp.clientHeight}\n` + [...tb.children].map(c => `${Math.round(c.getBoundingClientRect().height)}px  ${c.className}  ${(c.textContent||'').trim().slice(0,44).replace(/\s+/g,' ')}`).join('\n')
}))
await b.close()
