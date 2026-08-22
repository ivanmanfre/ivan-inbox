// P4A verification, authed, against real rows. READ ONLY BY CONSTRUCTION:
// every mutating REST call is intercepted before it leaves the page, and the
// RPC route is intercepted too (an RPC is a POST to /rpc/, which the plain
// write interceptor lets through) so a click-through that would date or arm a
// live row is asserted instead of landing.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync } from 'node:fs'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = 'http://localhost:4181/'
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox-pw-a/goal-runs/workbench-polish-2026-08-22-out/after/'

const attempted = []          // every write this run stopped, RPC payloads included

async function newPage(ctx) {
  const page = await ctx.newPage()
  // 1. the plain write interceptor, lines 13-19 of chip-probe.mjs
  await page.route('**/rest/v1/**', async r => {
    const q = r.request(), m = q.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
      attempted.push({ kind: 'rest', method: m, url: q.url(), body: q.postData() })
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  })
  // 2. the RPC interceptor. Registered AFTER, so playwright runs it first.
  await page.route('**/rest/v1/rpc/**', async r => {
    attempted.push({ kind: 'rpc', method: r.request().method(), url: r.request().url(), body: r.request().postData() })
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'blocked_by_probe' }) })
  })
  return page
}

async function open(ctx, { lane, months = 0 }) {
  const page = await newPage(ctx)
  await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2200)
  if (lane) {
    await page.locator('.ct-cmd-lane', { hasText: lane }).first().click()
    await page.waitForTimeout(3000)
  }
  await page.getByText('Calendar', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(1800)
  for (let i = 0; i < months; i++) {
    await page.click('button[aria-label="Next month"]')
    await page.waitForTimeout(500)
  }
  return page
}

const read = page => page.evaluate(() => {
  const t = el => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const rail = document.querySelector('.cal-rail')
  const list = document.querySelector('.cal-rail-l')
  const grid = document.querySelector('.cal-grid')
  const body = document.querySelector('.cal-body')
  const chips = [...document.querySelectorAll('.cal-chip')]
  const chipW = chips.map(c => Math.round(c.getBoundingClientRect().width))
  // does the head line clip its own word?
  const clipped = chips.filter(c => {
    const h = c.querySelector('.cal-chip-h')
    return h && h.scrollWidth > h.clientWidth + 1
  }).length
  return {
    month: t(document.querySelector('.cal-month')),
    counts: [...document.querySelectorAll('.cal-count')].map(t),
    railTitle: t(rail?.querySelector('.wb-sech-t')),
    railCount: t(rail?.querySelector('.wb-sech-c')),
    railRows: document.querySelectorAll('.cal-rr').length,
    railDraggable: document.querySelectorAll('.cal-rr[draggable="true"]').length,
    railMoveBtns: document.querySelectorAll('.cal-rr .cal-mv').length,
    railAges: [...document.querySelectorAll('.cal-rr-age')].slice(0, 4).map(t),
    railScrollH: list ? Math.round(list.getBoundingClientRect().height) : null,
    railContentH: list ? list.scrollHeight : null,
    bodyH: body ? Math.round(body.getBoundingClientRect().height) : null,
    gridH: grid ? Math.round(grid.getBoundingClientRect().height) : null,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    chips: chips.length,
    armed: document.querySelectorAll('.cal-chip[data-arm="armed"]').length,
    planned: document.querySelectorAll('.cal-chip[data-arm="planned"]').length,
    out: document.querySelectorAll('.cal-chip[data-arm="out"]').length,
    armWords: [...new Set([...document.querySelectorAll('.cal-chip-arm')].map(t))],
    armBtns: document.querySelectorAll('.cal-chip-armb').length,
    chipMinW: chipW.length ? Math.min(...chipW) : null,
    headClipped: clipped,
  }
})

const browser = await chromium.launch()
const report = {}

for (const [tag, vp, lane, months] of [
  ['1440-ivan', { width: 1440, height: 900 }, null, 0],
  ['2560-ivan', { width: 2560, height: 1440 }, null, 0],
  ['390-ivan', { width: 390, height: 844 }, null, 0],
  ['1440-rise-aug', { width: 1440, height: 900 }, 'Mattan Danino', 0],
  ['1440-rise-sep', { width: 1440, height: 900 }, 'Mattan Danino', 1],
  ['2560-rise-aug', { width: 2560, height: 1440 }, 'Mattan Danino', 0],
  ['390-rise-aug', { width: 390, height: 844 }, 'Mattan Danino', 0],
]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  const page = await open(ctx, { lane, months })
  report[tag] = await read(page)
  await page.screenshot({ path: `${OUT}p4a-${tag}.jpg`, type: 'jpeg', quality: 82, fullPage: false })
  await page.close(); await ctx.close()
  console.log(tag, JSON.stringify(report[tag]))
}

writeFileSync(`${OUT}p4a-probe.json`, JSON.stringify({ report, attempted }, null, 2))
console.log('\nATTEMPTED WRITES (all stopped):', attempted.length)
for (const a of attempted) console.log(' ', a.kind, a.method, a.url.split('/rest/v1/')[1], a.body)
await browser.close()
