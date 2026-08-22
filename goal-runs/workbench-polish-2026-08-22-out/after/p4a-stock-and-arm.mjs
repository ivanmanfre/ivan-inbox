// Two things the month screenshots cannot answer.
//
// 1. #exp/stock, pixel-identical. The base build (the commit before p4a) and
//    this build are served side by side and the stock shell is captured from
//    both at the same viewport, then compared byte for byte on the raw PNG.
//
// 2. The Arm control, clicked through. There is NO live row in the shape it
//    needs: it draws on a PLANNED row on Ivan's lane, and Ivan's two review
//    rows are both undated (measured 2026-08-22). So this pass is a RENDER
//    HARNESS and is labelled one: the GET response for Ivan's drafts is
//    rewritten in flight to give ONE REAL row a scheduled_at, nothing else is
//    touched, and the database is never read differently or written at all.
//    What it proves is the click path and the payload, not coverage.
//
// Every mutating call is intercepted before it leaves the page, RPC included.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox-pw-a/goal-runs/workbench-polish-2026-08-22-out/after/'
const AFTER = 'http://localhost:4181/'
const BEFORE = 'http://localhost:4182/'

const attempted = []
const sum = b => createHash('sha256').update(b).digest('hex').slice(0, 16)

async function armed(ctx) {
  const page = await ctx.newPage()
  await page.route('**/rest/v1/**', async r => {
    const q = r.request(), m = q.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
      attempted.push({ kind: 'rest', method: m, url: q.url(), body: q.postData() })
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  })
  await page.route('**/rest/v1/rpc/**', async r => {
    attempted.push({ kind: 'rpc', method: r.request().method(), url: r.request().url(), body: r.request().postData() })
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'blocked_by_probe' }) })
  })
  return page
}

const browser = await chromium.launch()
const out = {}

// ---- 1. #exp/stock, both builds ------------------------------------------
for (const [tag, base] of [['after', AFTER], ['before', BEFORE]]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  const page = await armed(ctx)
  await page.goto(base + '#exp/stock', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3500)
  await page.screenshot({ path: `${OUT}p4a-stock-${tag}.png`, type: 'png' })
  await page.close(); await ctx.close()
}
const a = readFileSync(`${OUT}p4a-stock-after.png`)
const b = readFileSync(`${OUT}p4a-stock-before.png`)
out.stock = { afterBytes: a.length, beforeBytes: b.length, afterSha: sum(a), beforeSha: sum(b), identical: a.equals(b) }
console.log('#exp/stock identical:', out.stock.identical, out.stock)

// ---- 2. the Arm control, RENDER HARNESS ----------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  const page = await armed(ctx)
  // The harness, and its whole extent: one real Ivan row at status='review'
  // gets a scheduled_at in the RESPONSE BODY so the chip has a day to land on.
  // No other field moves and no request is added.
  const day = new Date()
  day.setDate(day.getDate() + 3)
  day.setHours(9, 0, 0, 0)
  const stamped = day.toISOString()
  let harnessed = null
  await page.route(u => u.pathname.endsWith('/rest/v1/carousel_drafts') && !u.searchParams.has('id'), async r => {
    if (r.request().method() !== 'GET') return r.continue()
    const res = await r.fetch()
    let rows
    try { rows = await res.json() } catch { return r.fulfill({ response: res }) }
    if (Array.isArray(rows)) {
      const row = rows.find(x => x.status === 'review' && !x.scheduled_at && x.client_id === null)
      if (row) { row.scheduled_at = stamped; harnessed = { id: row.id, title: row.title, at: stamped } }
    }
    return r.fulfill({ response: res, body: JSON.stringify(rows), headers: { ...res.headers(), 'content-length': undefined } })
  })
  await page.goto(AFTER + '#exp/v2/content', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.getByText('Calendar', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(1800)

  const chip = page.locator('.cal-chip[data-arm="planned"]').first()
  out.arm = {
    harnessed,
    plannedChips: await page.locator('.cal-chip[data-arm="planned"]').count(),
    armButtons: await page.locator('.cal-chip-armb').count(),
    armLabel: await chip.locator('.cal-chip-armb').getAttribute('aria-label').catch(() => null),
    counts: await page.locator('.cal-count').allTextContents(),
  }
  await chip.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}p4a-arm-harness.jpg`, type: 'jpeg', quality: 85 })

  // interaction 1: press Arm it
  await page.locator('.cal-chip-armb').first().click()
  await page.waitForTimeout(500)
  out.arm.confirmTitle = await page.locator('.cs-t, [class*=cs-title], [role=dialog] h2, .wb-cs-t').first().textContent().catch(() => null)
  const sheet = await page.locator('body').innerText()
  out.arm.confirmNamesTime = sheet.includes(day.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }))
  out.arm.confirmText = sheet.split('\n').filter(l => /publisher|arm|scheduled/i.test(l)).slice(0, 6)
  await page.screenshot({ path: `${OUT}p4a-arm-confirm.jpg`, type: 'jpeg', quality: 85 })

  // interaction 2: confirm. The PATCH is intercepted, so nothing lands.
  const before = attempted.length
  await page.getByRole('button', { name: /Arm it/ }).last().click()
  await page.waitForTimeout(1200)
  out.arm.writesTried = attempted.slice(before)
  await page.close(); await ctx.close()
}
console.log('arm:', JSON.stringify(out.arm, null, 2))

writeFileSync(`${OUT}p4a-stock-and-arm.json`, JSON.stringify({ out, attempted }, null, 2))
console.log('\nSHOTS:', readdirSync(OUT).filter(f => f.startsWith('p4a-')).join(' '))
console.log('WRITES THAT REACHED THE DATABASE: 0 (every one fulfilled at the route)')
console.log('INTERCEPTED WRITE ATTEMPTS:', attempted.length)
for (const x of attempted) console.log(' ', x.kind, x.method, x.url.split('/rest/v1/')[1], x.body)
await browser.close()
