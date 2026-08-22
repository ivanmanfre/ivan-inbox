// AI pass verification. READ ONLY, AND UNPAID, BY CONSTRUCTION.
//
// Three interceptors are installed before the first navigation:
//   1. every mutating REST call (PATCH/DELETE/PUT, and POST outside /rpc/)
//   2. the RPC route, registered second so playwright matches it first
//   3. THE EDGE-FUNCTION ORIGIN (/functions/v1/**). This run must fire zero
//      paid model calls, so inbox-fast and inbox-claude are answered with a
//      canned stream instead of reaching a vendor. The pre-read is therefore
//      exercised end to end, through its real fetch, its real SSE parser and
//      its real sanitiser, without a token being billed.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync } from 'node:fs'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = 'http://localhost:4188/'
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox-pw-ai/goal-runs/workbench-polish-2026-08-22-out/after/'

const attempted = []   // writes stopped
const paid = []        // model calls stopped
const restGets = []    // reads, recorded so the search's own queries can be read back

// The canned fast-lane reply. Deliberately carries the escalation token the
// deployed system prompt can emit, so the sanitiser is exercised rather than
// assumed.
function sse() {
  const deltas = [
    'Wants pricing for the ', 'done-for-you lane · ', 'not stated · ',
    'Ivan owes them a number\n<<ESCALATE: go and check the pipeline>>',
  ]
  const frames = [
    'event: message_start\ndata: {"type":"message_start"}\n\n',
    ...deltas.map(d => `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: d } })}\n\n`),
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ]
  return frames.join('')
}

async function newPage(ctx) {
  const page = await ctx.newPage()
  await page.route('**/rest/v1/**', async r => {
    const q = r.request(), m = q.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
      attempted.push({ kind: 'rest', method: m, url: q.url(), body: q.postData() })
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    if (m === 'GET') restGets.push(decodeURIComponent(q.url()))
    return r.continue()
  })
  await page.route('**/rest/v1/rpc/**', async r => {
    attempted.push({ kind: 'rpc', method: r.request().method(), url: r.request().url(), body: r.request().postData() })
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'blocked_by_probe' }) })
  })
  // 🔴 the money gate.
  await page.route('**/functions/v1/**', async r => {
    paid.push({ url: r.request().url(), body: (r.request().postData() ?? '').slice(0, 4000) })
    return r.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'access-control-allow-origin': '*', 'x-fast-model': 'blocked-by-probe' },
      body: sse(),
    })
  })
  return page
}

async function boot(ctx, hash, w, h) {
  const page = await newPage(ctx)
  await page.setViewportSize({ width: w, height: h })
  // The session is planted by an INIT SCRIPT rather than by an evaluate after
  // the first load. Setting it afterwards races the client's own auth boot,
  // and the race is only lost on the first cold page of a run, which is how a
  // probe ends up photographing a sign-in form and calling it a surface.
  await page.goto(BASE + hash, { waitUntil: 'networkidle' })
  // Wait for the shell to actually PAINT rather than for a fixed number of
  // milliseconds. The first page of a cold run boots slower than the rest, and
  // a fixed wait is how a probe quietly measures an empty screen.
  await page.waitForSelector('.wb-rail, .wb-mtabs', { timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(2600)
  return page
}

const ctx0 = await chromium.launch({ headless: true })
const ctx = await ctx0.newContext({ deviceScaleFactor: 2 })
await ctx.addInitScript(s => {
  try { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) } catch { /* ok */ }
}, session)
const report = {}

// ---------------------------------------------------------------------------
// 1. THE CONTEXT STRIP, desktop, with a thread docked beside the pane
// ---------------------------------------------------------------------------
{
  const page = await boot(ctx, '#exp/v2/dms', 1440, 900)
  // Open a conversation first, then dock Claude beside it from the rail. That
  // is the real path, and it is the one that gives the pane a thread to see.
  await page.waitForSelector('.wb-work .r', { timeout: 30000 }).catch(() => {})
  await page.locator('.wb-work .r').first().click({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1400)
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.wb-rail .wb-rj')]
      .find(b => (b.textContent ?? '').includes('Claude'))
    if (el instanceof HTMLElement) el.click()
  })
  await page.waitForTimeout(1800)
  report.strip = await page.evaluate(() => {
    const t = el => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const strip = document.querySelector('.wb-see')
    const cs = el => (el ? getComputedStyle(el) : null)
    const chip = document.querySelector('.wb-see-c')
    return {
      present: !!strip,
      line: t(document.querySelector('.wb-see-l')),
      chips: [...document.querySelectorAll('.wb-see-cn')].map(t),
      depthSwitches: [...document.querySelectorAll('.wb-see-cd')].map(t),
      stripFont: cs(document.querySelector('.wb-see-l'))?.fontSize,
      chipFont: cs(document.querySelector('.wb-see-cn'))?.fontSize,
      chipBg: cs(chip)?.backgroundColor,
      stripBg: cs(strip)?.backgroundColor,
    }
  })
  // open the "show me" disclosure and read the EXACT text that would travel
  await page.locator('.wb-see-t', { hasText: 'Show me' }).first().click().catch(() => {})
  await page.waitForTimeout(400)
  report.peekShallow = await page.evaluate(() =>
    (document.querySelector('.wb-see-peek')?.textContent ?? '').replace(/\s+/g, ' ').trim())
  await page.screenshot({ path: OUT + 'ai-context-1440.jpg', quality: 82, type: 'jpeg' })

  // switch the thread chip to full text and read it again
  await page.locator('.wb-see-cd').first().click().catch(() => {})
  await page.waitForTimeout(400)
  report.peekDeep = await page.evaluate(() =>
    (document.querySelector('.wb-see-peek')?.textContent ?? '').replace(/\s+/g, ' ').trim())
  report.lineDeep = await page.evaluate(() =>
    (document.querySelector('.wb-see-l')?.textContent ?? '').trim())
  await page.screenshot({ path: OUT + 'ai-context-full-1440.jpg', quality: 82, type: 'jpeg' })

  // detach everything and prove the block empties
  await page.locator('.wb-see-t', { hasText: 'Detach all' }).first().click().catch(() => {})
  await page.waitForTimeout(400)
  report.peekOff = await page.evaluate(() => ({
    line: (document.querySelector('.wb-see-l')?.textContent ?? '').trim(),
    peek: (document.querySelector('.wb-see-peek')?.textContent ?? '').trim(),
  }))
  await page.screenshot({ path: OUT + 'ai-context-off-1440.jpg', quality: 82, type: 'jpeg' })
  await page.close()
}

// ---------------------------------------------------------------------------
// 2. THE PRE-READ. One click, one line, and the row height must not move.
// ---------------------------------------------------------------------------
{
  const page = await boot(ctx, '#exp/v2/dms', 1440, 900)
  report.pre = await page.evaluate(() => ({
    chips: document.querySelectorAll('.wb-pre').length,
    rows: document.querySelectorAll('.wb-work .r').length,
    rowH: Math.round(document.querySelector('.wb-work .r')?.getBoundingClientRect().height ?? 0),
    // 🔴 the spending assertion: rendering a list of waiting threads must not
    // have fired anything at all.
  }))
  report.paidBeforeClick = paid.length
  const chip = page.locator('.wb-pre').first()
  const rowBefore = await page.evaluate(() => {
    const el = document.querySelector('.wb-pre')?.closest('.r')
    return el ? Math.round(el.getBoundingClientRect().height) : null
  })
  await chip.click().catch(() => {})
  await page.waitForTimeout(1500)
  report.pre.after = await page.evaluate(() => {
    const note = document.querySelector('.snip-note')
    return {
      note: (note?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      rowH: Math.round(note?.closest('.r')?.getBoundingClientRect().height ?? 0),
      noteFont: note ? getComputedStyle(note).fontSize : null,
      plainSnipFont: (() => {
        const plain = [...document.querySelectorAll('.snip')].find(e => !e.classList.contains('snip-note'))
        return plain ? getComputedStyle(plain).fontSize : null
      })(),
      chipsLeft: document.querySelectorAll('.wb-pre').length,
    }
  })
  report.pre.rowBefore = rowBefore
  report.paidAfterClick = paid.length
  await page.screenshot({ path: OUT + 'ai-preread-1440.jpg', quality: 82, type: 'jpeg' })
  await page.close()
}

// ---------------------------------------------------------------------------
// 3. CROSS-OBJECT SEARCH, and the tenancy proof taken off the live wire
// ---------------------------------------------------------------------------
async function search(page, term) {
  await page.keyboard.press('Meta+k')
  await page.waitForTimeout(400)
  await page.locator('.wb-cmdk-q').fill(term)
  await page.waitForTimeout(2600)
  return page.evaluate(() => {
    const t = el => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
    return {
      head: t(document.querySelector('.wb-find-h')),
      rows: [...document.querySelectorAll('.wb-find-row')].map(r => ({
        title: t(r.querySelector('.wb-cmdk-t')),
        badge: t(r.querySelector('.wb-find-badge')),
      })),
      none: [...document.querySelectorAll('.wb-cmdk-none')].map(t),
    }
  })
}

{
  const page = await boot(ctx, '#exp/v2/content', 1440, 900)
  const before = restGets.length
  report.searchIvan = await search(page, 'margin')
  await page.screenshot({ path: OUT + 'ai-search-1440.jpg', quality: 82, type: 'jpeg' })
  // switch the search lane and re-read
  await page.locator('.wb-find-lane', { hasText: 'Mattan' }).first().click().catch(() => {})
  await page.waitForTimeout(2600)
  report.searchMattan = await page.evaluate(() => {
    const t = el => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
    return {
      head: t(document.querySelector('.wb-find-h')),
      rows: [...document.querySelectorAll('.wb-find-row')].map(r => ({
        title: t(r.querySelector('.wb-cmdk-t')),
        badge: t(r.querySelector('.wb-find-badge')),
      })),
    }
  })
  await page.screenshot({ path: OUT + 'ai-search-lane-1440.jpg', quality: 82, type: 'jpeg' })
  // EVERY query the search actually put on the wire, so the lane predicate can
  // be read rather than trusted.
  report.searchQueries = restGets.slice(before)
    .filter(u => u.includes('ilike'))
    .map(u => u.split('/rest/v1/')[1])
  await page.close()
}

// ---------------------------------------------------------------------------
// 4. 390. The strip and the chip have to survive a phone.
// ---------------------------------------------------------------------------
{
  const page = await boot(ctx, '#exp/v2/dms', 390, 844)
  await page.screenshot({ path: OUT + 'ai-preread-390.jpg', quality: 82, type: 'jpeg' })
  const page2 = await boot(ctx, '#exp/v2/dms/chat', 390, 844)
  await page2.waitForTimeout(1200)
  report.mobileStrip = await page2.evaluate(() => ({
    present: !!document.querySelector('.wb-see'),
    line: (document.querySelector('.wb-see-l')?.textContent ?? '').trim(),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }))
  await page2.screenshot({ path: OUT + 'ai-context-390.jpg', quality: 82, type: 'jpeg' })
  await page.close(); await page2.close()
}

report.attemptedWrites = attempted
report.paidCalls = paid.map(p => ({ url: p.url, body: p.body.slice(0, 600) }))
report.attemptedWriteCount = attempted.length
report.paidCallCount = paid.length

writeFileSync(OUT + 'ai-probe.json', JSON.stringify(report, null, 1))
console.log(JSON.stringify({
  attemptedWrites: attempted.length,
  paidCalls: paid.length,
  paidBeforeAnyClick: report.paidBeforeClick,
  strip: report.strip,
  pre: report.pre,
  searchIvan: report.searchIvan,
  searchMattan: report.searchMattan,
  queries: report.searchQueries,
  mobileStrip: report.mobileStrip,
}, null, 1))
await ctx0.close()
