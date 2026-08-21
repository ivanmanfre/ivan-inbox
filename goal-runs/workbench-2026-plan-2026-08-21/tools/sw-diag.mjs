// Why did the open tab not pick up the new build? Evidence, not theories.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const PROFILE = '/tmp/sw-diag-profile'
execSync(`rm -rf ${PROFILE}`)

const ctx = await chromium.launchPersistentContext(PROFILE, { viewport: { width: 1200, height: 800 }, serviceWorkers: 'allow' })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
page.on('console', m => console.log('  [page]', m.text().slice(0, 140)))

// Log every request for the worker script, which is what update() actually does.
page.on('request', r => { if (r.url().includes('sw.js')) console.log('  [req]', r.method(), r.url().split('/').pop()) })
page.on('response', r => { if (r.url().includes('sw.js')) console.log('  [res]', r.status(), r.url().split('/').pop()) })

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

console.log('\n--- state ---')
console.log(await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration()
  return {
    controlled: Boolean(navigator.serviceWorker.controller),
    scope: reg?.scope,
    updateViaCache: reg?.updateViaCache,
    hasInstalling: Boolean(reg?.installing),
    hasWaiting: Boolean(reg?.waiting),
    activeState: reg?.active?.state,
    // Is the update-check code even in this bundle?
    fixPresent: [...document.querySelectorAll('script[src]')].map(s => s.src).join(','),
  }
}))

const scriptSrc = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map(s => s.src).find(s => s.includes('index-')))
const js = await (await fetch(scriptSrc)).text()
console.log('update-check code present in served bundle:', /serviceWorker\.ready/.test(js), '| interval:', /6e4|60000/.test(js))

console.log('\n--- deploying a different build ---')
const MARK = '/Users/ivanmanfredi/Desktop/ivan-inbox/src/exp/v2c/wb2026.css'
const original = readFileSync(MARK, 'utf8')
execSync(`printf '\\n/* diag marker */\\n' >> ${MARK}`)
try { execSync('cd /Users/ivanmanfredi/Desktop/ivan-inbox && npx vite build', { stdio: 'pipe' }) }
finally { execSync(`cat > ${MARK} <<'DIAGEOF'\n${original}\nDIAGEOF`) }
console.log('built. now forcing ONE manual update() to see what the browser does:')

const res = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return { err: 'no registration' }
  try {
    await reg.update()
    return { ok: true, installing: Boolean(reg.installing), waiting: Boolean(reg.waiting), active: reg.active?.state }
  } catch (e) { return { err: String(e).slice(0, 200) } }
})
console.log('  manual update() ->', JSON.stringify(res))
await page.waitForTimeout(6000)
console.log('  after 6s ->', await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration()
  return { installing: Boolean(reg?.installing), waiting: Boolean(reg?.waiting), active: reg?.active?.state, asset: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).find(s => s.includes('index-')) }
}))
await ctx.close()
