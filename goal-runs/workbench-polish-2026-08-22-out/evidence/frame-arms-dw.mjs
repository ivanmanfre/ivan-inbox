// Frame arms, draft window pass. Same wiring, same interceptor as
// frame-arms.mjs. Separated because the first pass captured the calendar
// twice: a second page.goto() to the SAME hash is not a navigation in a
// hash-routed app, so the Calendar tab stayed selected and the ".ct-card"
// click had nothing to hit. Here the draft window is opened FIRST, off a
// fresh load that lands on the List tab, and the calendar is taken after.
//
// Usage: node frame-arms-dw.mjs [baseUrl]

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
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

async function newPage(browser, vp, frame) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } })
  await ctx.addInitScript(([s, f]) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
    if (f) localStorage.setItem('inbox-frame', f)
  }, [session, frame || ''])
  const page = await ctx.newPage()
  await installInterceptor(page)
  return { ctx, page }
}

const probe = () => ({
  attr: document.documentElement.getAttribute('data-frame'),
  plateGap: getComputedStyle(document.querySelector('.wb')).getPropertyValue('--plate-gap').trim(),
  plateR: getComputedStyle(document.querySelector('.wb')).getPropertyValue('--plate-r').trim(),
  ground: getComputedStyle(document.querySelector('.wb')).getPropertyValue('--ground').trim(),
  dwOpen: !!document.querySelector('.dw-acts, .dw-insp'),
  // the takeover's own box against the viewport: does the plate still show?
  takeoverBox: (() => {
    const el = document.querySelector('.dw-acts')?.closest('[class]')
    let root = document.querySelector('.dw-acts')
    while (root && root.parentElement && root.parentElement.classList
      && !root.parentElement.classList.contains('app')) root = root.parentElement
    const r = root ? root.getBoundingClientRect() : null
    return r ? { cls: String(root.className).slice(0, 80), x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight } : (el ? null : null)
  })(),
})

async function main() {
  const browser = await chromium.launch()
  const out = { base: BASE, at: new Date().toISOString(), arms: {} }
  const vps = [{ w: 1440, h: 900 }, { w: 2560, h: 1440 }]

  for (const arm of ['a', 'b', 'c']) {
    const key = arm === 'a' ? null : arm
    out.arms[arm] = {}
    for (const vp of vps) {
      const { ctx, page } = await newPage(browser, vp, key)
      await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(1400)
      // draft window first, off the List tab this fresh load lands on
      await page.locator('.ct-card').first().click({ timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(1200)
      const dw = await page.evaluate(probe)
      const dwPath = join(BALLOT, `frame-${arm}-draft-window-${vp.w}x${vp.h}-dark.jpg`)
      await page.screenshot({ path: dwPath, quality: 82, type: 'jpeg', fullPage: false })
      // then the calendar, in the same session
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(500)
      await page.getByText('Calendar', { exact: true }).first().click().catch(() => {})
      await page.waitForTimeout(900)
      const cal = await page.evaluate(probe)
      const calPath = join(BALLOT, `frame-${arm}-calendar-${vp.w}x${vp.h}-dark.jpg`)
      await page.screenshot({ path: calPath, quality: 82, type: 'jpeg', fullPage: true })
      out.arms[arm][`${vp.w}x${vp.h}`] = {
        draftWindow: dw, calendar: cal,
        files: {
          dw: { path: dwPath, exists: existsSync(dwPath), bytes: existsSync(dwPath) ? statSync(dwPath).size : 0 },
          cal: { path: calPath, exists: existsSync(calPath), bytes: existsSync(calPath) ? statSync(calPath).size : 0 },
        },
      }
      await ctx.close()
      console.log(`${arm} ${vp.w}: dwOpen=${dw.dwOpen} attr=${dw.attr} gap=${dw.plateGap} r=${dw.plateR} ground=${dw.ground}`)
    }
  }

  await browser.close()
  out.interceptedWrites = interceptedWrites
  writeFileSync(join(BALLOT, 'frame-arms-dw-proof.json'), JSON.stringify(out, null, 2))
  console.log(`\nDONE. Attempted writes intercepted: ${interceptedWrites}.`)
}

main().catch(e => { console.error(e); process.exit(1) })
