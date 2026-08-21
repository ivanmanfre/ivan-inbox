// Does a small visible control carry a real 44px hit area?
//
// measure.mjs reports getBoundingClientRect, which is the VISIBLE box and does
// not include an `::after` inset overlay. This app grows touch targets with that
// overlay on purpose (a row of 44px dismiss buttons would read as a toolbar), so
// the honest test is hit-testing, not measuring: take a point outside the
// visible box and ask the document what is there. A pseudo-element hit-tests as
// its originating element, so the answer names the control or it does not.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const blocked = []

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 812 } })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
await page.route('**/rest/v1/**', async r => {
  const q = r.request(), m = q.method()
  if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
    blocked.push(m); return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  }
  return r.continue()
})
await page.goto('http://localhost:4173/#exp/v2/today', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

const out = await page.evaluate(() => {
  const probe = (sel, name) => {
    const els = [...document.querySelectorAll(sel)]
    return els.slice(0, 6).map(el => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      // Walk outward from the centre until the document stops answering with
      // this element. Twice the result is the effective target size.
      let reach = 0
      for (let d = 1; d <= 40; d++) {
        const hits = [[cx + d, cy], [cx - d, cy], [cx, cy + d], [cx, cy - d]]
          .every(([x, y]) => { const e = document.elementFromPoint(x, y); return e === el || el.contains(e) })
        if (!hits) break
        reach = d
      }
      return {
        name, visible: `${Math.round(r.width)}x${Math.round(r.height)}`,
        effective: `${reach * 2}x${reach * 2}`, meets44: reach * 2 >= 44,
      }
    })
  }
  return {
    dismiss: probe('.sa-x', 'alert dismiss'),
    selmark: probe('.wb-selmark', 'selection mark'),
  }
})
console.log(JSON.stringify(out, null, 1))
console.log('blocked writes:', blocked.length)
await browser.close()
