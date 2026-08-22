// PHASE 6 GATES, each answered with a number.
//   A · calendar chip <= 45% of its cell height, 1440 + 390, both themes
//   B · cell tooltip anchored to its CELL, never the viewport, every viewport
//       including hard against the right and bottom edges
//   C · .li-card measure did not widen: computed width now vs the pre-run build
//       (18c773a on :4174). `.li-card` has no width of its own and fills its
//       column, so this is a real measurement of the column, not of a constant.
//
// Read-only. Interceptor on **/rest/v1/** and **/rest/v1/rpc/** before every nav.
//
//   node gates-verify.mjs

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync } from 'node:fs'

let session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const CUR = 'http://localhost:4173/'
const PRE = 'http://localhost:4174/'
const READ_RPC = ['inbox_governor', 'pipeline_health', 'dashboard_counts', 'content_counts', 'seat_health', 'usage_', 'kpi', 'get_', 'list_', 'read_', 'fetch_', 'count_', 'search_', 'stats']
const log = { mutations: [], readRpc: [], unauthorized: [] }

const browser = await chromium.launch()

async function open(base, w, h, theme, hash) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await ctx.addInitScript(([s, th]) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
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
  await page.goto(base + hash, { waitUntil: 'networkidle', timeout: 25000 }).catch(() => {})
  await page.waitForTimeout(2000)
  return { ctx, page }
}
async function carry(page) {
  try { const f = await page.evaluate(() => localStorage.getItem('sb-bjbvqvzbzczjbatgmccb-auth-token')); if (f && f.length > 200) session = f } catch {}
}
async function toCalendar(page) {
  await page.getByText('Calendar', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(1600)
}

// ------------------------------------------------------------------ GATE A
const gateA = {}
for (const [w, h] of [[1440, 900], [390, 844]]) {
  for (const theme of ['dark', 'light']) {
    const { ctx, page } = await open(CUR, w, h, theme, '#exp/v2/content')
    await toCalendar(page)
    gateA[`${w}x${h}-${theme}`] = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('.cal-chip')]
      const rows = chips.map(c => {
        const cell = c.closest('.cal-day') || c.closest('[class*=cal-day]') || c.parentElement
        const ch = c.getBoundingClientRect().height, cellH = cell?.getBoundingClientRect().height || 0
        return cellH ? Math.round((ch / cellH) * 1000) / 10 : null
      }).filter(x => x != null)
      return {
        chips: chips.length,
        maxChipPctOfCell: rows.length ? Math.max(...rows) : null,
        medianPct: rows.length ? rows.sort((a, b) => a - b)[Math.floor(rows.length / 2)] : null,
        overCount: rows.filter(x => x > 45).length,
        chipH: chips[0] ? Math.round(chips[0].getBoundingClientRect().height) : null,
        cellH: chips[0] ? Math.round((chips[0].closest('.cal-day') || chips[0].parentElement).getBoundingClientRect().height) : null,
        plateGap: getComputedStyle(document.querySelector('.wb')).getPropertyValue('--plate-gap').trim(),
        plateRadius: getComputedStyle(document.querySelector('.wb')).getPropertyValue('--plate-r').trim(),
      }
    })
    await carry(page); await ctx.close()
  }
}

// ------------------------------------------------------------------ GATE B
// The tooltip must be positioned relative to the CELL it belongs to. The test:
// open it on the LAST cell in the grid (bottom-right corner of the month) and
// check the popover's box sits within the cell's own horizontal band and does
// not get pinned to viewport 0 or to the window edge.
const gateB = {}
for (const [w, h] of [[390, 844], [1024, 768], [1440, 900], [2560, 1440]]) {
  for (const theme of ['dark', 'light']) {
    const { ctx, page } = await open(CUR, w, h, theme, '#exp/v2/content')
    await toCalendar(page)
    const res = await page.evaluate(async () => {
      const cells = [...document.querySelectorAll('.cal-day')].filter(c => c.querySelector('.cal-chip'))
      if (!cells.length) return { note: 'no populated cell' }
      const probe = el => new Promise(r => {
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
        el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        setTimeout(r, 450)
      })
      const out = []
      // the last populated cell is the closest to the right/bottom edge
      for (const cell of [cells[0], cells[cells.length - 1]]) {
        const chip = cell.querySelector('.cal-chip')
        await probe(chip)
        const pop = document.querySelector('.cal-pop, .cal-tip, [class*=cal-pop], [role=tooltip]')
        const cr = cell.getBoundingClientRect()
        if (!pop) { out.push({ cell: cell.textContent.trim().slice(0, 6), popover: null }); continue }
        const pr = pop.getBoundingClientRect()
        const cs = getComputedStyle(pop)
        // Anchored to the cell = its offsetParent chain reaches the cell, OR its
        // box overlaps the cell's own band. Anchored to the VIEWPORT = position
        // fixed with a box that ignores where the cell is.
        let anc = pop.offsetParent, chain = false
        while (anc) { if (anc === cell || anc.contains(cell)) { chain = true; break } anc = anc.offsetParent }
        const overlapsCellBand = pr.right > cr.left - 8 && pr.left < cr.right + 8
        out.push({
          cell: cell.textContent.trim().slice(0, 6),
          position: cs.position,
          cellRect: [Math.round(cr.left), Math.round(cr.top), Math.round(cr.width)],
          popRect: [Math.round(pr.left), Math.round(pr.top), Math.round(pr.width)],
          offsetParentReachesCell: chain,
          overlapsCellBand,
          withinViewport: pr.left >= -1 && pr.right <= innerWidth + 1 && pr.top >= -1 && pr.bottom <= innerHeight + 1,
        })
      }
      return { cells: cells.length, probes: out }
    })
    gateB[`${w}x${h}-${theme}`] = res
    await carry(page); await ctx.close()
  }
}

// ------------------------------------------------------------------ GATE C
async function liCard(base, label) {
  const per = {}
  for (const [w, h] of [[1440, 900], [2560, 1440]]) {
    const { ctx, page } = await open(base, w, h, 'dark', '#exp/v2/content')
    await page.locator('[data-wbrow]').first().click({ timeout: 6000 }).catch(() => {})
    await page.waitForTimeout(2200)
    per[`${w}x${h}`] = await page.evaluate(() => {
      const c = document.querySelector('.li-card')
      if (!c) return { found: false }
      const r = c.getBoundingClientRect(), cs = getComputedStyle(c)
      const main = document.querySelector('.dw-main-in')
      return {
        found: true,
        computedWidth: Math.round(parseFloat(cs.width)),
        boxWidth: Math.round(r.width),
        authoredWidth: cs.width,
        maxWidth: cs.maxWidth,
        columnWidth: main ? Math.round(main.getBoundingClientRect().width) : null,
      }
    })
    await carry(page); await ctx.close()
  }
  return per
}
const gateC = { current: await liCard(CUR, 'cur'), preRun_18c773a: await liCard(PRE, 'pre') }

const out = {
  gateA_calendarChipShareOfCell: gateA,
  gateB_tooltipAnchoring: gateB,
  gateC_liCardMeasure: gateC,
  genuineMutationAttempts: log.mutations.length,
  mutations: [...new Set(log.mutations)],
  rpcPostsToKnownReadFunctions: log.readRpc.length,
  readRpcDistinct: [...new Set(log.readRpc)],
  unauthorized401: log.unauthorized.length,
}
writeFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/workbench-polish-2026-08-22-out/evidence/audit-tools/out-gates-verify.json', JSON.stringify(out, null, 1))
console.log(JSON.stringify(out, null, 1))
await browser.close()
