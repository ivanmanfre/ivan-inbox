// Does update() actually fetch sw.js, and what comes back?
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
execSync('rm -rf /tmp/sw-req-profile')
const ctx = await chromium.launchPersistentContext('/tmp/sw-req-profile', { viewport: { width: 1000, height: 700 }, serviceWorkers: 'allow' })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
console.log('controlled:', await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))

// change the build for real
const MARK = '/Users/ivanmanfredi/Desktop/ivan-inbox/src/exp/v2c/wb2026.css'
const original = readFileSync(MARK, 'utf8')
execSync(`printf '\\n.wb-swreq-marker{outline:1px solid red}\\n' >> ${MARK}`)
try { execSync('cd /Users/ivanmanfredi/Desktop/ivan-inbox && npx vite build', { stdio: 'pipe' }) }
finally { execSync(`cat > ${MARK} <<'REQEOF'\n${original}\nREQEOF`) }
console.log('sw.js on disk now:', execSync('shasum -a 256 /Users/ivanmanfredi/Desktop/ivan-inbox/dist/sw.js').toString().slice(0, 12))

// Watch at the CONTEXT level: a service-worker script fetch does not belong to
// the page, so page.on('request') never sees it. This is why the earlier
// diagnostic printed no request lines and I read that as "no request made".
ctx.on('request', r => { if (r.url().includes('sw.js')) console.log('  [ctx req]', r.method(), r.url()) })
ctx.on('response', async r => {
  if (!r.url().includes('sw.js')) return
  console.log('  [ctx res]', r.status(), r.url(), '| from cache:', r.fromServiceWorker())
})

console.log('\ncalling update()...')
console.log(await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration()
  await reg.update()
  return { installing: Boolean(reg.installing), waiting: Boolean(reg.waiting), active: reg.active?.state }
}))
await page.waitForTimeout(8000)
console.log('after 8s:', await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration()
  return { installing: Boolean(reg?.installing), waiting: Boolean(reg?.waiting) }
}))
await ctx.close()
