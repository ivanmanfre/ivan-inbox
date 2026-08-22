// Frame arms on the Content list, plus the measured width cost per arm.
//
// The draft window turned out to be a null surface for this decision (its
// scrim is 1440x900 on a 1440x900 viewport, so the plate is entirely behind
// it and all three arms render byte-identical). The Content list is captured
// here instead so the ballot shows the frame on a second surface he actually
// uses, not only the calendar.
//
// Usage: node frame-arms-list.mjs [baseUrl]

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = process.argv[2] || 'http://localhost:4188/'
const BALLOT = join(__dirname, '..', 'ballot')
mkdirSync(BALLOT, { recursive: true })
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')

let interceptedWrites = 0
async function installInterceptor(page) {
  await page.route('**/rest/v1/**', async r => {
    const q = r.request(), m = q.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
      interceptedWrites++
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  })
}

async function main() {
  const browser = await chromium.launch()
  const out = { base: BASE, at: new Date().toISOString(), arms: {} }

  for (const arm of ['a', 'b', 'c']) {
    const key = arm === 'a' ? null : arm
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await ctx.addInitScript(([s, f]) => {
      localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
      if (f) localStorage.setItem('inbox-frame', f)
    }, [session, key || ''])
    const page = await ctx.newPage()
    await installInterceptor(page)
    await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1500)
    const m = await page.evaluate(() => {
      const app = document.querySelector('.wb.app')
      const plate = app ? app.firstElementChild : null
      const cs = getComputedStyle(document.querySelector('.wb'))
      return {
        attr: document.documentElement.getAttribute('data-frame'),
        plateGap: cs.getPropertyValue('--plate-gap').trim(),
        plateR: cs.getPropertyValue('--plate-r').trim(),
        ground: cs.getPropertyValue('--ground').trim(),
        viewportWidth: innerWidth,
        workAreaWidth: plate ? Math.round(plate.getBoundingClientRect().width) : null,
        plateRadius: plate ? getComputedStyle(plate).borderTopLeftRadius : null,
      }
    })
    m.pistachioWidthPx = m.workAreaWidth == null ? null : m.viewportWidth - m.workAreaWidth
    m.pistachioPct = m.pistachioWidthPx == null ? null
      : +(100 * m.pistachioWidthPx / m.viewportWidth).toFixed(2)
    out.arms[arm] = m
    await page.screenshot({
      path: join(BALLOT, `frame-${arm}-content-list-1440x900-dark.jpg`),
      quality: 82, type: 'jpeg', fullPage: false,
    })
    await ctx.close()
    console.log(arm, JSON.stringify(m))
  }

  await browser.close()
  out.interceptedWrites = interceptedWrites
  writeFileSync(join(BALLOT, 'frame-arms-width-cost.json'), JSON.stringify(out, null, 2))
  console.log(`DONE. Attempted writes intercepted: ${interceptedWrites}.`)
}

main().catch(e => { console.error(e); process.exit(1) })
