// dwa capture - surface 03 only, framed to match before/03-draft-window-*.
// Same instrument as evidence/capture.mjs (same viewports, same act, same
// crops, same jpeg quality), pointed at this branch's build.
//
// SAFETY: the write interceptor is installed on **/rest/v1/** AND
// **/rest/v1/rpc/** BEFORE any navigation. Opening a draft stamps live rows.
// The attempted-write count is printed at the end and must be 0.
//
// Usage: node dwa-capture.mjs [baseUrl] [prefix] [outDir]

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = process.argv[2] || 'http://localhost:4173/'
const PREFIX = process.argv[3] || 'dw-final'
const OUT_DIR = process.argv[4] || join(__dirname, '..', 'after')
mkdirSync(OUT_DIR, { recursive: true })

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')

let attemptedWrites = 0
async function installInterceptor(page) {
  const handler = async r => {
    const q = r.request(), m = q.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || m === 'POST') {
      attemptedWrites++
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  }
  await page.route('**/rest/v1/**', handler)
  await page.route('**/rest/v1/rpc/**', handler)
}

const VIEWPORTS = [{ w: 1440, h: 900 }, { w: 2560, h: 1440 }, { w: 390, h: 844 }]
const THEMES = ['dark', 'light']
const CROPS = [{ name: 'actions', selector: '.dw-acts' }, { name: 'inspector', selector: '.dw-insp' }]

const browser = await chromium.launch()
let errors = 0
for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } })
    await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
    if (theme === 'light') await ctx.addInitScript(() => { localStorage.setItem('inbox-theme', 'light') })
    const page = await ctx.newPage()
    await installInterceptor(page)
    const consoleErrors = []
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', e => consoleErrors.push(String(e)))
    try {
      await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(1200)
      await page.locator('.ct-card').first().click().catch(() => {})
      await page.waitForTimeout(1200)
      const tag = `${vp.w}x${vp.h}-${theme}`
      await page.screenshot({ path: join(OUT_DIR, `${PREFIX}-${tag}.jpg`), quality: 82, type: 'jpeg' })
      if (theme === 'dark' && (vp.w === 1440 || vp.w === 390)) {
        for (const c of CROPS) {
          const loc = page.locator(c.selector).first()
          if (!await loc.count()) continue
          // At 390 the window is one scroller and the inspector sits below the
          // fold, so its box is outside a viewport screenshot and the clip
          // fails. Scroll to it first, then clamp the clip to what is on screen.
          await loc.scrollIntoViewIfNeeded().catch(() => {})
          await page.waitForTimeout(300)
          const box = await loc.boundingBox().catch(() => null)
          if (!box) continue
          const top = Math.max(0, box.y)
          const clip = {
            x: Math.max(0, box.x),
            y: top,
            width: Math.min(box.width, vp.w - Math.max(0, box.x)),
            height: Math.min(box.height, vp.h - top),
          }
          if (clip.width < 2 || clip.height < 2) continue
          await page.screenshot({ path: join(OUT_DIR, `${PREFIX}-${c.name}-${tag}.jpg`), quality: 82, type: 'jpeg', clip })
        }
      }
      errors += consoleErrors.length
      console.log(`OK  ${PREFIX}-${tag}  console_errors=${consoleErrors.length}`)
    } catch (e) {
      console.error(`FAIL ${vp.w}x${vp.h} ${theme}: ${e.message}`)
    } finally {
      await ctx.close()
    }
  }
}
await browser.close()
console.log('attemptedWrites =', attemptedWrites)
console.log('consoleErrors   =', errors)
