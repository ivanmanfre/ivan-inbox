import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const session = readFileSync('.session.json', 'utf8')
const OUT_DIR = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase0-shots'

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()

let briefPayload = null
const allUrls = []
const consoleMsgs = []
p.on('console', (msg) => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`))
p.on('pageerror', (err) => consoleMsgs.push(`[pageerror] ${err.message}`))
p.on('requestfailed', (req) => consoleMsgs.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText}`))
p.on('response', async (res) => {
  const url = res.url()
  allUrls.push(`${res.status()} ${url}`)
  if (url.includes('inbox_messages_v')) {
    try {
      const j = await res.json()
      consoleMsgs.push(`[inbox_messages_v] rows=${Array.isArray(j) ? j.length : 'n/a'} status=${res.status()}`)
    } catch (e) { consoleMsgs.push(`[inbox_messages_v parse err] ${e}`) }
  }
  if (url.includes('get-morning-brief')) {
    try {
      const json = await res.json()
      briefPayload = { url, status: res.status(), json }
    } catch (e) {
      briefPayload = { url, status: res.status(), error: String(e) }
    }
  }
})

await p.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
await p.addInitScript(() => localStorage.setItem('inbox-theme', 'dark'))
await p.goto('http://localhost:5431/#exp/v2/today', { waitUntil: 'domcontentloaded' })

// Poll until settled: no literal "Loading" in innerText, stable across two 500ms checks,
// AND the generic inbox-loading skeleton gate (Shell.tsx:223) has cleared — that gate
// shows a plain "Inbox" heading + gray skeleton bars with NO "Loading" text at all,
// regardless of which job/hash was requested, until inbox.threads has paged in fully.
async function settle() {
  let prev = null
  for (let i = 0; i < 20; i++) {
    const text = await p.evaluate(() => document.body.innerText)
    const hasLoading = text.includes('Loading')
    const genericInboxGate = /^INBOX\s*$/m.test(text) && text.trim().split('\n').filter(Boolean).length < 15
    if (!hasLoading && !genericInboxGate && prev === text) return text
    prev = text
    await p.waitForTimeout(500)
  }
  return prev
}
const settledText = await settle()

await p.screenshot({ path: `${OUT_DIR}/today-01-settled.png`, fullPage: true })

writeFileSync(`${OUT_DIR}/today-brief-payload.json`, JSON.stringify(briefPayload, null, 2))
writeFileSync(`${OUT_DIR}/today-settled-text.txt`, settledText ?? '(none)')

console.log('DONE')
console.log('brief url:', briefPayload?.url, 'status:', briefPayload?.status)
console.log('has json:', !!briefPayload?.json)
console.log('--- all urls ---')
console.log(allUrls.join('\n'))
console.log('--- console/errors ---')
console.log(consoleMsgs.join('\n'))

await b.close()
