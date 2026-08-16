import { chromium } from 'playwright'
import fs from 'fs'

const ROOT = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/40a160cc-d253-4d32-a586-b1dad7ce0fb2/scratchpad/wt-faithful'
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase0-shots'
const BASE = 'http://localhost:5431'
const session = JSON.parse(fs.readFileSync(ROOT + '/.session.json', 'utf8'))

const ROUTES = ['today', 'inbox', 'drafts', 'content', 'sends', 'ops', 'settings']
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
]

async function settle(page, timeout = 8000) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeout) {
    const skeletons = await page.locator('.sk-av, .wb-th-dot, [class*="skeleton" i]').count().catch(() => 0)
    const text = await page.locator('body').innerText().catch(() => '')
    const loading = /loading/i.test(text)
    if (skeletons === 0 && !loading) {
      if (last === text) return true
      last = text
    } else {
      last = null
    }
    await page.waitForTimeout(500)
  }
  return false
}

async function run() {
  const browser = await chromium.launch()
  const results = []

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    await context.addInitScript(([key, val]) => {
      window.localStorage.setItem(key, val)
    }, ['sb-bjbvqvzbzczjbatgmccb-auth-token', JSON.stringify(session)])

    for (const route of ROUTES) {
      const page = await context.newPage()
      const msgs = []
      const failedReqs = []
      page.on('console', m => {
        if (m.type() === 'error' || m.type() === 'warning') {
          msgs.push({ type: m.type(), text: m.text(), location: m.location() })
        }
      })
      page.on('pageerror', e => msgs.push({ type: 'pageerror', text: String(e), location: {} }))
      page.on('requestfailed', r => {
        failedReqs.push({ url: r.url(), method: r.method(), failure: r.failure()?.errorText })
      })
      page.on('response', r => {
        if (r.status() >= 400) {
          failedReqs.push({ url: r.url(), method: r.request().method(), status: r.status() })
        }
      })

      const url = `${BASE}/#exp/v2/${route}`
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await settle(page)
      await page.waitForTimeout(300)

      // interaction pass
      let interactionNote = 'none attempted'
      try {
        if (route === 'inbox') {
          const row = page.locator('.r').first()
          if (await row.count() > 0) {
            await row.click({ timeout: 3000 })
            await page.waitForTimeout(600)
            interactionNote = 'opened first inbox row'
          }
        } else if (route === 'drafts') {
          const row = page.locator('.r, .ct-card').first()
          if (await row.count() > 0) { await row.click({ timeout: 3000 }); await page.waitForTimeout(600); interactionNote = 'opened first draft row' }
        } else if (route === 'content') {
          const chip = page.locator('.chip').first()
          if (await chip.count() > 0) { await chip.click({ timeout: 3000 }); await page.waitForTimeout(600) }
          const card = page.locator('.ct-card').first()
          if (await card.count() > 0) { await card.click({ timeout: 3000 }); await page.waitForTimeout(600) }
          interactionNote = 'switched lane + opened first content row'
        } else if (route === 'ops') {
          const sech = page.locator('.wb-sech.tap, .ops-sechdr').first()
          if (await sech.count() > 0) { await sech.click({ timeout: 3000 }); await page.waitForTimeout(400) }
          interactionNote = 'toggled a section'
        } else if (route === 'sends') {
          const seg = page.locator('.seg .sg, .wb-ws').first()
          if (await seg.count() > 0) { await seg.click({ timeout: 3000 }); await page.waitForTimeout(400) }
          interactionNote = 'switched client/lane segment'
        } else if (route === 'today') {
          interactionNote = 'no list to open (aggregate surface)'
        } else if (route === 'settings') {
          interactionNote = 'no interactive list'
        }
      } catch (e) {
        interactionNote = 'interaction failed: ' + String(e).slice(0, 200)
      }

      await page.waitForTimeout(400)
      const shotPath = `${OUT}/errhover-console-${route}-${vp.name}.png`
      await page.screenshot({ path: shotPath, fullPage: false }).catch(() => {})

      results.push({
        route, viewport: vp.name, url,
        consoleMsgs: msgs, failedRequests: failedReqs, interactionNote,
      })
      await page.close()
    }
    await context.close()
  }

  await browser.close()
  fs.writeFileSync(ROOT + '/scripts/_scout-errhover-console-results.json', JSON.stringify(results, null, 2))
  console.log('DONE')
}

run().catch(e => { console.error(e); process.exit(1) })
