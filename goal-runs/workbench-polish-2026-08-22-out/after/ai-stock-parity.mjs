// #exp/stock must be untouched. This run added two OPTIONAL props to the
// shared InboxScreen (rowNote, rowChip); the pre-revamp shell passes neither,
// so the assertion is that neither slot renders there and the row geometry is
// unchanged.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const OUT = '/Users/ivanmanfredi/Desktop/ivan-inbox-pw-ai/goal-runs/workbench-polish-2026-08-22-out/after/'
const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({ deviceScaleFactor: 2 })
await ctx.addInitScript(s => { try { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) } catch { /* ok */ } }, session)
const page = await ctx.newPage()
await page.route('**/rest/v1/**', r => {
  const m = r.request().method()
  if (m === 'GET') return r.continue()
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
})
await page.route('**/functions/v1/**', r => r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }))
await page.setViewportSize({ width: 1440, height: 900 })
await page.goto('http://localhost:4188/#exp/stock', { waitUntil: 'networkidle' })
await page.waitForSelector('.r', { timeout: 45000 }).catch(() => {})
await page.waitForTimeout(2500)
const out = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.r')]
  const snips = [...document.querySelectorAll('.snip')]
  return {
    rows: rows.length,
    heights: [...new Set(rows.map(r => Math.round(r.getBoundingClientRect().height)))],
    preChips: document.querySelectorAll('.wb-pre').length,
    notes: document.querySelectorAll('.snip-note').length,
    seeStrips: document.querySelectorAll('.wb-see').length,
    laneAttr: document.querySelectorAll('[data-wblane]').length,
    snipFonts: [...new Set(snips.map(s => getComputedStyle(s).fontSize))],
    snipStyles: [...new Set(snips.map(s => getComputedStyle(s).fontStyle))],
  }
})
writeFileSync(OUT + 'ai-stock-parity.json', JSON.stringify(out, null, 1))
console.log(JSON.stringify(out, null, 1))
await page.screenshot({ path: OUT + 'ai-stock-1440.jpg', quality: 82, type: 'jpeg' })
await b.close()
