// What is actually painted on a calendar chip, and how much room does the
// pistachio frame take? Ivan: "the calendar pills look like ugly 3d" and "there
// is a green background that is taking some space from us".
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = process.argv[2] || 'http://localhost:4173/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
await page.route('**/rest/v1/**', async r => {
  const q = r.request(), m = q.method()
  if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  }
  return r.continue()
})
await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
// Calendar view
await page.getByText('Calendar', { exact: true }).first().click().catch(() => {})
await page.waitForTimeout(1800)

const out = await page.evaluate(() => {
  const px = n => Math.round(n)
  const chip = document.querySelector('.cal-chip')
  const cell = document.querySelector('.cal-day, [class*=cal-day]')
  const app = document.querySelector('.app') || document.querySelector('.wb')
  const plate = document.querySelector('.wb-shell') || document.querySelector('.wb > div')
  const cs = chip ? getComputedStyle(chip) : null
  const r = chip?.getBoundingClientRect()
  const cr = cell?.getBoundingClientRect()

  // How much of the window is the green frame?
  const ar = app?.getBoundingClientRect()
  const pr = plate?.getBoundingClientRect()
  const frameLoss = ar && pr
    ? { left: px(pr.left - ar.left), right: px(ar.right - pr.right), top: px(pr.top - ar.top), bottom: px(ar.bottom - pr.bottom) }
    : null

  return {
    chip: cs ? {
      size: `${px(r.width)}x${px(r.height)}`,
      background: cs.backgroundColor,
      borderLeft: cs.borderLeftWidth + ' ' + cs.borderLeftColor,
      borderTop: cs.borderTopWidth + ' ' + cs.borderTopColor,
      borderRight: cs.borderRightWidth,
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow,
      // elevation cue count: fill different from parent + any border + any shadow
      parentBg: getComputedStyle(chip.parentElement).backgroundColor,
    } : 'no chip found',
    cell: cr ? `${px(cr.width)}x${px(cr.height)}` : null,
    chipShareOfCell: (r && cr) ? Math.round((r.height / cr.height) * 100) + '% of cell height' : null,
    plateGap: getComputedStyle(document.querySelector('.wb')).getPropertyValue('--plate-gap').trim(),
    plateRadius: getComputedStyle(document.querySelector('.wb')).getPropertyValue('--plate-r').trim(),
    frameLoss,
    windowW: innerWidth,
    frameCostPct: frameLoss ? Math.round(((frameLoss.left + frameLoss.right) / innerWidth) * 1000) / 10 + '% of width' : null,
    // Ivan's "taking some space": count how many chips fit before a cell overflows
    cellsWithOverflow: [...document.querySelectorAll('.cal-day, [class*=cal-day]')]
      .filter(c => c.scrollHeight > c.clientHeight + 2).length,
  }
})
console.log(JSON.stringify(out, null, 1))
await page.screenshot({ path: '/tmp/chip-probe.jpg', quality: 82, type: 'jpeg' })
await browser.close()
