import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const session = readFileSync('.session.json', 'utf8')
const OUT_DIR = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase0-shots'

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()

let fullSeen = false
p.on('response', (res) => {
  if (res.url().includes('get-morning-brief') && !res.url().includes('mode=counts')) fullSeen = true
})

await p.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
await p.addInitScript(() => localStorage.setItem('inbox-theme', 'dark'))
await p.goto('http://localhost:5431/#exp/v2/today', { waitUntil: 'domcontentloaded' })

for (let i = 0; i < 40; i++) {
  if (fullSeen) break
  await p.waitForTimeout(500)
}
await p.waitForTimeout(500)

// scroll the internal rows container to the bottom, then screenshot the full text.
const text = await p.evaluate(async () => {
  const el = document.querySelector('.td-rows') || document.querySelector('.rows')
  if (el) el.scrollTop = el.scrollHeight
  await new Promise(r => setTimeout(r, 300))
  return document.body.innerText
})
await p.screenshot({ path: `${OUT_DIR}/today-05-scrolled.png` })
console.log(text)
await b.close()
