// THE AFTER SET. Framed to match `before/`, plus the six shots this phase owes.
//
// The plain viewport/theme shots reuse `evidence/capture.mjs`'s surface-02
// recipe verbatim (same hash, same Calendar click, same fullPage flag, same
// jpeg quality) so the before and the after are the same instrument pointed at
// two builds rather than two instruments.
//
// The rest are the cases live data does not contain or a screenshot cannot
// reach by loading a page: a two-post day, an overflow cell with its panel
// open, a chip mid-drag, and one shot per frame arm. The two-post and overflow
// shots run through cal-fixture.mjs, which rewrites a READ in flight, and they
// are labelled `-fixture` in the filename so nobody mistakes them for Ivan's
// month.
//
// Write interceptor before every navigation, /rpc/ included. Count printed.
//
// Usage: node cal-after.mjs <baseUrl> <outDir> <evidenceJson>

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fixturePage, FIXTURE, counters } from './cal-fixture.mjs'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = process.argv[2] || 'http://localhost:4186/'
const OUT = process.argv[3] || 'goal-runs/workbench-polish-2026-08-22-out/after'
const EV = process.argv[4] || 'goal-runs/workbench-polish-2026-08-22-out/evidence/cal-tools/after-shots.json'
mkdirSync(OUT, { recursive: true })

const WRITE_RPC = ['operator_', 'dashboard_action', 'n8nclaw_', 'append_agent_log']
const attempted = []
const unauthorized = []
const shots = []

async function plainPage(browser, { w, h, theme, frame }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  if (theme === 'light') await ctx.addInitScript(() => localStorage.setItem('inbox-theme', 'light'))
  const page = await ctx.newPage()
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
  await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1200)
  await page.getByText('Calendar', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(700)
  if (frame) await page.evaluate(f => document.documentElement.setAttribute('data-frame', f), frame)
  await page.waitForTimeout(300)
  return { ctx, page }
}

async function shoot(page, name, fullPage = true) {
  await page.screenshot({ path: join(OUT, name), quality: 82, type: 'jpeg', fullPage })
  shots.push(name)
  console.log('OK ', name)
}

const browser = await chromium.launch()

// ---- 1. the before-framing set -------------------------------------------
for (const vp of [{ w: 1440, h: 900 }, { w: 2560, h: 1440 }, { w: 390, h: 844 }]) {
  for (const theme of ['dark', 'light']) {
    const { ctx, page } = await plainPage(browser, { ...vp, theme })
    await shoot(page, `cal-${vp.w}x${vp.h}-${theme}.jpg`)
    await ctx.close()
  }
}

// ---- 2. the frame arms, one shot each ------------------------------------
for (const frame of ['a', 'b', 'c']) {
  const { ctx, page } = await plainPage(browser, { w: 1440, h: 900, theme: 'dark', frame })
  const measured = await page.evaluate(() => {
    const wb = document.querySelector('.wb')
    const app = document.querySelector('.app') || wb
    const plate = document.querySelector('.wb-plate')
    const a = app.getBoundingClientRect(), p = plate.getBoundingClientRect()
    const cs = getComputedStyle(wb)
    return {
      gap: cs.getPropertyValue('--plate-gap').trim(),
      radius: cs.getPropertyValue('--plate-r').trim(),
      ground: cs.getPropertyValue('--ground').trim(),
      lostPx: Math.round((p.left - a.left) + (a.right - p.right)),
      lostPct: Math.round(((p.left - a.left) + (a.right - p.right)) / innerWidth * 1000) / 10,
    }
  })
  console.log(`FRAME ${frame.toUpperCase()}`, JSON.stringify(measured))
  shots.push({ frame, ...measured })
  await shoot(page, `cal-frame-${frame}-1440x900-dark.jpg`, false)
  await ctx.close()
}

// ---- 3. the fixture cases ------------------------------------------------
{
  const { ctx, page } = await fixturePage(browser, { width: 1440, height: 900 })
  const shape = await page.evaluate(() => {
    const days = [...document.querySelectorAll('.cal-day')]
    const s = days.map(d => ({
      n: d.querySelectorAll('.cal-chip').length,
      painted: [...d.querySelectorAll('.cal-chip')].filter(c => getComputedStyle(c).display !== 'none').length,
      more: d.querySelector('.cal-more')?.textContent ?? null,
      h: Math.round(d.getBoundingClientRect().height),
      scrolls: d.scrollHeight > d.clientHeight + 2,
    })).filter(x => x.n > 0)
    return {
      twoPostDays: s.filter(x => x.n === 2).length,
      overflowDays: s.filter(x => x.n > 2).length,
      cellsThatScroll: s.filter(x => x.scrolls).length,
      chipH: Math.round(document.querySelector('.cal-chip').getBoundingClientRect().height),
      cellH: Math.round(document.querySelector('.cal-chip').closest('.cal-day').getBoundingClientRect().height),
      multi: s.filter(x => x.n > 1),
    }
  })
  console.log('FIXTURE SHAPE', JSON.stringify(shape))
  writeFileSync(join(OUT, '..', 'evidence', 'cal-tools', 'fixture-shape.json'), JSON.stringify(shape, null, 1))
  await shoot(page, 'cal-two-post-day-1440x900-dark-fixture.jpg')

  // The overflow cell with its panel open.
  const more = page.locator('.cal-more').first()
  if (await more.count()) {
    await more.click()
    await page.waitForTimeout(400)
    await shoot(page, 'cal-overflow-panel-1440x900-dark-fixture.jpg', false)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }
  await ctx.close()
}

// ---- 4. a chip mid-drag --------------------------------------------------
{
  const { ctx, page } = await plainPage(browser, { w: 1440, h: 900, theme: 'dark' })
  const chip = page.locator('.cal-chip[draggable="true"]').first()
  if (await chip.count()) {
    const b = await chip.boundingBox()
    // HTML5 drag does not fire from mouse moves in Chromium's automation path,
    // so the drag STATE is set the way the component sets it: dispatch the real
    // dragstart the chip listens for, then hold the mouse over a target cell.
    // The drop is never completed, so setScheduleDateAt is never called, and
    // the interceptor above would have counted it if it were.
    await chip.dispatchEvent('dragstart', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) })
    await page.waitForTimeout(200)
    const target = page.locator('.cal-day').nth(20)
    await target.dispatchEvent('dragover', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) })
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.waitForTimeout(300)
    const state = await page.evaluate(() => {
      const d = document.querySelector('.cal-chip-drag')
      const over = document.querySelector('.cal-day-over')
      if (!d) return { dragging: false }
      const cs = getComputedStyle(d)
      return {
        dragging: true, opacity: cs.opacity, boxShadow: cs.boxShadow,
        transform: cs.transform, dropTargetLit: !!over,
      }
    })
    console.log('DRAG STATE', JSON.stringify(state))
    writeFileSync(join(OUT, '..', 'evidence', 'cal-tools', 'drag-state.json'), JSON.stringify(state, null, 1))
    await shoot(page, 'cal-chip-mid-drag-1440x900-dark.jpg', false)
  }
  await ctx.close()
}

await browser.close()

const total = attempted.length + counters.attempted.length
writeFileSync(EV, JSON.stringify({
  shots,
  attemptedWrites: total,
  attemptedWriteDetail: [...attempted, ...counters.attempted],
  unauthorized: [...unauthorized, ...counters.unauthorized],
}, null, 2))
console.log(`\nDONE. attempted writes: ${total}. 401s: ${unauthorized.length + counters.unauthorized.length}.`)
