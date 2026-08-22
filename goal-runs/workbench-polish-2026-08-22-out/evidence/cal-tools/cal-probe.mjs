// THE CHIP PROBE, re-run for the calendar polish phase.
//
// Body is goal-runs/workbench-2026-plan-2026-08-21/tools/chip-probe.mjs verbatim
// in what it MEASURES. Two things are added and both are safety, not measurement:
//
//  1. The original interceptor lets POST /rest/v1/rpc/ THROUGH (line 15,
//     `!q.url().includes('/rpc/')`). Dragging a chip on this surface calls
//     operator_set_schedule_date, which is a POST to /rpc/, so the standard
//     pattern would let a live date move land. Every /rpc/ POST is now inspected:
//     a WRITE rpc is fulfilled, counted, and its payload recorded; a READ rpc
//     (inbox_range_kpis, inbox_governor) continues, because blocking it just
//     blanks the page.
//  2. The gate numbers this phase has to clear are computed here rather than
//     eyeballed off the JSON: the chip/cell lightness step, the height ratio,
//     and the visible-chip cap.
//
// Usage: node cal-probe.mjs <baseUrl> <outJsonPath> [viewportWidth] [theme] [frame]

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = process.argv[2] || 'http://localhost:4186/'
const OUT = process.argv[3] || '/tmp/cal-probe.json'
const VW = Number(process.argv[4] || 1440)
const VH = VW === 390 ? 844 : VW === 2560 ? 1440 : 900
const THEME = process.argv[5] || 'dark'
const FRAME = process.argv[6] || ''

// An rpc whose name starts with one of these WRITES. Everything else on /rpc/
// is a read and is allowed through, or the surface renders empty and the
// measurement is of nothing.
const WRITE_RPC = ['operator_', 'dashboard_action', 'n8nclaw_', 'append_agent_log']
const attempted = []

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: VW, height: VH } })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
if (THEME === 'light') await ctx.addInitScript(() => localStorage.setItem('inbox-theme', 'light'))
const page = await ctx.newPage()

// INSTALLED BEFORE ANY NAVIGATION.
await page.route('**/rest/v1/**', async r => {
  const q = r.request(), m = q.method(), url = q.url()
  const isRpc = url.includes('/rpc/')
  if (isRpc && m === 'POST') {
    const name = url.split('/rpc/')[1].split('?')[0]
    if (WRITE_RPC.some(p => name.startsWith(p))) {
      attempted.push({ kind: 'rpc', name, payload: q.postData() })
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    }
    return r.continue()
  }
  if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || m === 'POST') {
    attempted.push({ kind: m, url: url.slice(0, 160), payload: q.postData() })
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  }
  return r.continue()
})
await page.route('**/rest/v1/rpc/**', r => r.fallback())

const status = []
page.on('response', r => { if (r.status() === 401) status.push(r.url()) })

await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
await page.getByText('Calendar', { exact: true }).first().click().catch(() => {})
await page.waitForTimeout(1800)
if (FRAME) await page.evaluate(f => document.documentElement.setAttribute('data-frame', f), FRAME)
await page.waitForTimeout(300)

const out = await page.evaluate(() => {
  const px = n => Math.round(n)
  const chip = document.querySelector('.cal-chip')
  // The ORIGINAL probe read `.cal-day, [class*=cal-day]`, which matches the
  // FIRST cell in the DOM and that cell may be empty. The ratio only means
  // something against the cell the chip is actually in, so both are reported.
  const cell = document.querySelector('.cal-day, [class*=cal-day]')
  const ownCell = chip?.closest('.cal-day')
  const app = document.querySelector('.app') || document.querySelector('.wb')
  const plate = document.querySelector('.wb-shell') || document.querySelector('.wb > div')
  const cs = chip ? getComputedStyle(chip) : null
  const r = chip?.getBoundingClientRect()
  const cr = cell?.getBoundingClientRect()
  const or_ = ownCell?.getBoundingClientRect()

  const ar = app?.getBoundingClientRect()
  const pr = plate?.getBoundingClientRect()
  const frameLoss = ar && pr
    ? { left: px(pr.left - ar.left), right: px(ar.right - pr.right), top: px(pr.top - ar.top), bottom: px(ar.bottom - pr.bottom) }
    : null

  // sRGB relative luminance, so "a real lightness step" is a number and not an
  // opinion. rgb() strings only; every value here is opaque.
  const lum = s => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '')
    if (!m) return null
    const [rr, gg, bb] = m[1].split(',').map(v => parseFloat(v) / 255)
    const f = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
    return Math.round((0.2126 * f(rr) + 0.7152 * f(gg) + 0.0722 * f(bb)) * 10000) / 10000
  }

  const chipBg = cs?.backgroundColor
  const parentBg = chip ? getComputedStyle(chip.parentElement).backgroundColor : null

  const days = [...document.querySelectorAll('.cal-day')]
  const chipHeights = [...document.querySelectorAll('.cal-chip')].map(c => px(c.getBoundingClientRect().height))

  return {
    chip: cs ? {
      size: `${px(r.width)}x${px(r.height)}`,
      background: chipBg,
      borderLeft: cs.borderLeftWidth + ' ' + cs.borderLeftColor,
      borderTop: cs.borderTopWidth + ' ' + cs.borderTopColor,
      borderRight: cs.borderRightWidth,
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow,
      parentBg,
    } : 'no chip found',
    cell: cr ? `${px(cr.width)}x${px(cr.height)}` : null,
    ownCell: or_ ? `${px(or_.width)}x${px(or_.height)}` : null,
    chipShareOfCell: (r && cr) ? Math.round((r.height / cr.height) * 100) + '% of cell height' : null,
    chipShareOfOwnCell: (r && or_) ? Math.round((r.height / or_.height) * 100) + '% of cell height' : null,
    // GATE 1: the lightness step, both directions reported.
    lightnessStep: {
      chip: lum(chipBg), cell: lum(parentBg),
      delta: (lum(chipBg) != null && lum(parentBg) != null)
        ? Math.round(Math.abs(lum(chipBg) - lum(parentBg)) * 10000) / 10000 : null,
      same: chipBg === parentBg,
    },
    chipHeights: { min: Math.min(...chipHeights), max: Math.max(...chipHeights), n: chipHeights.length },
    plateGap: getComputedStyle(document.querySelector('.wb')).getPropertyValue('--plate-gap').trim(),
    plateRadius: getComputedStyle(document.querySelector('.wb')).getPropertyValue('--plate-r').trim(),
    frameLoss,
    windowW: innerWidth,
    frameCostPct: frameLoss ? Math.round(((frameLoss.left + frameLoss.right) / innerWidth) * 1000) / 10 + '% of width' : null,
    cellsWithOverflow: days.filter(c => c.scrollHeight > c.clientHeight + 2).length,
    // GATE 3, the designed overflow, measured rather than asserted.
    daysWithChips: days.filter(d => d.querySelector('.cal-chip')).length,
    daysWithTwoPlus: days.filter(d => d.querySelectorAll('.cal-chip').length >= 2).length,
    moreButtons: document.querySelectorAll('.cal-more').length,
    railWidth: px(document.querySelector('.cal-rail')?.getBoundingClientRect().width || 0),
    nativeTitleOnChip: !!document.querySelector('.cal-chip-t[title]'),
  }
})

out.attemptedWrites = attempted.length
out.attemptedWriteDetail = attempted
out.unauthorized = status
out.viewport = `${VW}x${VH}`
out.theme = THEME
out.frame = FRAME || 'default'
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 1))
console.log(JSON.stringify(out, null, 1))
if (status.length) console.error('401 SEEN, STOP, do not refresh the session.')
await browser.close()
