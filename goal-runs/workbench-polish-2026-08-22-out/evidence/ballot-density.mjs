// Density arms for the ballot, re-taken off the SAME build as the frame arms
// so that every "after" image on the page comes from one build rather than
// from four agents' builds an hour apart. Also re-measures the two numbers the
// ballot quotes (DM row height, Styles cards visible without scrolling) so the
// page is not quoting someone else's instrument.
//
// Auth + write interceptor identical to evidence/capture.mjs. Attempted writes
// printed at the end and must be 0.
//
// Usage: node ballot-density.mjs [baseUrl]

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

const SURFACES = [
  { id: 'dms', hash: '#exp/v2/dms', rec: '.rows .r' },
  { id: 'content', hash: '#exp/v2/content', rec: '.ct-card' },
  { id: 'styles', hash: '#exp/v2/styles', rec: '.st-card, .sty-card, .rows > *' },
  { id: 'settings', hash: '#exp/v2/settings', rec: '.grow' },
]

async function main() {
  const browser = await chromium.launch()
  const out = { base: BASE, at: new Date().toISOString(), rows: {} }

  for (const mode of ['comfortable', 'compact']) {
    for (const s of SURFACES) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      await ctx.addInitScript(([sess, m]) => {
        localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', sess)
        if (m === 'compact') localStorage.setItem('inbox-density', 'compact')
      }, [session, mode])
      const page = await ctx.newPage()
      await installInterceptor(page)
      await page.goto(BASE + s.hash, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(1600)
      const m = await page.evaluate(sel => {
        const els = [...document.querySelectorAll(sel)]
        const first = els[0]
        const cs = first ? getComputedStyle(first) : null
        const vh = innerHeight
        let visible = 0
        for (const el of els) {
          const r = el.getBoundingClientRect()
          if (r.top >= 0 && r.bottom <= vh) visible++
        }
        // the dominant body type on the row, to show the SIZE did not move
        const txt = first ? first.querySelector('*') : null
        return {
          density: document.documentElement.getAttribute('data-density'),
          rowHeight: first ? +first.getBoundingClientRect().height.toFixed(1) : null,
          rowPaddingTop: cs ? cs.paddingTop : null,
          rowLineHeight: cs ? cs.lineHeight : null,
          rowFontSize: cs ? cs.fontSize : null,
          innerFontSize: txt ? getComputedStyle(txt).fontSize : null,
          innerLineHeight: txt ? getComputedStyle(txt).lineHeight : null,
          total: els.length,
          visibleNoScroll: visible,
        }
      }, s.rec)
      out.rows[`${s.id}__${mode}`] = m
      await page.screenshot({
        path: join(BALLOT, `bal-density-${mode}-${s.id}-1440x900-dark.jpg`),
        quality: 82, type: 'jpeg', fullPage: false,
      })
      await ctx.close()
      console.log(`${s.id} ${mode}`, JSON.stringify(m))
    }
  }

  await browser.close()
  out.interceptedWrites = interceptedWrites
  writeFileSync(join(BALLOT, 'ballot-density-proof.json'), JSON.stringify(out, null, 2))
  console.log(`DONE. Attempted writes intercepted: ${interceptedWrites}.`)
}

main().catch(e => { console.error(e); process.exit(1) })
