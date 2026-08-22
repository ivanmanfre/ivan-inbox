// PHASE 6 SWEEP. Every surface in inventory.md, four viewports, both themes.
//
// Per surface: console errors, overflow (BOTH ways, see below), and the accent
// census (accent-token elements AND saturated pixels at rest).
//
// OVERFLOW IS REPORTED TWICE, ON PURPOSE.
//   naive  — scrollWidth > clientWidth + 1 on every element. This is the test
//            baseline-metrics.json used, so it is the only number that can be
//            compared like for like against it. It counts a 3px checkbox clip on
//            every list row and every long string inside a log pane, which is
//            why the app-wide baseline was 430.
//   real   — the same test MINUS anything that is legitimately scrollable: the
//            element itself has overflow-x auto/scroll, or ANY ancestor up to
//            the root does. A child of an overflow-x:auto scroller is not
//            overflow, it is content. Also drops sub-4px clips, which are
//            control-glyph rounding, not layout escaping its column.
//
// Read-only. Write interceptor on **/rest/v1/** AND **/rest/v1/rpc/** installed
// BEFORE every navigation. RPC POSTs to known READ functions are counted
// separately from genuine mutation attempts, which must be 0.
//
//   node sweep-verify.mjs [baseUrl]

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync } from 'node:fs'

// The injected token expires mid-run. supabase-js refreshes it ITSELF, in the
// page, and rotates the refresh token when it does — so re-injecting the
// original file into the next context would present a refresh token that has
// already been spent. `session` is therefore carried forward: after each
// context, whatever the app refreshed to is read back out of localStorage and
// used for the next one. Nothing is written to .session.json and refresh.mjs is
// never run; this is the app doing its own normal thing, once, and the run
// following it.
let session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = process.argv[2] || 'http://localhost:4173/'

const READ_RPC = ['inbox_governor', 'pipeline_health', 'dashboard_counts', 'content_counts', 'seat_health', 'usage_', 'kpi', 'get_', 'list_', 'read_', 'fetch_', 'count_', 'search_', 'stats']
const log = { mutations: [], readRpc: [], unauthorized: [] }

const VIEWPORTS = [[390, 844], [1024, 768], [1440, 900], [2560, 1440]]
const THEMES = ['dark', 'light']

const SURFACES = [
  { id: 'today', hash: '#exp/v2/today' },
  { id: 'dms', hash: '#exp/v2/dms' },
  { id: 'content-list', hash: '#exp/v2/content' },
  { id: 'content-calendar', hash: '#exp/v2/content', act: async p => { await p.getByText('Calendar', { exact: true }).first().click().catch(() => {}); await p.waitForTimeout(1400) } },
  { id: 'magnets', hash: '#exp/v2/magnets' },
  { id: 'styles', hash: '#exp/v2/styles' },
  { id: 'strategy', hash: '#exp/v2/strategy' },
  { id: 'sends', hash: '#exp/v2/sends' },
  { id: 'ops', hash: '#exp/v2/ops' },
  { id: 'settings', hash: '#exp/v2/settings' },
  { id: 'chat', hash: '#exp/v2/dms/chat' },
  { id: 'draft-window', hash: '#exp/v2/content', act: async p => { await p.locator('[data-wbrow]').first().click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(1600) } },
  { id: 'thread-peer', hash: '#exp/v2/dms', act: async p => { await p.locator('[data-wbrow]').first().click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(1600) } },
  { id: 'command-palette', hash: '#exp/v2/content', act: async p => { await p.keyboard.press('Meta+k').catch(() => {}); await p.waitForTimeout(700) } },
  // added after 0758dbc: the call transcript reader, a takeover opened from the
  // Calls area on Today (`#td-z-calls .td-qrow.tap` -> CallWindow.tsx).
  { id: 'call-window', hash: '#exp/v2/today', act: async p => { await p.locator('#td-z-calls .td-qrow.tap').first().click({ timeout: 6000 }).catch(() => {}); await p.waitForTimeout(1800) } },
  { id: 'stock', hash: '#exp/stock' },
]

// ---------------------------------------------------------------- MEASURERS
const MEASURE = () => {
  const scrollable = el => {
    const o = getComputedStyle(el)
    return o.overflowX === 'auto' || o.overflowX === 'scroll' || o.overflow === 'auto' || o.overflow === 'scroll'
  }
  const all = [...document.querySelectorAll('*')]
  const naive = [], real = []
  for (const el of all) {
    const d = el.scrollWidth - el.clientWidth
    if (d <= 1) continue
    const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).slice(0, 3).join('.')
    const rec = { tag: el.tagName.toLowerCase(), cls, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, over: d }
    naive.push(rec)
    // itself a scroller? then this is content, not overflow.
    if (scrollable(el)) continue
    // any ancestor a scroller? then it is clipped by a legitimate scroller.
    let a = el.parentElement, inScroller = false
    while (a && a !== document.documentElement) { if (scrollable(a)) { inScroller = true; break } a = a.parentElement }
    if (inScroller) continue
    // sub-4px is control-glyph rounding (the 3px checkbox clip), not layout.
    if (d < 4) continue
    real.push(rec)
  }
  // does the PAGE itself scroll sideways? the only overflow a user can feel.
  const doc = document.documentElement
  const bodyOverflow = Math.max(0, doc.scrollWidth - doc.clientWidth)

  // ------------------------------------------------------- ACCENT CENSUS
  // 1. token count: elements painting the accent custom property
  const root = getComputedStyle(doc)
  const accentVars = [...doc.style, ...Array.from(document.styleSheets).slice(0, 0)]
  const ACCENT_NAMES = ['--accent', '--wb-accent', '--ground', '--pistachio', '--brand']
  const accentVals = ACCENT_NAMES.map(n => root.getPropertyValue(n).trim()).filter(Boolean)
  const norm = c => (c || '').replace(/\s+/g, '')
  let tokenEls = 0
  const tokenList = []
  for (const el of all) {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const bg = norm(cs.backgroundColor)
    if (accentVals.some(v => v && norm(v) === bg)) {
      tokenEls++
      if (tokenList.length < 30) tokenList.push({ tag: el.tagName.toLowerCase(), cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40), bg: cs.backgroundColor, w: Math.round(r.width), h: Math.round(r.height) })
    }
  }
  return { naive, real, bodyOverflow, tokenEls, tokenList, accentVals }
}

// SATURATED PIXELS AT REST, counted off the rendered image, not off the DOM.
// This is the number that does not move when the census definition moves.
async function saturatedFromPixels(page, dpage) {
  const buf = await page.screenshot({ type: 'png' })
  const b64 = buf.toString('base64')
  return dpage.evaluate(async s => {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + s })
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, c.width, c.height).data
    let sat = 0
    const total = c.width * c.height
    // HSL saturation > 0.45 AND lightness between .25 and .85 — a real colour
    // field, not a grey, not a near-black, not a near-white.
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, bl = d[i + 2] / 255
      const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl)
      const l = (mx + mn) / 2
      if (l < 0.25 || l > 0.85) continue
      const del = mx - mn
      if (del === 0) continue
      const s2 = del / (1 - Math.abs(2 * l - 1))
      if (s2 > 0.45) sat++
    }
    // connected saturated REGIONS, coarse: 8x8 blocks that are >50% saturated.
    return { saturatedPx: sat, totalPx: total, pct: Math.round((sat / total) * 10000) / 100 }
  }, b64)
}

const browser = await chromium.launch()
const differ = await browser.newContext()
const dpage = await differ.newPage()
await dpage.goto('about:blank')

const out = {}
for (const [w, h] of VIEWPORTS) {
  for (const theme of THEMES) {
    for (const s of SURFACES) {
      const key = `${s.id}-${w}x${h}-${theme}`
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
      // HARNESS BUG, FIXED. This used to also poke
      // `document.documentElement.setAttribute('data-theme', ...)` here, but
      // addInitScript runs BEFORE the document exists, so documentElement was
      // null and every single context threw a TypeError that then showed up in
      // the app's console-error count. 120 of the first run's 163 "console
      // errors" were this script, not the app. The attribute was never needed:
      // main.tsx:8-10 reads localStorage['inbox-theme'] at boot and sets it.
      await ctx.addInitScript(([ses, th]) => {
        localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', ses)
        localStorage.setItem('inbox-theme', th)
      }, [session, theme])
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
      const errs = []
      page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
      page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 300)))
      page.on('response', res => { if (res.status() === 401) log.unauthorized.push(res.url().slice(0, 100)) })
      try {
        await page.goto(BASE + s.hash, { waitUntil: 'networkidle', timeout: 25000 })
        await page.waitForTimeout(1800)
        if (s.act) await s.act(page)
        const m = await page.evaluate(MEASURE)
        const sat = await saturatedFromPixels(page, dpage)
        out[key] = {
          surface: s.id, viewport: `${w}x${h}`, theme,
          consoleErrorCount: errs.length,
          consoleErrors: [...new Set(errs)],
          overflowNaive: m.naive.length,
          overflowReal: m.real.length,
          overflowRealDetail: m.real.slice(0, 8),
          pageScrollsSideways: m.bodyOverflow,
          accentTokenElements: m.tokenEls,
          accentTokenSample: m.tokenList.slice(0, 6),
          saturatedPixels: sat.saturatedPx,
          saturatedPct: sat.pct,
        }
      } catch (e) {
        out[key] = { surface: s.id, viewport: `${w}x${h}`, theme, error: String(e).slice(0, 200), consoleErrorCount: errs.length, consoleErrors: [...new Set(errs)] }
      }
      // carry whatever the app refreshed to into the next context
      try {
        const fresh = await page.evaluate(() => localStorage.getItem('sb-bjbvqvzbzczjbatgmccb-auth-token'))
        if (fresh && fresh.length > 200) session = fresh
      } catch { /* page already gone */ }
      await ctx.close()
    }
    console.log('done', w, theme)
  }
}

const totals = {
  surfacesMeasured: Object.keys(out).length,
  consoleErrorsTotal: Object.values(out).reduce((a, x) => a + (x.consoleErrorCount || 0), 0),
  overflowNaiveTotal: Object.values(out).reduce((a, x) => a + (x.overflowNaive || 0), 0),
  overflowRealTotal: Object.values(out).reduce((a, x) => a + (x.overflowReal || 0), 0),
  pagesThatScrollSideways: Object.values(out).filter(x => (x.pageScrollsSideways || 0) > 0).length,
  genuineMutationAttempts: log.mutations.length,
  mutations: [...new Set(log.mutations)],
  rpcPostsToKnownReadFunctions: log.readRpc.length,
  readRpcDistinct: [...new Set(log.readRpc)],
  unauthorized401: log.unauthorized.length,
}
writeFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/workbench-polish-2026-08-22-out/evidence/audit-tools/out-sweep-verify2.json', JSON.stringify({ totals, surfaces: out }, null, 1))
console.log(JSON.stringify(totals, null, 1))
await browser.close()
