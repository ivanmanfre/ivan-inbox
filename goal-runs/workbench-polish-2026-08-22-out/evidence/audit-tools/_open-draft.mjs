// Helper shared by the live probes: open the workbench, open a draft window,
// open a DM thread. Write interceptor is installed before any navigation
// (verbatim from workbench-2026-plan-2026-08-21/tools/chip-probe.mjs:13-19).
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
export const BASE = process.env.WB_BASE || 'http://localhost:4173/'

export async function boot(viewport = { width: 1440, height: 900 }) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
  const page = await ctx.newPage()
  await page.route('**/rest/v1/**', async r => {
    const q = r.request(), m = q.method()
    if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return r.continue()
  })
  return { browser, page }
}

export async function goto(page, hash, wait = 2200) {
  await page.goto(BASE + hash, { waitUntil: 'networkidle' })
  await page.waitForTimeout(wait)
}

// The Content surface remembers List/Calendar in storage; force List, then open
// the first draft. Returns true when `.dw` actually mounted.
export async function openDraft(page) {
  await goto(page, '#exp/v2/content')
  try { await page.getByText('List', { exact: true }).first().click({ timeout: 4000 }); await page.waitForTimeout(1500) } catch {}
  const cands = ['.ct-rows .r', '.ct-rows [role=button]', '.ct-rows button.r', '.ct-row', '.ct-title']
  for (const c of cands) {
    const n = await page.locator(c).count()
    if (!n) continue
    try {
      await page.locator(c).nth(Math.min(1, n - 1)).click({ timeout: 4000 })
      await page.waitForTimeout(2600)
      if (await page.locator('.dw').count()) return true
    } catch {}
  }
  return !!(await page.locator('.dw').count())
}

export async function openThread(page) {
  await goto(page, '#exp/v2/dms', 3500)
  for (const c of ['.rows .r', '.rows [role=button]', '.rows button']) {
    const n = await page.locator(c).count()
    if (!n) continue
    try {
      await page.locator(c).nth(Math.min(1, n - 1)).click({ timeout: 4000 })
      await page.waitForTimeout(3000)
      // peers-1 is the shell's own signal that a context peer mounted; the
      // bubble class is NOT a reliable predicate (a thread with no fetched
      // history renders zero bubbles and is still an open thread).
      if (await page.locator('.wb-regions.peers-1, .wb-peer-thread').count()) return true
    } catch {}
  }
  return !!(await page.locator('.wb-peer-thread').count())
}
