import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const session = readFileSync('.session.json', 'utf8')
const OUT_DIR = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase0-shots'

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()

let briefPayload = null
const events = []
p.on('response', async (res) => {
  const url = res.url()
  if (url.includes('get-morning-brief')) {
    try { briefPayload = { url, status: res.status(), json: await res.json() } }
    catch (e) { briefPayload = { url, status: res.status(), error: String(e) } }
  }
  if (url.includes('inbox_messages_v')) {
    const m = url.match(/offset=(\d+)/)
    events.push(`t=${Date.now()} inbox_messages_v offset=${m?.[1]} status=${res.status()}`)
  }
})

await p.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
await p.addInitScript(() => localStorage.setItem('inbox-theme', 'dark'))
const t0 = Date.now()
await p.goto('http://localhost:5431/#exp/v2/today', { waitUntil: 'domcontentloaded' })

for (const wait of [3000, 5000, 5000, 5000, 5000, 5000]) {
  await p.waitForTimeout(wait)
  const elapsed = Date.now() - t0
  const text = await p.evaluate(() => document.body.innerText)
  const hasToday = /Today/.test(text) && !text.includes('INBOX')
  console.log(`--- elapsed=${elapsed}ms hasToday=${hasToday} ---`)
  console.log(text.slice(0, 200).replace(/\n/g, ' | '))
  if (hasToday) {
    await p.screenshot({ path: `${OUT_DIR}/today-02-settled.png`, fullPage: true })
    break
  }
}
writeFileSync(`${OUT_DIR}/today-brief-payload.json`, JSON.stringify(briefPayload, null, 2))
console.log('events:', events.join('\n'))
console.log('brief:', briefPayload?.url, briefPayload?.status)
await b.close()
