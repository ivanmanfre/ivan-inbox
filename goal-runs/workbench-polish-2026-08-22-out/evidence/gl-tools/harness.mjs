// Shared Playwright harness for the glance-layer build.
// Read-only by construction: the interceptor aborts EVERY mutating REST call
// and counts it, and the count is asserted 0 by every caller.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import fs from 'node:fs'

export const BASE = 'http://127.0.0.1:4187'
const SESSION = '/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json'
const AUTH_KEY = 'sb-bjbvqvzbzczjbatgmccb-auth-token'

export async function open({ width = 1440, height = 900, theme = 'dark' } = {}) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  const writes = []
  // chip-probe.mjs:13-19 — the interceptor, before any navigation.
  await ctx.route('**/rest/v1/**', r => {
    const m = r.request().method()
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
      writes.push(`${m} ${r.request().url()}`)
      return r.abort()
    }
    return r.continue()
  })
  await ctx.route('**/rest/v1/rpc/**', r => {
    writes.push(`RPC ${r.request().method()} ${r.request().url()}`)
    return r.abort()
  })
  const sess = JSON.parse(fs.readFileSync(SESSION, 'utf8'))
  await ctx.addInitScript(([k, v, t]) => {
    localStorage.setItem(k, JSON.stringify(v))
    if (t === 'light') localStorage.setItem('inbox-theme', 'light')
    else localStorage.removeItem('inbox-theme')
  }, [AUTH_KEY, sess, theme])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('response', r => { if (r.status() === 401) errors.push('401 ' + r.url()) })
  return { browser, ctx, page, writes, errors }
}

export async function settle(page, ms = 3500) {
  await page.waitForTimeout(ms)
}
