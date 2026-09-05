import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = JSON.parse(readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session-gate.json','utf8'))
const b = await chromium.launch()
const ctx = await b.newContext({ viewport:{width:1440,height:900} })
await ctx.addInitScript(([k,s])=>{ localStorage.setItem(k, JSON.stringify(s)) }, ['sb-bjbvqvzbzczjbatgmccb-auth-token', sess])
const p = await ctx.newPage()
await p.goto('http://localhost:4546/#exp/brain-b/content?skin=b', { waitUntil:'networkidle' })
await p.waitForTimeout(2500)
await p.locator('.ct-cmd-lane', { hasText: 'Calendar' }).first().click()
await p.waitForTimeout(900)
for (let i = 0; i < 8; i++) {
  const month = await p.locator('.a-ct-month').first().textContent().catch(()=>null)
  const more = await p.locator('.a-ct-more').count()
  const chips = await p.locator('.a-ct-chip').count()
  console.log(`${month} → more=${more} chips=${chips}`)
  if (more > 0) break
  await p.locator('[aria-label="Previous month"]').first().click()
  await p.waitForTimeout(600)
}
await b.close()
