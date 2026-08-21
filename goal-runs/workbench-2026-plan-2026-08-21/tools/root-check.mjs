// What does the LIVE app render at the bare URL, with no hash and no service
// worker? If this is the new build, then anything Ivan is still seeing old is
// his cache, not the deploy.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, mkdirSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
mkdirSync('/tmp/rootcheck', { recursive: true })
const blocked = []

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
await page.route('**/rest/v1/**', async r => {
  const q = r.request(), m = q.method()
  if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
    blocked.push(m); return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  }
  return r.continue()
})
await page.goto('https://ivanmanfre.github.io/ivan-inbox/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const out = await page.evaluate(() => {
  const body = document.querySelector('.wb')
  const probe = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const cs = getComputedStyle(el)
    return `${Math.round(parseFloat(cs.fontSize) * 10) / 10}px / ${cs.lineHeight}`
  }
  return {
    hash: location.hash || '(none)',
    build: document.body.innerText.match(/\b[0-9a-f]{7}\b/)?.[0] ?? null,
    isWorkbench: !!body,
    shell: body ? 'workbench (.wb)' : 'stock / legacy',
    bodyType: probe('.wb-body, .snip, .r p') || probe('p'),
    fsBody: body ? getComputedStyle(body).getPropertyValue('--fs-body').trim() : null,
    head: document.body.innerText.trim().slice(0, 120).replace(/\n+/g, ' | '),
  }
})
console.log(JSON.stringify(out, null, 1))
await page.screenshot({ path: '/tmp/rootcheck/live-root.jpg', quality: 80, type: 'jpeg' })
console.log('blocked writes:', blocked.length)
await browser.close()
