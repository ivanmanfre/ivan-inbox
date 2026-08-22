// PHASE 6 BALLOT RENDERS. Authed, real data, write-intercepted.
//
// Three sets:
//   1. frame-a|b|c  — data-frame arms, Content calendar + draft window, 1440/2560
//   2. density-comfortable|compact — data-density arms, DMs/Content/Styles/Settings, 1440/390
//   3. ba-<surface>-after — the "after" half of the before/after pair, framed to
//      match goal-runs/.../before/*.jpg exactly (same viewport, same theme, same
//      fullPage flag) so the two sit side by side.
//
// The write interceptor is installed on **/rest/v1/** AND **/rest/v1/rpc/**
// BEFORE any navigation. PATCH/PUT/DELETE and non-rpc POST are fulfilled with
// 200 []. Every intercepted call is classified: an RPC POST to a KNOWN READ
// function (inbox_governor et al) is a read, everything else is a genuine
// mutation attempt and must be zero.
//
//   node ballot-capture.mjs [baseUrl] [outDir]

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = process.argv[2] || 'http://localhost:4173/'
const OUT = process.argv[3] || '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/workbench-polish-2026-08-22-out/ballot'
mkdirSync(OUT, { recursive: true })

// RPC functions that are READS called by POST. Anything else reaching /rpc/
// via POST is counted as a genuine mutation attempt.
const READ_RPC = [
  'inbox_governor', 'pipeline_health', 'dashboard_counts', 'content_counts',
  'seat_health', 'usage_', 'kpi', 'get_', 'list_', 'read_', 'fetch_', 'count_',
  'search_', 'stats',
]
const log = { mutations: [], readRpc: [], unauthorized: [], consoleErrors: [] }

async function newCtx(browser, w, h, theme, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await ctx.addInitScript(([s, th, frame, density]) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
    if (th === 'light') { localStorage.setItem('inbox-theme', 'light'); document.documentElement.setAttribute('data-theme', 'light') }
    else { localStorage.setItem('inbox-theme', 'dark'); document.documentElement.removeAttribute('data-theme') }
    if (frame) document.documentElement.setAttribute('data-frame', frame)
    if (density) { localStorage.setItem('inbox-density', density); document.documentElement.setAttribute('data-density', density) }
  }, [session, theme, extra.frame || '', extra.density || ''])

  const install = async r => {
    const q = r.request(), m = q.method(), url = q.url()
    const isRpc = url.includes('/rpc/')
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
  await ctx.route('**/rest/v1/**', install)
  await ctx.route('**/rest/v1/rpc/**', install)

  const page = await ctx.newPage()
  page.on('response', res => { if (res.status() === 401) log.unauthorized.push(res.url().slice(0, 120)) })
  page.on('console', m => { if (m.type() === 'error') log.consoleErrors.push(m.text().slice(0, 200)) })
  return { ctx, page }
}

async function settle(page, ms = 2200) { await page.waitForTimeout(ms) }

async function openCalendar(page) {
  await page.getByText('Calendar', { exact: true }).first().click().catch(() => {})
  await settle(page, 1600)
}

async function openDraft(page) {
  // Row click in the content list opens the draft takeover.
  const row = page.locator('[data-wbrow]').first()
  await row.click({ timeout: 6000 }).catch(() => {})
  await settle(page, 1800)
  const ok = await page.locator('.dw-main-in, .dw-insp-h, .li-card').count()
  return ok > 0
}

async function shot(page, name, fullPage = false) {
  await page.screenshot({ path: join(OUT, name + '.jpg'), type: 'jpeg', quality: 82, fullPage })
}

const browser = await chromium.launch()

// ---------------------------------------------------------------- 1 · FRAME
for (const frame of ['a', 'b', 'c']) {
  for (const w of [1440, 2560]) {
    const h = w === 2560 ? 1440 : 900
    // calendar
    let { ctx, page } = await newCtx(browser, w, h, 'dark', { frame })
    await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' }).catch(() => {})
    await settle(page)
    await openCalendar(page)
    await page.evaluate(f => document.documentElement.setAttribute('data-frame', f), frame)
    await page.waitForTimeout(500)
    await shot(page, `frame-${frame}-calendar-${w}x${h}-dark`)
    await ctx.close()
    // draft window
    ;({ ctx, page } = await newCtx(browser, w, h, 'dark', { frame }))
    await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' }).catch(() => {})
    await settle(page)
    const opened = await openDraft(page)
    await page.evaluate(f => document.documentElement.setAttribute('data-frame', f), frame)
    await page.waitForTimeout(500)
    await shot(page, `frame-${frame}-draft-window-${w}x${h}-dark`)
    if (!opened) log.consoleErrors.push(`NOTE draft window did not open for frame-${frame}-${w}`)
    await ctx.close()
    console.log('frame', frame, w, 'done')
  }
}

// -------------------------------------------------------------- 2 · DENSITY
const DENSITY_SURFACES = [
  { id: 'dms', hash: '#exp/v2/dms' },
  { id: 'content', hash: '#exp/v2/content' },
  { id: 'styles', hash: '#exp/v2/styles' },
  { id: 'settings', hash: '#exp/v2/settings' },
]
for (const density of ['comfortable', 'compact']) {
  for (const s of DENSITY_SURFACES) {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const { ctx, page } = await newCtx(browser, w, h, 'dark', { density })
      await page.goto(BASE + s.hash, { waitUntil: 'networkidle' }).catch(() => {})
      await settle(page)
      await page.evaluate(d => document.documentElement.setAttribute('data-density', d), density)
      await page.waitForTimeout(500)
      await shot(page, `density-${density}-${s.id}-${w}x${h}-dark`, true)
      await ctx.close()
    }
  }
  console.log('density', density, 'done')
}

// ------------------------------------------------------- 3 · BEFORE / AFTER
// Framed to match before/*.jpg: same viewport, same theme, same fullPage flag.
const BA = [
  { id: 'content-list', hash: '#exp/v2/content', fullPage: true },
  { id: 'calendar', hash: '#exp/v2/content', act: openCalendar, fullPage: false },
  { id: 'draft-window', hash: '#exp/v2/content', act: openDraft, fullPage: false },
  { id: 'today', hash: '#exp/v2/today', fullPage: true },
  { id: 'dms-list', hash: '#exp/v2/dms', fullPage: true },
]
for (const s of BA) {
  const { ctx, page } = await newCtx(browser, 1440, 900, 'dark')
  await page.goto(BASE + s.hash, { waitUntil: 'networkidle' }).catch(() => {})
  await settle(page)
  if (s.act) await s.act(page)
  await shot(page, `ba-${s.id}-after`, s.fullPage)
  await ctx.close()
  console.log('ba', s.id, 'done')
}

writeFileSync(join(OUT, 'ballot-write-log.json'), JSON.stringify({
  genuineMutationAttempts: log.mutations.length,
  mutations: [...new Set(log.mutations)],
  rpcPostsToKnownReadFunctions: log.readRpc.length,
  readRpcDistinct: [...new Set(log.readRpc)],
  unauthorized401: log.unauthorized.length,
  unauthorizedSample: [...new Set(log.unauthorized)].slice(0, 5),
  consoleErrors: [...new Set(log.consoleErrors)],
}, null, 1))
console.log('MUTATIONS', log.mutations.length, 'READ_RPC_POSTS', log.readRpc.length, '401s', log.unauthorized.length)
await browser.close()
