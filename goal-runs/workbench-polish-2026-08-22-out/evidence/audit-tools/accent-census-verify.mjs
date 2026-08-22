// GATE · EXACTLY ONE ACCENT-WEIGHTED PRIMARY ACTION PER SCREEN.
//
// TWO NUMBERS PER SCREEN, and the second one is the truth.
//
//   1. accentTokenElements — DOM census: how many visible, non-trivial elements
//      paint --accent / --accent-ui / --ground as their background. This is the
//      number a census definition can quietly move.
//
//   2. saturatedRegionsAtRest — counted off the RENDERED PIXELS, not the DOM.
//      The screenshot is thresholded to "a real colour field" (HSL saturation
//      > 0.45, lightness 0.25-0.85), then flood-filled into connected regions,
//      and regions smaller than 120px are dropped as antialiasing and glyph
//      fringing. Nothing about this number depends on what the census calls an
//      accent, which is exactly why it is the one that counts: a prior
//      candidate reported 1 while showing 15, because the definition moved
//      rather than the colour leaving.
//
// "At rest" is literal: no hover, no focus, no open menu. Load, settle, shoot.
//
//   node accent-census-verify.mjs [baseUrl]

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync } from 'node:fs'

let session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = process.argv[2] || 'http://localhost:4173/'
const READ_RPC = ['inbox_governor', 'pipeline_health', 'dashboard_counts', 'content_counts', 'seat_health', 'usage_', 'kpi', 'get_', 'list_', 'read_', 'fetch_', 'count_', 'search_', 'stats']
const log = { mutations: [], readRpc: [], unauthorized: [] }

const SCREENS = [
  { id: 'today', hash: '#exp/v2/today' },
  { id: 'dms', hash: '#exp/v2/dms' },
  { id: 'content-list', hash: '#exp/v2/content' },
  { id: 'content-calendar', hash: '#exp/v2/content', act: async p => { await p.getByText('Calendar', { exact: true }).first().click().catch(() => {}); await p.waitForTimeout(1500) } },
  { id: 'magnets', hash: '#exp/v2/magnets' },
  { id: 'styles', hash: '#exp/v2/styles' },
  { id: 'strategy', hash: '#exp/v2/strategy' },
  { id: 'sends', hash: '#exp/v2/sends' },
  { id: 'ops', hash: '#exp/v2/ops' },
  { id: 'settings', hash: '#exp/v2/settings' },
  { id: 'draft-window', hash: '#exp/v2/content', act: async p => { await p.locator('[data-wbrow]').first().click({ timeout: 6000 }).catch(() => {}); await p.waitForTimeout(1800) } },
]

const browser = await chromium.launch()
const differ = await browser.newContext()
const dpage = await differ.newPage()
await dpage.goto('about:blank')

async function regions(page) {
  const b64 = (await page.screenshot({ type: 'png' })).toString('base64')
  return dpage.evaluate(async s => {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + s })
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, c.width, c.height).data
    const W = c.width, H = c.height
    const mask = new Uint8Array(W * H)
    let sat = 0
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const r = d[i] / 255, g = d[i + 1] / 255, bl = d[i + 2] / 255
      const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl)
      const l = (mx + mn) / 2
      if (l < 0.25 || l > 0.85) continue
      const del = mx - mn
      if (del === 0) continue
      if (del / (1 - Math.abs(2 * l - 1)) > 0.45) { mask[p] = 1; sat++ }
    }
    // connected components, 4-neighbour, iterative stack (no recursion depth cap)
    const seen = new Uint8Array(W * H)
    const out = []
    const stack = new Int32Array(W * H)
    for (let p0 = 0; p0 < mask.length; p0++) {
      if (!mask[p0] || seen[p0]) continue
      let sp = 0; stack[sp++] = p0; seen[p0] = 1
      let area = 0, minx = W, maxx = 0, miny = H, maxy = 0
      let rs = 0, gs = 0, bs = 0
      while (sp > 0) {
        const p = stack[--sp]
        area++
        const px = p % W, py = (p - px) / W
        if (px < minx) minx = px; if (px > maxx) maxx = px
        if (py < miny) miny = py; if (py > maxy) maxy = py
        rs += d[p * 4]; gs += d[p * 4 + 1]; bs += d[p * 4 + 2]
        if (px > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1 }
        if (px < W - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1 }
        if (py > 0 && mask[p - W] && !seen[p - W]) { seen[p - W] = 1; stack[sp++] = p - W }
        if (py < H - 1 && mask[p + W] && !seen[p + W]) { seen[p + W] = 1; stack[sp++] = p + W }
      }
      if (area >= 120) out.push({ area, w: maxx - minx + 1, h: maxy - miny + 1, at: [minx, miny], rgb: [Math.round(rs / area), Math.round(gs / area), Math.round(bs / area)] })
    }
    out.sort((a, b) => b.area - a.area)
    return { saturatedPixels: sat, totalPixels: W * H, regionCount: out.length, regions: out.slice(0, 12) }
  }, b64)
}

const out = {}
for (const theme of ['dark', 'light']) {
  for (const s of SCREENS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    await ctx.addInitScript(([ses, th]) => {
      localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', ses)
      if (th === 'light') { localStorage.setItem('inbox-theme', 'light'); document.documentElement.setAttribute('data-theme', 'light') }
      else { localStorage.setItem('inbox-theme', 'dark'); document.documentElement.removeAttribute('data-theme') }
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
    page.on('response', res => { if (res.status() === 401) log.unauthorized.push(res.url().slice(0, 100)) })
    try {
      await page.goto(BASE + s.hash, { waitUntil: 'networkidle', timeout: 25000 })
      await page.waitForTimeout(2000)
      if (s.act) await s.act(page)
      const dom = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement)
        const names = ['--accent', '--accent-ui', '--ground', '--accent-soft']
        const vals = names.map(n => ({ n, v: root.getPropertyValue(n).trim() })).filter(x => x.v)
        const norm = c => (c || '').replace(/\s+/g, '').toLowerCase()
        const hexToRgb = h => {
          const m = h.replace('#', '')
          if (m.length < 6) return null
          return `rgb(${parseInt(m.slice(0, 2), 16)},${parseInt(m.slice(2, 4), 16)},${parseInt(m.slice(4, 6), 16)})`
        }
        const targets = new Set()
        for (const { v } of vals) { targets.add(norm(v)); const r = hexToRgb(v); if (r) targets.add(norm(r)) }
        let n = 0; const list = []
        for (const el of document.querySelectorAll('*')) {
          const cs = getComputedStyle(el)
          if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue
          const r = el.getBoundingClientRect()
          if (r.width < 3 || r.height < 3) continue
          if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
          if (targets.has(norm(cs.backgroundColor))) {
            n++
            if (list.length < 15) list.push({ tag: el.tagName.toLowerCase(), cls: (typeof el.className === 'string' ? el.className : '').slice(0, 48), bg: cs.backgroundColor, box: [Math.round(r.width), Math.round(r.height)], text: (el.innerText || '').trim().slice(0, 24) })
          }
        }
        return { tokens: vals, accentTokenElements: n, sample: list }
      })
      const px = await regions(page)
      out[`${s.id}-${theme}`] = {
        screen: s.id, theme,
        accentTokenElements: dom.accentTokenElements,
        accentTokenSample: dom.sample,
        saturatedRegionsAtRest: px.regionCount,
        saturatedPixels: px.saturatedPixels,
        saturatedPct: Math.round((px.saturatedPixels / px.totalPixels) * 10000) / 100,
        largestRegions: px.regions,
      }
      console.log(`${s.id}/${theme}: tokens=${dom.accentTokenElements} saturatedRegions=${px.regionCount}`)
    } catch (e) {
      out[`${s.id}-${theme}`] = { screen: s.id, theme, error: String(e).slice(0, 160) }
    }
    try { const f = await page.evaluate(() => localStorage.getItem('sb-bjbvqvzbzczjbatgmccb-auth-token')); if (f && f.length > 200) session = f } catch {}
    await ctx.close()
  }
}

writeFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/workbench-polish-2026-08-22-out/evidence/audit-tools/out-accent-census-verify.json', JSON.stringify({
  screens: out,
  genuineMutationAttempts: log.mutations.length,
  mutations: [...new Set(log.mutations)],
  rpcPostsToKnownReadFunctions: log.readRpc.length,
  readRpcDistinct: [...new Set(log.readRpc)],
  unauthorized401: log.unauthorized.length,
}, null, 1))
console.log('MUTATIONS', log.mutations.length, 'READ_RPC', log.readRpc.length, '401s', log.unauthorized.length)
await browser.close()
