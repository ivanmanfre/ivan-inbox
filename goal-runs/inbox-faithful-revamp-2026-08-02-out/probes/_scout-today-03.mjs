import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const session = readFileSync('.session.json', 'utf8')
const OUT_DIR = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase0-shots'

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()

let countsPayload = null
let fullPayload = null
p.on('response', async (res) => {
  const url = res.url()
  if (url.includes('get-morning-brief')) {
    try {
      const json = await res.json()
      if (url.includes('mode=counts')) countsPayload = { url, status: res.status(), json }
      else fullPayload = { url, status: res.status(), json }
    } catch (e) { /* ignore parse errors on aborted/duplicate responses */ }
  }
})

await p.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
await p.addInitScript(() => localStorage.setItem('inbox-theme', 'dark'))
await p.goto('http://localhost:5431/#exp/v2/today', { waitUntil: 'domcontentloaded' })

// The full brief call carries an n8n round-trip (~12s per useToday.ts:20-21) — wait for
// it specifically (fullPayload set), on top of the generic "no literal Loading text,
// stable twice" settle check.
async function settle() {
  let prev = null
  for (let i = 0; i < 60; i++) {
    const text = await p.evaluate(() => document.body.innerText)
    const hasLoading = text.includes('Loading')
    const stable = prev === text
    if (!hasLoading && stable && fullPayload) return text
    prev = text
    await p.waitForTimeout(500)
  }
  return prev
}
const settledText = await settle()

await p.screenshot({ path: `${OUT_DIR}/today-03-settled.png`, fullPage: true })
writeFileSync(`${OUT_DIR}/today-brief-payload.json`, JSON.stringify(fullPayload, null, 2))
writeFileSync(`${OUT_DIR}/today-brief-counts-payload.json`, JSON.stringify(countsPayload, null, 2))
writeFileSync(`${OUT_DIR}/today-settled-text.txt`, settledText ?? '(none)')

console.log('DONE')
console.log('full brief captured:', !!fullPayload, fullPayload?.status)
console.log('counts captured:', !!countsPayload, countsPayload?.status)

await b.close()
