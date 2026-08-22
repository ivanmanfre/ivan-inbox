// The run fixed `border:2px outset` on .cal-chip-t and called it a one-off. The
// blind judge found it again on the rail row. Find EVERY element in the
// workbench still computing the browser-default button bevel.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = 'http://127.0.0.1:4191/'
const SURFACES = [['today','#exp/v2/today'],['dms','#exp/v2/dms'],['content','#exp/v2/content'],
  ['magnets','#exp/v2/magnets'],['styles','#exp/v2/styles'],['strategy','#exp/v2/strategy'],
  ['sends','#exp/v2/sends'],['ops','#exp/v2/ops'],['settings','#exp/v2/settings']]
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
let writes = 0
await page.route('**/rest/v1/**', async r => {
  const q = r.request(), m = q.method()
  if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) { writes++; return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) }
  return r.continue()
})
const found = new Map()
const scan = async label => {
  for (const hit of await page.evaluate(() => {
    const out = []
    for (const e of document.querySelectorAll('*')) {
      const c = getComputedStyle(e)
      const styles = [c.borderTopStyle, c.borderRightStyle, c.borderBottomStyle, c.borderLeftStyle]
      if (styles.some(s => s === 'outset' || s === 'inset' || s === 'ridge' || s === 'groove')) {
        const r = e.getBoundingClientRect()
        out.push({ tag: e.tagName.toLowerCase(), cls: (e.className || '').toString().slice(0, 60),
          style: styles.join('/'), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 })
      }
    }
    return out
  })) {
    const k = `${hit.tag}.${hit.cls}`
    if (!found.has(k)) found.set(k, { ...hit, surfaces: new Set() })
    found.get(k).surfaces.add(label)
  }
}
for (const [name, hash] of SURFACES) {
  await page.goto(`${BASE}?bs=${Date.now()}${hash}`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(2200)
  await scan(name)
  if (name === 'content') { // also the calendar tab
    await page.getByText('Calendar', { exact: true }).first().click().catch(() => {})
    await page.waitForTimeout(2200); await scan('content/calendar')
  }
}
console.log('\n=== ELEMENTS COMPUTING A 3D BORDER STYLE ===')
for (const [k, v] of found) {
  console.log(`${v.visible ? 'VISIBLE' : 'hidden '}  ${k}\n          ${v.style}  ${v.w}x${v.h}  on: ${[...v.surfaces].join(', ')}`)
}
console.log(`\ndistinct: ${found.size} | visible: ${[...found.values()].filter(v => v.visible).length} | writes: ${writes}`)
await b.close()
