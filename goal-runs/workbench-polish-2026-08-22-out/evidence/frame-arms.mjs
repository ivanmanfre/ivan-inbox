// Frame arms: computed proof + ballot renders, through the REAL wiring.
//
// Nothing here injects `data-frame` by hand. Each arm is selected the way Ivan
// selects it: localStorage key 'inbox-frame', read once at boot by
// src/main.tsx, exactly as 'inbox-theme' and 'inbox-density' already are. If
// the wiring is broken the readings below come back as arm A three times.
//
// Auth + write interceptor: same setup as evidence/capture.mjs (session from
// .session.json into sb-bjbvqvzbzczjbatgmccb-auth-token; interceptor on
// **/rest/v1/** installed BEFORE every navigation). Attempted writes printed
// at the end and must be 0.
//
// Usage: node frame-arms.mjs [baseUrl]

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

async function newPage(browser, vp, { frame, theme }) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } })
  await ctx.addInitScript(([s, f, t]) => {
    localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s)
    if (f) localStorage.setItem('inbox-frame', f)
    if (t === 'light') localStorage.setItem('inbox-theme', 'light')
  }, [session, frame || '', theme || 'dark'])
  const page = await ctx.newPage()
  await installInterceptor(page)
  return { ctx, page }
}

// Read the three tokens off the element that actually consumes them (.wb.app),
// plus the raw attribute on <html>. --ground is read in every arm because it
// is locked: no arm may move it.
async function readTokens(page) {
  return page.evaluate(() => {
    const wb = document.querySelector('.wb') || document.documentElement
    const cs = getComputedStyle(wb)
    const app = document.querySelector('.wb.app')
    return {
      attr: document.documentElement.getAttribute('data-frame'),
      plateGap: cs.getPropertyValue('--plate-gap').trim(),
      plateR: cs.getPropertyValue('--plate-r').trim(),
      ground: cs.getPropertyValue('--ground').trim(),
      appPadding: app ? getComputedStyle(app).padding : null,
      appBackground: app ? getComputedStyle(app).backgroundColor : null,
      surfaceRadius: (() => {
        const s = document.querySelector('.wb.app > *')
        return s ? getComputedStyle(s).borderRadius : null
      })(),
    }
  })
}

async function openCalendar(page) {
  await page.getByText('Calendar', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(800)
}

async function openDraft(page) {
  await page.locator('.ct-card').first().click().catch(() => {})
  await page.waitForTimeout(1100)
}

async function main() {
  const browser = await chromium.launch()
  const out = { base: BASE, at: new Date().toISOString(), arms: {}, settings: null, stock: null }

  // ---- 1. Computed proof, per arm, on the calendar at 1440 --------------
  for (const [arm, key] of [['a', null], ['b', 'b'], ['c', 'c']]) {
    const { ctx, page } = await newPage(browser, { w: 1440, h: 900 }, { frame: key })
    await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1200)
    await openCalendar(page)
    const tokens = await readTokens(page)
    out.arms[arm] = { ...tokens, viewport: '1440x900' }
    await page.screenshot({
      path: join(BALLOT, `frame-${arm}-calendar-1440x900-dark.jpg`),
      quality: 82, type: 'jpeg', fullPage: true,
    })
    // draft window, same arm, same session
    await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1000)
    await openDraft(page)
    const dwTokens = await readTokens(page)
    out.arms[arm].draftWindow = {
      attr: dwTokens.attr,
      plateGap: dwTokens.plateGap,
      plateR: dwTokens.plateR,
      // does the plate frame reach the takeover at all?
      takeover: await page.evaluate(() => {
        const t = document.querySelector('.dw, .tk, [class*=takeover], .dw-wrap')
        if (!t) return null
        const r = t.getBoundingClientRect()
        return { cls: t.className, x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }
      }),
    }
    await page.screenshot({
      path: join(BALLOT, `frame-${arm}-draft-window-1440x900-dark.jpg`),
      quality: 82, type: 'jpeg', fullPage: false,
    })
    await ctx.close()
    console.log(`arm ${arm}:`, JSON.stringify(out.arms[arm]))
  }

  // ---- 2. The Settings control actually drives it, live ------------------
  {
    const { ctx, page } = await newPage(browser, { w: 1440, h: 900 }, {})
    await page.goto(BASE + '#exp/v2/settings', { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1200)
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-frame'))
    await page.getByText('Tight', { exact: true }).first().click()
    await page.waitForTimeout(300)
    const afterTight = await readTokens(page)
    const lsTight = await page.evaluate(() => localStorage.getItem('inbox-frame'))
    await page.getByText('Flush', { exact: true }).first().click()
    await page.waitForTimeout(300)
    const afterFlush = await readTokens(page)
    await page.getByText('Wide', { exact: true }).first().click()
    await page.waitForTimeout(300)
    const afterWide = await readTokens(page)
    const lsWide = await page.evaluate(() => localStorage.getItem('inbox-frame'))
    await page.screenshot({
      path: join(BALLOT, 'frame-settings-control-1440x900-dark.jpg'),
      quality: 82, type: 'jpeg', fullPage: false,
    })
    out.settings = { before, afterTight, lsTight, afterFlush, afterWide, lsWide }
    await ctx.close()
    console.log('settings:', JSON.stringify(out.settings))
  }

  // ---- 3. #exp/stock is untouched by the attribute -----------------------
  {
    const shots = {}
    for (const [tag, key] of [['nostoreframe', null], ['framec', 'c']]) {
      const { ctx, page } = await newPage(browser, { w: 1440, h: 900 }, { frame: key })
      await page.goto(BASE + '#exp/stock', { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(1600)
      const p = join(BALLOT, `frame-stock-${tag}-1440x900-dark.png`)
      await page.screenshot({ path: p, fullPage: false })
      shots[tag] = {
        path: p,
        attr: await page.evaluate(() => document.documentElement.getAttribute('data-frame')),
        wbCount: await page.evaluate(() => document.querySelectorAll('.wb').length),
        rootBg: await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      }
      await ctx.close()
    }
    out.stock = shots
    console.log('stock:', JSON.stringify(shots))
  }

  await browser.close()
  out.interceptedWrites = interceptedWrites
  writeFileSync(join(BALLOT, 'frame-arms-proof.json'), JSON.stringify(out, null, 2))
  console.log(`\nDONE. Attempted writes intercepted: ${interceptedWrites}.`)
}

main().catch(e => { console.error(e); process.exit(1) })
