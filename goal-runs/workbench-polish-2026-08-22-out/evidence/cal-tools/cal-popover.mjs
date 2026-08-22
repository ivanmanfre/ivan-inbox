// THE POPOVER, AT EVERY EDGE, ON EVERY CANVAS.
//
// Anchoring fails at the edges and nowhere else, so the edges are the test.
// For each viewport this hovers the FIRST chip, the LAST chip in the top week
// (the right edge), the first chip in the bottom week (the bottom edge), and
// the leftmost chip (the left edge), and asserts three things each time:
//
//   1. the panel is inside the viewport on all four sides;
//   2. the panel does not overlap the CELL it is describing;
//   3. the panel is actually anchored, i.e. within a sane distance of its chip
//      rather than parked in a corner, which is the failure Ivan saw.
//
// Escape and keyboard-focus opening are exercised too, because a native title
// could do neither and that is half the reason it was replaced.
//
// Write interceptor installed BEFORE navigation, covering /rpc/ POSTs.
// Usage: node cal-popover.mjs <baseUrl> <outJson> [screenshotDir]

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = process.argv[2] || 'http://localhost:4186/'
const OUT = process.argv[3] || '/tmp/cal-popover.json'
const SHOTS = process.argv[4] || null
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
mkdirSync(dirname(OUT), { recursive: true })

const WRITE_RPC = ['operator_', 'dashboard_action', 'n8nclaw_', 'append_agent_log']
const attempted = []
const unauthorized = []

const VIEWPORTS = [
  { w: 1440, h: 900, theme: 'dark' },
  { w: 1440, h: 900, theme: 'light' },
  { w: 2560, h: 1440, theme: 'dark' },
  { w: 390, h: 844, theme: 'dark' },
  // SHORT ON PURPOSE. Every other canvas has room below the cell, so `below`
  // always wins and the FLIP never runs in a browser. A 520px viewport forces
  // it, which is the branch that decides whether the bottom edge works.
  { w: 1280, h: 520, theme: 'dark' },
]

async function install(page) {
  await page.route('**/rest/v1/**', async r => {
    const q = r.request(), m = q.method(), url = q.url()
    if (url.includes('/rpc/') && m === 'POST') {
      const name = url.split('/rpc/')[1].split('?')[0]
      if (WRITE_RPC.some(p => name.startsWith(p))) {
        attempted.push({ kind: 'rpc', name, payload: q.postData() })
        return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      }
      return r.continue()
    }
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || m === 'POST') {
      attempted.push({ kind: m, url: url.slice(0, 160) })
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  })
  page.on('response', x => { if (x.status() === 401) unauthorized.push(x.url()) })
}

const rects = async (page) => page.evaluate(() => {
  const pop = document.querySelector('.cal-pop')
  if (!pop) return null
  const p = pop.getBoundingClientRect()
  const chip = document.querySelector('.cal-chip-t[aria-describedby], .cal-chip-t:focus')
  const cell = chip?.closest('.cal-day')
  const c = cell?.getBoundingClientRect()
  const ch = chip?.getBoundingClientRect()
  const px = n => Math.round(n)
  return {
    pop: { l: px(p.left), t: px(p.top), r: px(p.right), b: px(p.bottom), w: px(p.width), h: px(p.height) },
    cell: c ? { l: px(c.left), t: px(c.top), r: px(c.right), b: px(c.bottom) } : null,
    chip: ch ? { l: px(ch.left), t: px(ch.top) } : null,
    side: pop.getAttribute('data-side'),
    role: pop.getAttribute('role'),
    describedBy: chip?.getAttribute('aria-describedby') ?? null,
    vw: innerWidth, vh: innerHeight,
    text: (pop.textContent || '').slice(0, 90),
  }
})

function judge(r) {
  if (!r) return { ok: false, why: 'no panel rendered' }
  const inView = r.pop.l >= 0 && r.pop.t >= 0 && r.pop.r <= r.vw && r.pop.b <= r.vh
  const overlapsCell = !!r.cell
    && r.pop.l < r.cell.r && r.pop.r > r.cell.l
    && r.pop.t < r.cell.b && r.pop.b > r.cell.t
  // Anchored, not parked: the panel's own left edge is within 400px of the
  // chip's. A viewport-corner tooltip fails this by hundreds of pixels.
  const anchored = !!r.chip && Math.abs(r.pop.l - r.chip.l) <= 400
  return { ok: inView && !overlapsCell && anchored, inView, overlapsCell, anchored }
}

const results = []
const browser = await chromium.launch()

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  if (vp.theme === 'light') await ctx.addInitScript(() => localStorage.setItem('inbox-theme', 'light'))
  const page = await ctx.newPage()
  await install(page)
  await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.getByText('Calendar', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(1500)

  // The four extremes, chosen by measured position rather than by index, so
  // this keeps testing the edges as the month's data moves.
  const picks = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.cal-chip-t')]
    if (!chips.length) return {}
    const box = c => c.getBoundingClientRect()
    const by = (f) => chips.map((c, i) => ({ i, v: f(box(c)) })).sort((a, b) => a.v - b.v)
    return {
      first: 0,
      rightmost: by(r => -r.right)[0].i,
      leftmost: by(r => r.left)[0].i,
      bottommost: by(r => -r.bottom)[0].i,
    }
  })

  for (const [name, idx] of Object.entries(picks)) {
    const el = page.locator('.cal-chip-t').nth(idx)
    if (!(await el.count())) continue
    await el.scrollIntoViewIfNeeded().catch(() => {})
    await el.hover().catch(() => {})
    await page.waitForTimeout(320)
    const r = await rects(page)
    const v = judge(r)
    results.push({ viewport: `${vp.w}x${vp.h}`, theme: vp.theme, edge: name, ...v, measured: r })
    if (SHOTS && name === 'rightmost' && vp.theme === 'dark') {
      await page.screenshot({
        path: join(SHOTS, `cal-popover-right-edge-${vp.w}x${vp.h}-${vp.theme}.jpg`),
        quality: 84, type: 'jpeg',
      })
    }
    if (SHOTS && name === 'bottommost' && vp.theme === 'dark') {
      await page.screenshot({
        path: join(SHOTS, `cal-popover-bottom-edge-${vp.w}x${vp.h}-${vp.theme}.jpg`),
        quality: 84, type: 'jpeg',
      })
    }
    await page.mouse.move(2, 2)
    await page.waitForTimeout(200)
  }

  // KEYBOARD. A native title could not do this at all, so it is asserted
  // rather than assumed: focus opens the panel, Escape closes it.
  const kb = await (async () => {
    const el = page.locator('.cal-chip-t').first()
    await el.focus().catch(() => {})
    await page.waitForTimeout(300)
    const opened = await page.locator('.cal-pop').count()
    const described = await el.getAttribute('aria-describedby')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    const afterEscape = await page.locator('.cal-pop').count()
    return { openedOnFocus: opened === 1, describedBy: described, closedByEscape: afterEscape === 0 }
  })()
  results.push({ viewport: `${vp.w}x${vp.h}`, theme: vp.theme, edge: 'keyboard', ...kb, ok: kb.openedOnFocus && kb.closedByEscape && !!kb.describedBy })

  await ctx.close()
}

await browser.close()

const out = {
  results,
  allPass: results.every(r => r.ok),
  attemptedWrites: attempted.length,
  attemptedWriteDetail: attempted,
  unauthorized,
}
writeFileSync(OUT, JSON.stringify(out, null, 1))
for (const r of results) {
  console.log(`${r.viewport} ${r.theme} ${r.edge.padEnd(11)} ok=${r.ok}`,
    r.measured ? `side=${r.side ?? r.measured.side} inView=${r.inView} overlapsCell=${r.overlapsCell} anchored=${r.anchored}` : JSON.stringify({ o: r.openedOnFocus, e: r.closedByEscape, d: r.describedBy }))
}
console.log('ALL PASS:', out.allPass, '| attempted writes:', out.attemptedWrites, '| 401s:', unauthorized.length)
