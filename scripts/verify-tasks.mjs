// verify-tasks.mjs — playwright proof for the Ops TASK LIST (UX v2, 2026-08-30).
//
// Expects: .session.json minted (dev-login.mjs), a preview server, and three
// pre-inserted kind='task' rows whose ids are argv[3] (tick target, must carry a
// long detail line), argv[4] (remove target) and argv[5] (a row that must still
// be there at the end, proving nothing else moved).
//
// Proves the three things Ivan's feedback is about:
//   1. the rows render as a LIST (tick + title + detail + chips), not as cards;
//   2. TICK completes INSTANTLY — no confirm sheet — and the row leaves pending;
//   3. REMOVE still asks first, and only then does the row vanish;
//   4. a long detail line is clamped and expands on tap.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const TARGET = process.argv[2] ?? 'http://localhost:4319/'
const TICK_ID = process.argv[3]
const REMOVE_ID = process.argv[4]
const KEEP_ID = process.argv[5]
const OUT = process.env.OPS_SHOT_DIR ?? '/tmp'
const session = readFileSync(new URL('../.session.json', import.meta.url), 'utf8')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))
await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])

await page.goto(`${TARGET}#exp/v2/ops`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2200)

const row = id => page.locator(`.task-r[data-ops-id="${id}"]`)
const out = { anatomy: {}, expand: {}, tick: {}, remove: {}, consoleErrors: errors }

// --- 1. anatomy: a LIST row, not a card -------------------------------------
await row(TICK_ID).waitFor({ timeout: 10000 })
out.anatomy = await page.evaluate(id => {
  const r = document.querySelector(`.task-r[data-ops-id="${id}"]`)
  const tick = r.querySelector('.task-tick')
  const tb = tick.getBoundingClientRect()
  return {
    isTaskRow: r.classList.contains('task-r'),
    // The whole point: this row must NOT be an ops-card and must carry no editor.
    insideOpsCard: Boolean(r.closest('.ops-card')),
    textareas: r.querySelectorAll('textarea').length,
    buttons: r.querySelectorAll('.btn').length,
    tickTarget: `${Math.round(tb.width)}x${Math.round(tb.height)}`,
    tickIsRound: getComputedStyle(tick, '::before').borderRadius,
    title: r.querySelector('.task-t')?.textContent ?? null,
    chips: [...r.querySelectorAll('.task-chip')].map(c => c.textContent),
    rowHeight: Math.round(r.getBoundingClientRect().height),
  }
}, TICK_ID)
await page.screenshot({ path: `${OUT}/tasks-1-list.png` })

// --- 2. long detail is clamped, and opens on tap ----------------------------
const detail = row(TICK_ID).locator('.task-d')
const clamped = await detail.evaluate(el => ({ h: Math.round(el.getBoundingClientRect().height), full: el.scrollHeight }))
await detail.click()
await page.waitForTimeout(260)
const opened = await detail.evaluate(el => ({ h: Math.round(el.getBoundingClientRect().height), open: el.classList.contains('open') }))
out.expand = { clampedHeight: clamped.h, fullHeight: clamped.full, openedHeight: opened.h, gotOpenClass: opened.open, grew: opened.h > clamped.h }
await page.screenshot({ path: `${OUT}/tasks-2-expanded.png` })
await detail.click()
await page.waitForTimeout(200)

// --- 3. TICK — instant, no sheet --------------------------------------------
await row(TICK_ID).locator('.task-tick').click()
await page.waitForTimeout(160)
out.tick = { confirmSheetShown: await page.locator('.sheet-btn').count() > 0 }
await page.waitForTimeout(1800)
out.tick.rowLeftPending = await row(TICK_ID).count() === 0
// The receipt: it is in Done today.
await page.locator('.task-donehdr').first().click().catch(() => {})
await page.waitForTimeout(300)
out.tick.inDoneToday = await page.locator(`.task-r.static[data-ops-id="${TICK_ID}"]`).count() > 0
await page.screenshot({ path: `${OUT}/tasks-3-done.png` })

// --- 4. REMOVE — confirm first ----------------------------------------------
await row(REMOVE_ID).locator('.task-x').click()
await page.waitForTimeout(400)
out.remove = { confirmSheetShown: await page.locator('.sheet-btn.danger').count() > 0 }
await page.locator('.sheet-btn.danger').last().click()
await page.waitForTimeout(1800)
out.remove.rowGone = await row(REMOVE_ID).count() === 0

out.untouchedRowStillThere = await row(KEEP_ID).count() === 1
out.consoleErrors = errors
console.log(JSON.stringify(out, null, 1))
await browser.close()
