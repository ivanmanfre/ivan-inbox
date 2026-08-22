// THE TWO-POST DAY, AND THE OVERFLOW CELL, ON A MONTH THAT HAS NEITHER.
//
// Live data on this lane has 13 dated posts spread across 13 separate days:
// `daysWithTwoPlus: 0` in every before-probe. The cap and the "+N" are
// therefore ungrabbable from real rows, so the case is CONSTRUCTED, and this
// file is the construction. Said plainly rather than buried: these screenshots
// are a local fixture, not Ivan's calendar.
//
// HOW. The GET on `carousel_drafts` is intercepted, the real response body is
// fetched, and `scheduled_at` on a handful of rows is rewritten so two of them
// land on one day and four on another. Nothing is written anywhere: this is a
// READ rewritten in flight, in one browser, for one screenshot.
//
// The write interceptor is installed BEFORE any navigation, as always, and it
// covers POST /rest/v1/rpc/ as well, which the standard pattern lets through.
// Attempted writes are counted and printed.
//
// Usage: node cal-fixture.mjs <baseUrl> <outDir>

import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = process.argv[2] || 'http://localhost:4186/'
const OUT = process.argv[3] || '/tmp/cal-fixture'
mkdirSync(OUT, { recursive: true })

const WRITE_RPC = ['operator_', 'dashboard_action', 'n8nclaw_', 'append_agent_log']
let attempted = []
let unauthorized = []

// The month on screen is the current one, so the fixture days are derived from
// today rather than hardcoded: this script does not rot in September.
const now = new Date()
const Y = now.getFullYear(), M = now.getMonth()
const iso = (d, h, mi) => new Date(Y, M, d, h, mi).toISOString()
// A day with EXACTLY TWO, and a day with FOUR so the cap and the "+2" both draw.
const TWO_DAY = 6
const MANY_DAY = 19
const PLAN = [
  { d: TWO_DAY, h: 9, m: 0 }, { d: TWO_DAY, h: 17, m: 30 },
  { d: MANY_DAY, h: 8, m: 0 }, { d: MANY_DAY, h: 11, m: 15 },
  { d: MANY_DAY, h: 14, m: 0 }, { d: MANY_DAY, h: 18, m: 45 },
]

export async function fixturePage(browser, { width, height, theme = 'dark', frame = '' }) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  if (theme === 'light') await ctx.addInitScript(() => localStorage.setItem('inbox-theme', 'light'))
  const page = await ctx.newPage()

  // INSTALLED BEFORE ANY NAVIGATION.
  await page.route('**/rest/v1/**', async r => {
    const q = r.request(), m = q.method(), url = q.url()
    if (url.includes('/rpc/') && m === 'POST') {
      const name = url.split('/rpc/')[1].split('?')[0]
      if (WRITE_RPC.some(p => name.startsWith(p))) {
        attempted.push({ kind: 'rpc', name, payload: q.postData() })
        return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      }
      return r.continue()
    }
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || m === 'POST') {
      attempted.push({ kind: m, url: url.slice(0, 160) })
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    // THE FIXTURE. A GET on the drafts table, rewritten in flight.
    if (m === 'GET' && url.includes('/carousel_drafts') && !url.includes('head=true')) {
      const res = await r.fetch()
      let body
      try { body = await res.json() } catch { return r.fulfill({ response: res }) }
      if (Array.isArray(body)) {
        // Only rows the calendar was ALREADY DRAWING are moved. Picking any
        // dated row would have picked one from another month, or one the lane
        // filters drop before it reaches the grid, and the fixture would have
        // looked like it silently failed. These are this month's own posts,
        // relocated onto two days.
        //
        // 🔴 PARSED, NOT PREFIX-MATCHED. The first cut of this filter tested
        // `scheduled_at.startsWith('2026-08')` and found 5 rows on a month the
        // grid was drawing 13 of. `scheduled_at` comes back as UTC, so a post
        // at 00:30 local on the 1st is stored as the previous month, and a
        // string compare drops it. The grid buckets by LOCAL day (dayKeyOf),
        // so the fixture has to as well or it disagrees with the thing it is
        // supposed to be measuring.
        const here = body.filter(x => {
          const t = x && x.scheduled_at ? Date.parse(x.scheduled_at) : NaN
          if (!Number.isFinite(t)) return false
          const d = new Date(t)
          return d.getFullYear() === Y && d.getMonth() === M
        })
        PLAN.forEach((p, i) => { if (here[i]) here[i].scheduled_at = iso(p.d, p.h, p.m) })
      }
      return r.fulfill({
        status: res.status(),
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    }
    return r.continue()
  })

  page.on('response', x => { if (x.status() === 401) unauthorized.push(x.url()) })

  await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.getByText('Calendar', { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(1500)
  if (frame) await page.evaluate(f => document.documentElement.setAttribute('data-frame', f), frame)
  await page.waitForTimeout(250)
  return { ctx, page }
}

export const FIXTURE = { TWO_DAY, MANY_DAY }
export const counters = {
  get attempted() { return attempted },
  get unauthorized() { return unauthorized },
}

// Standalone: prove the fixture produced the two shapes, and say so in numbers.
if (import.meta.url === `file://${process.argv[1]}`) {
  const browser = await chromium.launch()
  const { page } = await fixturePage(browser, { width: 1440, height: 900 })
  const out = await page.evaluate(() => {
    const days = [...document.querySelectorAll('.cal-day')]
    const shape = days.map(d => ({
      n: d.querySelectorAll('.cal-chip').length,
      painted: [...d.querySelectorAll('.cal-chip')].filter(c => getComputedStyle(c).display !== 'none').length,
      more: d.querySelector('.cal-more')?.textContent ?? null,
      moreShown: d.querySelector('.cal-more') ? getComputedStyle(d.querySelector('.cal-more')).display !== 'none' : false,
      h: Math.round(d.getBoundingClientRect().height),
      scrolls: d.scrollHeight > d.clientHeight + 2,
    })).filter(x => x.n > 0)
    return {
      shape,
      twoPostDays: shape.filter(x => x.n === 2).length,
      overflowDays: shape.filter(x => x.n > 2).length,
      cellsThatScroll: shape.filter(x => x.scrolls).length,
      chipH: Math.round(document.querySelector('.cal-chip').getBoundingClientRect().height),
    }
  })
  out.attemptedWrites = attempted.length
  out.unauthorized = unauthorized
  writeFileSync(join(OUT, 'fixture-shape.json'), JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, null, 1))
  await browser.close()
}
