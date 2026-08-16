import { chromium } from 'playwright'
import fs from 'fs'

const ROOT = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/wt-faithful'
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase0-shots'
const BASE = 'http://localhost:5431'
const session = JSON.parse(fs.readFileSync(ROOT + '/.session.json', 'utf8'))

async function run() {
  const browser = await chromium.launch()
  const results = []

  for (const vp of [{ name: '1440x900', width: 1440, height: 900 }, { name: '390x844', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    await context.addInitScript(([key, val]) => {
      window.localStorage.setItem(key, val)
    }, ['sb-bjbvqvzbzczjbatgmccb-auth-token', JSON.stringify(session)])
    const page = await context.newPage()
    const msgs = []
    const failedReqs = []
    const allResponses = []
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') msgs.push({ type: m.type(), text: m.text() }) })
    page.on('pageerror', e => msgs.push({ type: 'pageerror', text: String(e) }))
    page.on('requestfailed', r => failedReqs.push({ url: r.url(), failure: r.failure()?.errorText }))
    page.on('response', r => {
      allResponses.push({ url: r.url(), status: r.status() })
      if (r.status() >= 400) failedReqs.push({ url: r.url(), status: r.status() })
    })

    await page.goto(`${BASE}/#exp/v2/inbox`, { waitUntil: 'domcontentloaded' })
    // poll until the loading skeleton clears (up to 15s)
    for (let i = 0; i < 30; i++) {
      const stillLoading = await page.locator('.wb-rib-sync, .wb-sync-t').filter({ hasText: 'not loaded' }).count().catch(() => 0)
      const skeleton = await page.locator('.sk-av').count().catch(() => 0)
      if (skeleton === 0) break
      await page.waitForTimeout(500)
    }
    await page.waitForTimeout(1000)

    if (vp.name.startsWith('390')) {
      // open chat via the mobile tab bar
      const claudeTab = page.locator('.tabbar .tb').last()
      await claudeTab.click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(500)
    }

    // the CHAT composer specifically: its placeholder starts with "Ask"
    const input = page.locator('input.cfield[placeholder^="Ask"]')
    const before = allResponses.length
    const inputCount = await input.count()
    if (inputCount > 0) {
      await input.first().fill('hello, quick test message')
      await input.first().press('Enter')
      await page.waitForTimeout(5000)
    }
    const shotPath = `${OUT}/errhover-chatsend-${vp.name}.png`
    await page.screenshot({ path: shotPath }).catch(() => {})

    results.push({
      viewport: vp.name,
      inputCount,
      consoleMsgs: msgs,
      failedRequests: failedReqs,
      newResponses: allResponses.slice(before),
    })
    await page.close()
    await context.close()
  }

  await browser.close()
  fs.writeFileSync(ROOT + '/scripts/_scout-errhover-chatsend-results.json', JSON.stringify(results, null, 2))
  console.log('DONE')
}

run().catch(e => { console.error(e); process.exit(1) })
