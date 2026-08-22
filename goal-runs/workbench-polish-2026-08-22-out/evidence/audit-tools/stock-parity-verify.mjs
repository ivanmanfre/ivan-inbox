// GATE 3 · #exp/stock IS PIXEL-IDENTICAL.
//
// Method: SAME WINDOW, WITH A DRIFT CONTROL.
//   pre  = commit 18c773a, built into /tmp/wb-prerun, served on :4174
//   cur  = branch wb/polish HEAD, served on :4173
//   ctl  = :4173 captured TWICE, same build, same window
// The control pair is the noise floor: a clock, a relative timestamp, a
// lazily-arriving row and JPEG requantisation all land in it. A pre-vs-cur
// number at or below the control is not a difference. A stale baseline reports
// the clock as a change, which is exactly what the control exists to catch.
//
// Eleven components render in BOTH shells (inventory.md §11) and this run
// touched TodayScreen.tsx, InboxScreen.tsx and RestoreStrip.tsx, so every stock
// tab that mounts one of those is captured, not just the boot tab.
//
// Read-only: write interceptor on **/rest/v1/** and **/rest/v1/rpc/** before
// every navigation.
//
//   node stock-parity-verify.mjs

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const OUT = '/tmp/stock-parity'
mkdirSync(OUT, { recursive: true })

const PRE = 'http://localhost:4174/'
// My own isolated build, served out of /private/tmp/wb-hd/dist. :4173 and :4176
// are rebuilt by other agents mid-run, and 127.0.0.1 rather than `localhost`
// because the static server binds v4 only while `localhost` resolves to ::1
// first on this machine.
const CUR = 'http://127.0.0.1:4191/'

const READ_RPC = ['inbox_governor', 'pipeline_health', 'dashboard_counts', 'content_counts', 'seat_health', 'usage_', 'kpi', 'get_', 'list_', 'read_', 'fetch_', 'count_', 'search_', 'stats']
const log = { mutations: [], readRpc: [], unauthorized: [] }

// Stock tabs that mount a shared component this run touched.
const TABS = [
  { id: 'today', hash: '#exp/stock', label: 'Today' },
  { id: 'inbox', hash: '#exp/stock', label: 'Inbox' },
  { id: 'drafts', hash: '#exp/stock', label: 'Drafts' },
  { id: 'ops', hash: '#exp/stock', label: 'Ops' },
  { id: 'sends', hash: '#exp/stock', label: 'Sends' },
  { id: 'settings', hash: '#exp/stock', label: 'Settings' },
]

const browser = await chromium.launch()

async function capture(base, t, label) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(([s]) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
    localStorage.setItem('inbox-theme', 'dark')
  }, [session])
  const route = async r => {
    const q = r.request(), m = q.method(), url = q.url(), isRpc = url.includes('/rpc/')
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !isRpc)) {
      log.mutations.push(`${m} ${url.split('/rest/v1/')[1]}`)
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    if (m === 'POST' && isRpc) {
      const fn = url.split('/rpc/')[1].split('?')[0]
      if (READ_RPC.some(p => fn.startsWith(p) || fn.includes(p))) log.readRpc.push(fn)
      else { log.mutations.push(`RPC ${fn}`); return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) }
    }
    return r.continue()
  }
  await ctx.route('**/rest/v1/**', route)
  await ctx.route('**/rest/v1/rpc/**', route)
  const page = await ctx.newPage()
  page.on('response', res => { if (res.status() === 401) log.unauthorized.push(res.url().slice(0, 100)) })
  await page.goto(base + t.hash, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2000)
  // Stock's tab state is component state, not a hash, and the tab is a plain
  // `div.tb` with its label in a `div.l` child (TabBar.tsx:7-31) — NOT a
  // button, so getByRole('button') matched nothing and every "tab" was really
  // the boot screen six times over. Click the label exactly.
  const tab = page.locator('.tabbar .tb').filter({ has: page.locator('.l', { hasText: new RegExp(`^${t.label}$`) }) }).first()
  await tab.click({ timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const landed = await page.locator('.tabbar .tb.on .l').first().innerText().catch(() => '?')
  const p = join(OUT, `${label}-${t.id}.png`)
  await page.screenshot({ path: p, fullPage: false })
  await ctx.close()
  return { p, landed }
}

// No pngjs / PIL / ImageMagick on this machine, so the PNGs are decoded by the
// browser itself: both images are handed to a blank page as data URLs, drawn to
// a canvas, and compared with getImageData. Exact same decoder for both sides.
const differ = await browser.newContext()
const dpage = await differ.newPage()
await dpage.goto('about:blank')
async function diff(a, b) {
  const A = readFileSync(a).toString('base64'), B = readFileSync(b).toString('base64')
  return dpage.evaluate(async ([a64, b64]) => {
    const load = s => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + s })
    const [ia, ib] = await Promise.all([load(a64), load(b64)])
    if (ia.width !== ib.width || ia.height !== ib.height) return { differing: -1, note: `size ${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` }
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height
    const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data
    x.clearRect(0, 0, c.width, c.height)
    x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < da.length; i += 4) {
      if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) n++
    }
    const total = c.width * c.height
    return { differing: n, total, pct: Math.round((n / total) * 10000) / 100 }
  }, [A, B])
}

const results = {}
for (const t of TABS) {
  // Order matters as little as possible: interleave so wall-clock drift lands
  // in both the control and the comparison, not only in one of them.
  const cur1 = await capture(CUR, t, 'cur1')
  const pre = await capture(PRE, t, 'pre')
  const cur2 = await capture(CUR, t, 'cur2')
  results[t.id] = {
    landedOn: { cur: cur2.landed, pre: pre.landed },
    control_cur_vs_cur: await diff(cur1.p, cur2.p),
    gate_pre_vs_cur: await diff(pre.p, cur2.p),
  }
  console.log(t.id, 'control', results[t.id].control_cur_vs_cur.differing, 'gate', results[t.id].gate_pre_vs_cur.differing)
}

const out = {
  method: 'same window, three captures per tab: cur, pre, cur. control = cur vs cur (noise floor). gate = pre vs cur.',
  preBuild: '18c773a via /tmp/wb-prerun on :4174',
  curBuild: 'e748f44 + the SettingsScreen shell scoping, on :4191 (own isolated build)',
  results,
  genuineMutationAttempts: log.mutations.length,
  mutations: [...new Set(log.mutations)],
  rpcPostsToKnownReadFunctions: log.readRpc.length,
  unauthorized401: log.unauthorized.length,
}
writeFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/workbench-polish-2026-08-22-out/evidence/audit-tools/out-stock-parity-verify.json', JSON.stringify(out, null, 1))
console.log(JSON.stringify(out.results, null, 1))
console.log('MUTATIONS', log.mutations.length, 'READ_RPC', log.readRpc.length, '401s', log.unauthorized.length)
await browser.close()
