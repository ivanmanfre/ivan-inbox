// #exp/stock must be pixel-identical. Two checks, both against the SHIPPED
// build: none of p4b's classes exist anywhere in the stock DOM, and none of
// wb2026.css's rules can match there (the sheet is scoped .wb and stock never
// sets it).
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const browser = await chromium.launch()
const out = {}
for (const [name, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  await ctx.route('**/rest/v1/**', async r => {
    const m = r.request().method()
    if (m !== 'GET' && m !== 'HEAD') return r.fulfill({ status: 403, body: '{}' })
    return r.continue()
  })
  const page = await ctx.newPage()
  await page.goto('http://localhost:4182/#exp/stock', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  out[name] = await page.evaluate(() => ({
    p4bClasses: ['ct-reason-row', 'ct-retry', 'ct-promote', 'wb-bulk-client', 'wb-bulk-b']
      .map(c => [c, document.querySelectorAll('.' + c).length]),
    anyWbScope: document.querySelectorAll('.wb').length,
    dataKind: document.querySelectorAll('[data-kind]').length,
    root: document.body.firstElementChild?.className ?? null,
  }))
  await page.screenshot({ path: `/Users/ivanmanfredi/Desktop/ivan-inbox-pw-b/goal-runs/workbench-polish-2026-08-22-out/after/p4b-stock-${name}.jpg`, type: 'jpeg', quality: 82 })
  await ctx.close()
}
await browser.close()
console.log(JSON.stringify(out, null, 1))
